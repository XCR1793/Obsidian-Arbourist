import { MarkdownRenderChild, TFile, TFolder } from "obsidian";
import { applyAnnotation } from "./model";
import { filterTree } from "./filter";
import { parseEmbedQuery, normalizeVaultPath, type EmbedQuery } from "./query";
import { docFromImport } from "./scan-core";
import { scanVaultFolder } from "./obsidian-import";
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

export function shouldHijackEmbed(plugin: FolderArchitectPlugin, src: string, sourcePath: string): EmbedQuery | null {
  const query = parseEmbedQuery(src.split("|")[0] ?? src);
  if (!query) return null;
  if (query.display === "static" && query.explicit) return query;
  const folder = resolveVaultFolder(plugin, query.path, sourcePath);
  if (!folder) return null;
  const asFile = plugin.app.metadataCache.getFirstLinkpathDest(query.path, sourcePath);
  if (asFile instanceof TFile && !query.explicit) return null;
  return query;
}

export class FolderEmbed extends MarkdownRenderChild {
  private mount: ReturnType<typeof mountArchitect> | null = null;
  private swallowClicks = false;

  constructor(
    containerEl: HTMLElement,
    private plugin: FolderArchitectPlugin,
    private query: EmbedQuery,
    private sourcePath: string,
    private embedSrc: string,
  ) {
    super(containerEl);
  }

  async onload(): Promise<void> {
    try {
      this.mount?.destroy();
      this.mount = null;
      this.ignoreEmbedNavigation();
      if (this.query.display === "static") {
        await this.bakeStatic();
        return;
      }

      const folder = resolveVaultFolder(this.plugin, this.query.path, this.sourcePath);
      if (!folder) {
        this.containerEl.replaceChildren();
        const missing = document.createElement("p");
        missing.textContent = `Folder not found: ${this.query.path || "/"}`;
        this.containerEl.append(missing);
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
            await this.onload();
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
      this.containerEl.replaceChildren();
      const failed = document.createElement("p");
      failed.textContent = error instanceof Error ? error.message : String(error);
      this.containerEl.append(failed);
    }
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
        this.containerEl.replaceChildren();
        const missing = document.createElement("p");
        missing.textContent = `Nothing to bake, and folder not found: ${this.query.path || "/"}`;
        this.containerEl.append(missing);
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
    const pre = document.createElement("pre");
    pre.className = "fa-baked";
    pre.textContent = ascii;
    this.containerEl.replaceChildren(pre);
    this.containerEl.classList.add("arbourist-embed", "is-static-bake");
    window.requestAnimationFrame(() => hideFollowingBake(this.containerEl));
  }

  onunload(): void {
    this.mount?.destroy();
    this.mount = null;
  }
}

function hideFollowingBake(el: HTMLElement): void {
  const hosts = [el, el.closest(".internal-embed"), el.closest("p"), el.closest(".cm-embed-block")].filter(
    (node): node is HTMLElement => Boolean(node),
  );
  for (const host of hosts) {
    let sib: Element | null = host.nextElementSibling;
    for (let i = 0; i < 6 && sib; i += 1) {
      const pre = sib.matches("pre") ? sib : sib.querySelector("pre");
      const lang = pre?.querySelector("code")?.className ?? "";
      if (pre && lang.includes("arbourist-static")) {
        sib.classList.add("fa-static-store");
        (sib as HTMLElement).hidden = true;
        (pre as HTMLElement).hidden = true;
        return;
      }
      if (/\b(HyperMD-codeblock|cm-hmd-codeblock)\b/.test(sib.className)) {
        const start = sib;
        const chunk: HTMLElement[] = [];
        let cur: Element | null = sib;
        while (cur && /\b(HyperMD-codeblock|cm-hmd-codeblock)\b/.test(cur.className)) {
          chunk.push(cur as HTMLElement);
          cur = cur.nextElementSibling;
        }
        if (chunk.some((node) => (node.textContent ?? "").includes("arbourist-static"))) {
          for (const node of chunk) {
            node.classList.add("fa-static-store");
            node.hidden = true;
          }
          start.classList.add("fa-static-store");
        }
        return;
      }
      if ((sib.textContent ?? "").trim()) break;
      sib = sib.nextElementSibling;
    }
  }
}
