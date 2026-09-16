import { Notice, Plugin, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { FolderEmbed, shouldHijackEmbed } from "./embed";
import { hideBakedStoresIn, hideStaticStoreElement } from "./hide-static";
import { type ArchitectDoc } from "./model";
import { pickBlueprintFile, pickVaultFolder } from "./modals";
import { importDraftToDoc, pickComputerFolder, refreshLiveDoc } from "./obsidian-import";
import { toEmbedMarkdown } from "./query";
import { bakeStaticIntoMarkdown } from "./static-store";
import { extractBlocks, parseDoc, stringifyDoc, upsertArchitectBlock } from "./serialize";
import { ArchitectSettingTab, DEFAULT_SETTINGS, type ArchitectSettings } from "./settings";
import { mountArchitect, type ImportDraft } from "./ui";
import { ArchitectView, VIEW_TYPE } from "./view";

export default class FolderArchitectPlugin extends Plugin {
  settings: ArchitectSettings = DEFAULT_SETTINGS;
  private folderEmbeds = new Set<FolderEmbed>();
  private scanTimer: number | null = null;
  private staticWrites = new Set<string>();
  private blueprintNotes = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new ArchitectView(leaf, this));

    this.addRibbonIcon("folder-tree", "New blueprint", () => {
      void this.createBlueprint();
    });

    this.addCommand({
      id: "new-blueprint",
      name: "New blueprint",
      callback: () => void this.createBlueprint(),
    });

    this.addCommand({
      id: "open-in-architect",
      name: "Open current file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) void this.openInView(file);
        return true;
      },
    });

    this.addCommand({
      id: "import-folder",
      name: "Import folder into a new blueprint",
      callback: () => void this.createBlueprint({ openImport: true }),
    });

    this.registerMarkdownCodeBlockProcessor("arbourist", (source, el, ctx) => {
      void this.renderBlock(source, el, ctx.sourcePath);
    });

    this.registerMarkdownCodeBlockProcessor("arbourist-static", (_source, el) => {
      el.empty();
      hideStaticStoreElement(el);
    });

    this.registerMarkdownPostProcessor((el, ctx) => {
      hideBakedStoresIn(el);
      this.renderFolderEmbeds(el, ctx.sourcePath, ctx);
    });

    const observer = new MutationObserver(() => this.queueEmbedScan());
    observer.observe(document.body, { childList: true, subtree: true });
    this.register(() => observer.disconnect());
    this.queueEmbedScan();

    this.addCommand({
      id: "insert-folder-embed",
      name: "Insert folder embed",
      editorCallback: (editor) => {
        void (async () => {
          const folder = await pickVaultFolder(this.app);
          if (!folder) return;
          const path = folder === "/" ? "" : folder.replace(/^\//, "");
          editor.replaceSelection(
            toEmbedMarkdown({
              path,
              display: "live",
              comments: false,
              files: true,
              links: false,
              depth: this.settings.maxDepth,
              filter: "",
              ext: "",
              refresh: false,
              explicit: true,
            }),
          );
        })();
      },
    });

    this.addCommand({
      id: "insert-blueprint-embed",
      name: "Insert blueprint embed",
      editorCallback: (editor) => {
        void (async () => {
          const file = await pickBlueprintFile(this.app, this.listBlueprintNotes());
          if (!file) {
            new Notice("Create a blueprint first (ribbon or New blueprint).");
            return;
          }
          const path = file.path.replace(/\.md$/i, "");
          editor.replaceSelection(
            toEmbedMarkdown({
              path,
              display: "live",
              comments: true,
              files: true,
              links: false,
              depth: this.settings.maxDepth,
              filter: "",
              ext: "",
              refresh: false,
              explicit: true,
            }),
          );
        })();
      },
    });

    this.app.workspace.onLayoutReady(() => {
      void this.indexBlueprints();
    });
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") void this.refreshBlueprintIndex(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) this.blueprintNotes.delete(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.blueprintNotes.delete(oldPath);
        if (file instanceof TFile && file.extension === "md") void this.refreshBlueprintIndex(file);
      }),
    );

    this.addSettingTab(new ArchitectSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<ArchitectSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...data,
      commentsByFolder: { ...(data?.commentsByFolder ?? {}) },
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  rememberBlueprint(path: string): void {
    this.blueprintNotes.add(path);
  }

  isBlueprintNote(file: TFile): boolean {
    return file.extension === "md" && this.blueprintNotes.has(file.path);
  }

  listBlueprintNotes(): TFile[] {
    const files = this.app.vault.getMarkdownFiles().filter((file) => this.isBlueprintNote(file));
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async indexBlueprints(): Promise<void> {
    for (const file of this.app.vault.getMarkdownFiles()) {
      await this.refreshBlueprintIndex(file);
    }
  }

  private async refreshBlueprintIndex(file: TFile): Promise<void> {
    try {
      const markdown = await this.app.vault.cachedRead(file);
      if (extractBlocks(markdown).length > 0) this.blueprintNotes.add(file.path);
      else this.blueprintNotes.delete(file.path);
    } catch {
      // ignore unreadable notes
    }
  }

  getFolderComments(folderPath: string): Record<string, string> {
    return { ...(this.settings.commentsByFolder?.[folderPath] ?? {}) };
  }

  async setFolderComments(folderPath: string, annotations: Record<string, string>): Promise<void> {
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(annotations)) {
      if (value.trim()) clean[key] = value;
    }
    if (!this.settings.commentsByFolder) this.settings.commentsByFolder = {};
    this.settings.commentsByFolder[folderPath] = clean;
    await this.saveSettings();
  }

  async bakeStaticEmbed(sourcePath: string, embedSrc: string, ascii: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(file instanceof TFile)) return;
    if (this.staticWrites.has(file.path)) return;
    this.staticWrites.add(file.path);
    try {
      await this.app.vault.process(file, (data) => bakeStaticIntoMarkdown(data, embedSrc, ascii));
    } finally {
      window.setTimeout(() => this.staticWrites.delete(file.path), 250);
    }
  }

  private queueEmbedScan(): void {
    if (this.scanTimer != null) window.clearTimeout(this.scanTimer);
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = null;
      const file = this.app.workspace.getActiveFile()?.path ?? "";
      hideBakedStoresIn(document.body);
      this.renderFolderEmbeds(document.body, file);
    }, 50);
  }

  private renderFolderEmbeds(
    el: HTMLElement,
    sourcePath: string,
    ctx?: { addChild: (child: FolderEmbed) => void },
  ): void {
    for (const existing of Array.from(this.folderEmbeds)) {
      if (!existing.containerEl.isConnected) {
        this.removeChild(existing);
        this.folderEmbeds.delete(existing);
      }
    }
    const embeds = Array.from(el.querySelectorAll<HTMLElement>("span.internal-embed, div.internal-embed"));
    for (const embed of embeds) {
      if (embed.classList.contains("arbourist-embed")) continue;
      const src = embed.getAttribute("src") ?? embed.getAttribute("alt") ?? "";
      const query = shouldHijackEmbed(this, src, sourcePath);
      if (!query) continue;
      embed.classList.add("arbourist-embed");
      embed.classList.remove("is-unresolved", "mod-empty");
      embed.removeAttribute("href");
      const child = new FolderEmbed(embed, this, query, sourcePath, src);
      this.folderEmbeds.add(child);
      if (ctx) ctx.addChild(child);
      else this.addChild(child);
    }
  }

  async createBlueprint(opts?: { openImport?: boolean }): Promise<void> {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: VIEW_TYPE,
      active: true,
      state: { file: null },
    });
    await this.app.workspace.revealLeaf(leaf);
    if (opts?.openImport) {
      new Notice("Use Import folder in the toolbar to load a snapshot or live view.");
    }
  }

  async openInView(file: TFile): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE).find((leaf) => {
      const view = leaf.view;
      return view instanceof ArchitectView && view.getFile()?.path === file.path;
    });
    const leaf: WorkspaceLeaf = existing ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: VIEW_TYPE,
      active: true,
      state: { file: file.path },
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  private async renderBlock(source: string, el: HTMLElement, sourcePath: string): Promise<void> {
    el.empty();
    let doc: ArchitectDoc;
    try {
      doc = parseDoc(source);
    } catch {
      el.createEl("p", { text: "This Arbourist block could not be parsed." });
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (doc.mode === "live" && doc.sourcePath && file instanceof TFile) {
      try {
        const next = await refreshLiveDoc(this.app, doc);
        if (stringifyDoc(next) !== stringifyDoc(doc)) {
          doc = next;
          await this.app.vault.process(file, (data) => upsertArchitectBlock(data, doc));
          return;
        }
      } catch {
        // keep last tree
      }
    }

    let saveTimer: number | null = null;
    const save = async (next = doc) => {
      if (!(file instanceof TFile)) return;
      await this.app.vault.process(file, (data) => upsertArchitectBlock(data, next));
    };

    mountArchitect(
      el,
      doc,
      {
        onChange: (next, immediate) => {
          doc = next;
          if (saveTimer != null) window.clearTimeout(saveTimer);
          if (immediate) void save(next);
          else {
            saveTimer = window.setTimeout(() => void save(next), 700);
          }
        },
        onImport: async (draft: ImportDraft) => {
          doc = await importDraftToDoc(this.app, draft, doc.id, this.settings.maxDepth);
          await save(doc);
        },
        onRefresh: async () => {
          doc = await refreshLiveDoc(this.app, doc);
          await save(doc);
        },
      },
      {
        canPickVault: true,
        canPickFs: true,
        pickVaultFolder: () => pickVaultFolder(this.app),
        pickFsFolder: () => pickComputerFolder(),
        onOpenLink: (link) => {
          const dest = this.app.metadataCache.getFirstLinkpathDest(link, sourcePath);
          if (dest) void this.app.workspace.getLeaf(false).openFile(dest);
        },
      },
    );

    const openBtn = el.createEl("button", { text: "Open in editor", cls: "fa-btn fa-open-view" });
    openBtn.addEventListener("click", () => {
      if (file instanceof TFile) void this.openInView(file);
    });
  }
}
