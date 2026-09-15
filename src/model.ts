export type NodeType = "folder" | "file";
export type ArchitectMode = "design" | "live";
export type SourceKind = "vault" | "fs";

export interface ArchNode {
  id: string;
  name: string;
  type: NodeType;
  description: string;
  link?: string;
  relPath?: string;
  missing?: boolean;
  collapsed?: boolean;
  children: ArchNode[];
}

export interface ArchitectDoc {
  version: 1;
  id: string;
  title?: string;
  mode: ArchitectMode;
  sourcePath?: string;
  sourceKind?: SourceKind;
  includeFiles: boolean;
  linkFiles: boolean;
  roots: ArchNode[];
  annotations: Record<string, string>;
}

export const DEFAULT_IGNORE = [
  ".git",
  "node_modules",
  ".DS_Store",
  "desktop.ini",
  "Thumbs.db",
];

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

export function emptyNode(name: string, type: NodeType, relPath?: string): ArchNode {
  return {
    id: newId(),
    name,
    type,
    description: "",
    relPath,
    children: [],
  };
}

export function emptyDoc(partial?: Partial<ArchitectDoc>): ArchitectDoc {
  return {
    version: 1,
    id: newId(),
    mode: "design",
    includeFiles: true,
    linkFiles: false,
    roots: [],
    annotations: {},
    ...partial,
  };
}

export function cloneNode(node: ArchNode, freshIds = false): ArchNode {
  return {
    ...node,
    id: freshIds ? newId() : node.id,
    children: node.children.map((child) => cloneNode(child, freshIds)),
  };
}

export function cloneDoc(doc: ArchitectDoc): ArchitectDoc {
  return {
    ...doc,
    roots: doc.roots.map((node) => cloneNode(node)),
    annotations: { ...doc.annotations },
  };
}

export function annotationKey(node: ArchNode): string | null {
  if (node.relPath) return node.relPath;
  return null;
}

export function applyAnnotation(node: ArchNode, annotations: Record<string, string>): void {
  const key = annotationKey(node);
  if (key && Object.prototype.hasOwnProperty.call(annotations, key)) {
    node.description = annotations[key] ?? "";
  }
  for (const child of node.children) applyAnnotation(child, annotations);
}

export function collectAnnotations(nodes: ArchNode[], into: Record<string, string> = {}): Record<string, string> {
  for (const node of nodes) {
    const key = annotationKey(node);
    if (key && node.description.trim()) into[key] = node.description;
    collectAnnotations(node.children, into);
  }
  return into;
}

export function countNodes(nodes: ArchNode[]): { folders: number; files: number } {
  let folders = 0;
  let files = 0;
  const walk = (list: ArchNode[]) => {
    for (const node of list) {
      if (node.type === "folder") folders += 1;
      else files += 1;
      walk(node.children);
    }
  };
  walk(nodes);
  return { folders, files };
}

export function defaultTitle(doc: ArchitectDoc): string {
  if (doc.title?.trim()) return doc.title;
  const first = doc.roots[0]?.name;
  if (first) return first;
  return "Untitled blueprint";
}
