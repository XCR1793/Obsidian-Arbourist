import { MarkdownRenderChild, TFile, TFolder } from "obsidian";
import { applyAnnotation, cloneDoc, type ArchNode, type ArchitectDoc } from "./model";
import { filterTree } from "./filter";
import { parseEmbedQuery, normalizeVaultPath, type EmbedQuery } from "./query";
import { docFromImport } from "./scan-core";
import { scanVaultFolder } from "./obsidian-import";
import { extractBlocks } from "./serialize";
import { hideFollowingBake, hideBakedStoresIn } from "./hide-static";
import { asciiFromDoc, findBakedAscii, findLegacyStaticDoc } from "./static-store";
import { mountArchitect } from "./ui";
import type FolderArchitectPlugin from "./main";

export function resolveVaultFolder(plugin: FolderArchitectPlugin, path: string, sourcePath: string): TFolder | null {
  const app = plugin.app;
  const direct = normalizeVaultPath(path);
  const candidates = [direct];
  if (sourcePath.includes("/")) {
    const dir = sourcePath.split("/").slice(0, -1).join("/");
    if (dir && direct) candidates.push(`${dir}/${direct}`);
  }
  for (const candidate of candidates) {
    const file = app.vault.getAbstractFileByPath(candidate);
    if (file instanceof TFolder) return file;
  }
  if (!direct) return app.vault.getRoot();
  return null;
}

export function resolveVaultNote(plugin: FolderArchitectPlugin, path: string, sourcePath: string): TFile | null {
  const direct = normalizeVaultPath(path).replace(/\.md$/i, "");
  if (!direct) return null;
  const fromLink = plugin.app.metadataCache.getFirstLinkpathDest(direct, sourcePath);
  if (fromLink instanceof TFile && fromLink.extension === "md") return fromLink;
  const dir = sourcePath.includes("/") ? sourcePath.split("/").slice(0, -1).join("/") : "";
  const candidates = [direct, `${direct}.md`];
  if (dir) candidates.push(`${dir}/${direct}`, `${dir}/${direct}.md`);
  for (const candidate of candidates) {
    const file = plugin.app.vault.getAbstractFileByPath(candidate);
    if (file instanceof TFile && file.extension === "md") return file;
  }
  return null;
}

export function shouldHijackEmbed(plugin: FolderArchitectPlugin, src: string, sourcePath: string): EmbedQuery | null {
  const query = parseEmbedQuery(src.split("|")[0] ?? src);
  if (!query) return null;
  const note = resolveVaultNote(plugin, query.path, sourcePath);
  if (note && note.path !== sourcePath && plugin.isBlueprintNote(note)) return query;
  if (note && query.explicit && note.path !== sourcePath) return query;
  if (query.display === "static" && query.explicit) return query;
  const folder = resolveVaultFolder(plugin, query.path, sourcePath);
  if (!folder) return null;
  if (note && !query.explicit) return null;
  return query;
}

export class FolderEmbed extends MarkdownRenderChild {
  private mount: ReturnType<typeof mountArchitect> | null = null;
  private swallowClicks = false;
  private watchedPath: string | null = null;
  private remountTimer: number | null = null;

  constructor(
    containerEl: HTMLElement,
    private plugin: FolderArchitectPlugin,
    private query: EmbedQuery,
    private sourcePath: string,
    private embedSrc: string,
  ) {
    super(containerEl);
  }

  onload(): void {
    this.registerEvent(
      this.plugin.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.path === this.watchedPath) this.queueRemount();
      }),
    );
    void this.mountEmbed();
  }

  private queueRemount(): void {
    if (this.remountTimer != null) window.clearTimeout(this.remountTimer);
    this.remountTimer = window.setTimeout(() => {
      this.remountTimer = null;
      void this.mountEmbed();
    }, 80);
  }

  private async mountEmbed(): Promise<void> {
    try {
      this.mount?.destroy();
      this.mount = null;
      this.ignoreEmbedNavigation();
      const note = resolveVaultNote(this.plugin, this.query.path, this.sourcePath);
      if (note && note.path !== this.sourcePath) {
        const markdown = await this.plugin.app.vault.cachedRead(note);
        const block = extractBlocks(markdown)[0];
        if (block) {
          this.plugin.rememberBlueprint(note.path);
          this.watchedPath = note.path;
          if (this.query.display === "static") {
            await this.bakeStaticFromDoc(shapeDocForEmbed(block.doc, this.query));
            return;
          }
          this.mountBlueprint(shapeDocForEmbed(block.doc, this.query));
          return;
        }
      }
      this.watchedPath = null;
      if (this.query.display === "static") {
        await this.bakeStatic();
        return;
      }

      const folder = resolveVaultFolder(this.plugin, this.query.path, this.sourcePath);
      if (!folder) {
        this.containerEl.empty();
        this.containerEl.createEl("p", { text: `Folder not found: ${this.query.path || "/"}` });
        return;
      }

      let root = await scanVaultFolder(this.plugin.app, folder.path, {
        includeFiles: this.query.files,
        linkFiles: this.query.links,
        sourceKind: "vault",
        maxDepth: this.query.depth,
      });
      applyAnnotation(root, this.plugin.getFolderComments(folder.path));
      root = filterTree(root, this.query.filter, this.query.ext);
      const doc = docFromImport({
        root,
        mode: "live",
        sourcePath: folder.path,
        sourceKind: "vault",
        includeFiles: this.query.files,
        linkFiles: this.query.links,
      });
      doc.annotations = this.plugin.getFolderComments(folder.path);

      this.containerEl.replaceChildren();
      this.containerEl.classList.add("arbourist-embed");
      this.mount = mountArchitect(
        this.containerEl,
        doc,
        {
          onChange: (next) => {
            void this.plugin.setFolderComments(folder.path, next.annotations);
          },
          onImport: async () => {},
          onRefresh: async () => {
            await this.mountEmbed();
          },
        },
        {
          canPickVault: false,
          canPickFs: false,
          onOpenLink: (link) => {
            const dest = this.plugin.app.metadataCache.getFirstLinkpathDest(link, this.sourcePath);
            if (dest) void this.plugin.app.workspace.getLeaf(false).openFile(dest);
          },
        },
        {
          chrome: "embed",
          comments: this.query.comments ? "click" : "off",
          namesEditable: false,
        },
      );
    } catch (error) {
      this.containerEl.empty();
      this.containerEl.createEl("p", { text: error instanceof Error ? error.message : String(error) });
    }
  }

  private mountBlueprint(doc: ArchitectDoc): void {
    this.containerEl.replaceChildren();
    this.containerEl.classList.add("arbourist-embed");
    this.mount = mountArchitect(
      this.containerEl,
      doc,
      {
        onChange: () => {},
        onImport: async () => {},
        onRefresh: async () => {
          await this.mountEmbed();
        },
      },
      {
        canPickVault: false,
        canPickFs: false,
        onOpenLink: (link) => {
          const dest = this.plugin.app.metadataCache.getFirstLinkpathDest(link, this.sourcePath);
          if (dest) void this.plugin.app.workspace.getLeaf(false).openFile(dest);
        },
      },
      {
        chrome: "embed",
        comments: this.query.comments ? "click" : "off",
        namesEditable: false,
      },
    );
  }

  private async bakeStaticFromDoc(doc: ArchitectDoc): Promise<void> {
    const ascii = asciiFromDoc(doc);
    await this.plugin.bakeStaticEmbed(this.sourcePath, this.embedSrc, ascii);
    this.showBaked(ascii);
  }

  private async bakeStatic(): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
    const markdown = file instanceof TFile ? await this.plugin.app.vault.read(file) : "";
    const existing = findBakedAscii(markdown, this.embedSrc);
    const needsPull = this.query.refresh || !existing;

    let ascii = existing;
    if (needsPull) {
      ascii = await this.pullStaticAscii(markdown);
      if (!ascii) {
        if (existing) {
          this.showBaked(existing);
          return;
        }
        this.containerEl.empty();
        this.containerEl.createEl("p", { text: `Nothing to bake, and folder not found: ${this.query.path || "/"}` });
        return;
      }
      await this.plugin.bakeStaticEmbed(this.sourcePath, this.embedSrc, ascii);
    } else if (existing && !markdown.includes("```arbourist-static")) {
      await this.plugin.bakeStaticEmbed(this.sourcePath, this.embedSrc, existing);
    }

    this.showBaked(ascii ?? "");
  }

  private async pullStaticAscii(markdown: string): Promise<string | null> {
    const legacy = findLegacyStaticDoc(markdown, this.embedSrc);
    if (legacy && !this.query.refresh) return asciiFromDoc(legacy);

    const note = resolveVaultNote(this.plugin, this.query.path, this.sourcePath);
    if (note) {
      const noteMarkdown = await this.plugin.app.vault.cachedRead(note);
      const block = extractBlocks(noteMarkdown)[0];
      if (block) {
        this.plugin.rememberBlueprint(note.path);
        return asciiFromDoc(shapeDocForEmbed(block.doc, this.query));
      }
    }

    const folder = resolveVaultFolder(this.plugin, this.query.path, this.sourcePath);
    if (!folder) return legacy ? asciiFromDoc(legacy) : null;

    let root = await scanVaultFolder(this.plugin.app, folder.path, {
      includeFiles: this.query.files,
      linkFiles: this.query.links,
      sourceKind: "vault",
      maxDepth: this.query.depth,
    });
    if (this.query.comments) applyAnnotation(root, this.plugin.getFolderComments(folder.path));
    root = filterTree(root, this.query.filter, this.query.ext);
    const doc = docFromImport({
      root,
      mode: "design",
      sourcePath: folder.path,
      sourceKind: "vault",
      includeFiles: this.query.files,
      linkFiles: this.query.links,
    });
    return asciiFromDoc(doc);
  }

  private ignoreEmbedNavigation(): void {
    if (this.swallowClicks) return;
    this.swallowClicks = true;
    const prevent = (event: Event) => event.preventDefault();
    const stop = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    for (const type of ["click", "auxclick", "dblclick"] as const) {
      this.containerEl.addEventListener(type, prevent, true);
      this.containerEl.addEventListener(type, stop);
    }
  }

  private showBaked(ascii: string): void {
    this.containerEl.empty();
    this.containerEl.createEl("pre", { cls: "fa-baked", text: ascii });
    this.containerEl.classList.add("arbourist-embed", "is-static-bake");
    const hide = () => {
      hideFollowingBake(this.containerEl);
      hideBakedStoresIn(this.containerEl.ownerDocument ?? document);
    };
    hide();
    window.requestAnimationFrame(hide);
    window.setTimeout(hide, 80);
  }

  onunload(): void {
    if (this.remountTimer != null) window.clearTimeout(this.remountTimer);
    this.mount?.destroy();
    this.mount = null;
  }
}

function dropFiles(nodes: ArchNode[]): ArchNode[] {
  return nodes
    .filter((node) => node.type === "folder")
    .map((node) => ({ ...node, children: dropFiles(node.children) }));
}

function shapeDocForEmbed(doc: ArchitectDoc, query: EmbedQuery): ArchitectDoc {
  const next = cloneDoc(doc);
  if (!query.files) next.roots = dropFiles(next.roots);
  if (query.filter || query.ext) {
    next.roots = next.roots.map((root) => filterTree(root, query.filter, query.ext));
  }
  return next;
}

