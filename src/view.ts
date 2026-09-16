import { Notice, ItemView, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import type FolderArchitectPlugin from "./main";
import { emptyDoc, type ArchitectDoc } from "./model";
import { pickVaultFolder, promptSaveBlueprint } from "./modals";
import { importDraftToDoc, pickComputerFolder, refreshLiveDoc } from "./obsidian-import";
import { extractBlocks, newBlueprintMarkdown, stringifyDoc, upsertArchitectBlock } from "./serialize";
import { mountArchitect, type ImportDraft } from "./ui";

export const VIEW_TYPE = "arbourist-view";

function safeNoteName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled blueprint";
}

export class ArchitectView extends ItemView {
  private file: TFile | null = null;
  private draft: ArchitectDoc | null = null;
  private mount: ReturnType<typeof mountArchitect> | null = null;
  private writing = false;
  private saveTimer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: FolderArchitectPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Untitled blueprint";
  }

  getIcon(): string {
    return "folder-tree";
  }

  async setFile(file: TFile): Promise<void> {
    this.file = file;
    this.draft = null;
    await this.reload();
  }

  getFile(): TFile | null {
    return this.file;
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("arbourist-view");
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.writing) return;
        if (file === this.file) void this.reload();
      }),
    );
  }

  async onClose(): Promise<void> {
    if (this.saveTimer != null) window.clearTimeout(this.saveTimer);
    await this.flushSave();
    this.mount?.destroy();
    this.mount = null;
  }

  async setState(state: unknown, result: Parameters<ItemView["setState"]>[1]): Promise<void> {
    const filePath = (state as { file?: string | null } | null)?.file;
    if (filePath) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        this.file = file;
        this.draft = null;
      }
    } else {
      this.file = null;
    }
    await super.setState(state, result);
    await this.reload();
  }

  getState(): Record<string, unknown> {
    return { file: this.file?.path ?? null };
  }

  private readDocFrom(markdown: string) {
    const blocks = extractBlocks(markdown);
    return blocks[0]?.doc ?? emptyDoc();
  }

  private async reload(): Promise<void> {
    this.mount?.destroy();
    this.mount = null;
    this.contentEl.empty();
    if (!this.file) {
      const doc =
        this.draft ??
        emptyDoc({
          title: "Untitled blueprint",
          includeFiles: this.plugin.settings.defaultIncludeFiles,
          linkFiles: this.plugin.settings.defaultLinkFiles,
        });
      this.draft = doc;
      this.mountBoard(doc, true);
      return;
    }
    let markdown = await this.app.vault.read(this.file);
    let doc = this.readDocFrom(markdown);
    if (doc.mode === "live" && doc.sourcePath) {
      try {
        const next = await refreshLiveDoc(this.app, doc);
        if (stringifyDoc(next) !== stringifyDoc(doc)) {
          doc = next;
          this.writing = true;
          await this.app.vault.process(this.file, (data) => upsertArchitectBlock(data, doc));
          this.writing = false;
        }
      } catch {
        // keep last saved tree if the source is gone
      }
    }
    this.mountBoard(doc, false);
  }

  private mountBoard(doc: ArchitectDoc, unsaved: boolean): void {
    this.mount = mountArchitect(
      this.contentEl,
      doc,
      {
        onChange: (next, immediate) => {
          doc = next;
          if (unsaved) this.draft = next;
          else this.scheduleSave(immediate);
        },
        onImport: async (draft: ImportDraft) => {
          const imported = await importDraftToDoc(this.app, draft, doc.id, this.plugin.settings.maxDepth);
          doc = imported;
          if (unsaved) this.draft = imported;
          this.mount?.update(doc);
          if (!unsaved) await this.flushSave();
        },
        onRefresh: async () => {
          doc = await refreshLiveDoc(this.app, doc);
          if (unsaved) this.draft = doc;
          this.mount?.update(doc);
          if (!unsaved) await this.flushSave();
        },
        onSave: unsaved ? () => this.saveAs() : undefined,
      },
      {
        canPickVault: true,
        canPickFs: true,
        pickVaultFolder: () => pickVaultFolder(this.app),
        pickFsFolder: () => pickComputerFolder(),
        onOpenLink: (link) => {
          const dest = this.app.metadataCache.getFirstLinkpathDest(link, this.file?.path ?? "");
          if (dest) void this.app.workspace.getLeaf(false).openFile(dest);
        },
      },
    );
  }

  private async saveAs(): Promise<void> {
    const doc = this.mount?.getDoc() ?? this.draft;
    if (!doc) return;
    const suggested = safeNoteName(doc.roots[0]?.name || doc.title || "Untitled blueprint");
    const picked = await promptSaveBlueprint(this.app, {
      folder: this.plugin.settings.blueprintsFolder,
      name: suggested,
    });
    if (!picked) return;
    const name = safeNoteName(picked.name);
    const folder = picked.folder;
    if (folder && !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
      await this.app.vault.createFolder(folder);
    }
    const path = folder ? `${folder}/${name}.md` : `${name}.md`;
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(`A note already exists at ${path}`);
      return;
    }
    doc.title = name;
    const file = await this.app.vault.create(path, newBlueprintMarkdown(doc));
    this.plugin.rememberBlueprint(file.path);
    this.file = file;
    this.draft = null;
    await this.leaf.setViewState({
      type: VIEW_TYPE,
      active: true,
      state: { file: file.path },
    });
  }

  private scheduleSave(immediate: boolean): void {
    if (this.saveTimer != null) window.clearTimeout(this.saveTimer);
    if (immediate) {
      void this.flushSave();
      return;
    }
    this.saveTimer = window.setTimeout(() => {
      void this.flushSave();
    }, 400);
  }

  private async flushSave(): Promise<void> {
    if (!this.file || !this.mount) return;
    const doc = this.mount.getDoc();
    this.writing = true;
    try {
      await this.app.vault.process(this.file, (data) => upsertArchitectBlock(data, doc));
    } finally {
      window.setTimeout(() => {
        this.writing = false;
      }, 50);
    }
  }
}
