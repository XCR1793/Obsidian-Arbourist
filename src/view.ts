import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type FolderArchitectPlugin from "./main";
import { emptyDoc } from "./model";
import { pickVaultFolder } from "./modals";
import { importDraftToDoc, pickComputerFolder, refreshLiveDoc } from "./obsidian-import";
import { extractBlocks, stringifyDoc, upsertArchitectBlock } from "./serialize";
import { mountArchitect, type ImportDraft } from "./ui";

export const VIEW_TYPE = "arbourist-view";

export class ArchitectView extends ItemView {
  private file: TFile | null = null;
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
    return this.file?.basename ?? "Arbourist";
  }

  getIcon(): string {
    return "folder-tree";
  }

  async setFile(file: TFile): Promise<void> {
    this.file = file;
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
    const filePath = (state as { file?: string } | null)?.file;
    if (filePath) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) this.file = file;
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
      this.contentEl.createEl("p", { text: "Open a blueprint note, or create a new one from the ribbon." });
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
    this.mount = mountArchitect(
      this.contentEl,
      doc,
      {
        onChange: (next, immediate) => {
          doc = next;
          this.scheduleSave(immediate);
        },
        onImport: async (draft: ImportDraft) => {
          const imported = await importDraftToDoc(this.app, draft, doc.id, this.plugin.settings.maxDepth);
          doc = imported;
          this.mount?.update(doc);
          await this.flushSave();
        },
        onRefresh: async () => {
          doc = await refreshLiveDoc(this.app, doc);
          this.mount?.update(doc);
          await this.flushSave();
        },
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
