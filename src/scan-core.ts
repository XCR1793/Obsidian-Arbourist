import { DEFAULT_IGNORE, emptyNode, type ArchNode, type ArchitectDoc, type SourceKind } from "./model";

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export interface ScanOptions {
  includeFiles: boolean;
  linkFiles: boolean;
  sourceKind: SourceKind;
  maxDepth: number;
  ignore: string[];
}

export const DEFAULT_SCAN: ScanOptions = {
  includeFiles: true,
  linkFiles: false,
  sourceKind: "fs",
  maxDepth: 20,
  ignore: [...DEFAULT_IGNORE],
};

function shouldIgnore(name: string, ignore: string[]): boolean {
  if (name.startsWith(".") && name !== ".") return true;
  return ignore.some((item) => item.toLowerCase() === name.toLowerCase());
}

function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function linkFor(relPath: string, options: ScanOptions): string | undefined {
  if (!options.linkFiles || options.sourceKind !== "vault") return undefined;
  return relPath.replace(/\\/g, "/");
}

export async function buildTreeFromLister(
  rootName: string,
  rootRel: string,
  list: (relPath: string) => Promise<DirEntry[]>,
  options: ScanOptions,
): Promise<ArchNode> {
  const root = emptyNode(rootName, "folder", rootRel || rootName);

  const fill = async (folder: ArchNode, rel: string, depth: number) => {
    if (depth >= options.maxDepth) return;
    let entries: DirEntry[] = [];
    try {
      entries = sortEntries(await list(rel));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (shouldIgnore(entry.name, options.ignore)) continue;
      if (!entry.isDirectory && !options.includeFiles) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        const child = emptyNode(entry.name, "folder", childRel);
        folder.children.push(child);
        await fill(child, childRel, depth + 1);
      } else {
        const child = emptyNode(entry.name, "file", childRel);
        const link = linkFor(childRel, options);
        if (link) child.link = link;
        folder.children.push(child);
      }
    }
  };

  await fill(root, rootRel, 0);
  return root;
}

export function treeFromRelativePaths(
  relativePaths: string[],
  options: Partial<ScanOptions> = {},
): ArchNode | null {
  const opts: ScanOptions = { ...DEFAULT_SCAN, ...options };
  const normalized = relativePaths
    .map((item) => item.replace(/\\/g, "/").replace(/^\/+/, ""))
    .filter(Boolean);
  if (normalized.length === 0) return null;

  const rootName = normalized[0]?.split("/")[0];
  if (!rootName) return null;
  const root = emptyNode(rootName, "folder", rootName);
  const folders = new Map<string, ArchNode>([[rootName, root]]);

  const ensureFolder = (rel: string): ArchNode => {
    const existing = folders.get(rel);
    if (existing) return existing;
    const parts = rel.split("/");
    const name = parts[parts.length - 1] ?? rel;
    const parentRel = parts.slice(0, -1).join("/");
    const parent = parentRel ? ensureFolder(parentRel) : root;
    const folder = emptyNode(name, "folder", rel);
    parent.children.push(folder);
    folders.set(rel, folder);
    return folder;
  };

  const seenFiles = new Set<string>();
  for (const rel of normalized) {
    const parts = rel.split("/");
    if (parts[0] !== rootName) continue;
    for (let i = 1; i < parts.length - 1; i += 1) {
      ensureFolder(parts.slice(0, i + 1).join("/"));
    }
    const name = parts[parts.length - 1];
    if (!name || parts.length === 1) continue;
    const parentRel = parts.slice(0, -1).join("/");
    const parent = ensureFolder(parentRel);
    const looksLikeFile = name.includes(".");
    if (!looksLikeFile) {
      ensureFolder(rel);
      continue;
    }
    if (!opts.includeFiles) continue;
    if (seenFiles.has(rel)) continue;
    if (shouldIgnore(name, opts.ignore)) continue;
    seenFiles.add(rel);
    const file = emptyNode(name, "file", rel);
    const link = linkFor(rel, opts);
    if (link) file.link = link;
    parent.children.push(file);
  }

  const sortTree = (node: ArchNode) => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    node.children.forEach(sortTree);
  };
  sortTree(root);
  return root;
}

export function docFromImport(args: {
  root: ArchNode;
  mode: ArchitectDoc["mode"];
  sourcePath: string;
  sourceKind: SourceKind;
  includeFiles: boolean;
  linkFiles: boolean;
  existingId?: string;
}): ArchitectDoc {
  return {
    version: 1,
    id: args.existingId ?? args.root.id,
    title: args.root.name,
    mode: args.mode,
    sourcePath: args.sourcePath,
    sourceKind: args.sourceKind,
    includeFiles: args.includeFiles,
    linkFiles: args.linkFiles,
    roots: [args.root],
    annotations: {},
  };
}
