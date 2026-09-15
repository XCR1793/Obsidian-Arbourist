import type { ArchNode, NodeType } from "./model";
import { emptyNode } from "./model";

export interface NodeLocation {
  node: ArchNode;
  parent: ArchNode | null;
  siblings: ArchNode[];
  index: number;
}

export function locate(roots: ArchNode[], id: string): NodeLocation | null {
  const search = (siblings: ArchNode[], parent: ArchNode | null): NodeLocation | null => {
    for (let index = 0; index < siblings.length; index += 1) {
      const node = siblings[index];
      if (!node) continue;
      if (node.id === id) return { node, parent, siblings, index };
      const nested = search(node.children, node);
      if (nested) return nested;
    }
    return null;
  };
  return search(roots, null);
}

export function updateNode(
  roots: ArchNode[],
  id: string,
  patch: Partial<Pick<ArchNode, "name" | "description" | "link" | "collapsed" | "missing" | "type">>,
): boolean {
  const found = locate(roots, id);
  if (!found) return false;
  Object.assign(found.node, patch);
  return true;
}

export function addChild(roots: ArchNode[], parentId: string | null, type: NodeType, name?: string): ArchNode | null {
  const node = emptyNode(name ?? (type === "folder" ? "new-folder" : "new-file"), type);
  if (!parentId) {
    roots.push(node);
    return node;
  }
  const found = locate(roots, parentId);
  if (!found || found.node.type !== "folder") return null;
  found.node.children.push(node);
  found.node.collapsed = false;
  return node;
}

export function addSibling(roots: ArchNode[], id: string, type: NodeType): ArchNode | null {
  const found = locate(roots, id);
  if (!found) return addChild(roots, null, type);
  const node = emptyNode(type === "folder" ? "new-folder" : "new-file", type);
  found.siblings.splice(found.index + 1, 0, node);
  return node;
}

export function deleteNode(roots: ArchNode[], id: string): boolean {
  const found = locate(roots, id);
  if (!found) return false;
  found.siblings.splice(found.index, 1);
  return true;
}

export function moveNode(roots: ArchNode[], id: string, direction: "up" | "down"): boolean {
  const found = locate(roots, id);
  if (!found) return false;
  const target = direction === "up" ? found.index - 1 : found.index + 1;
  if (target < 0 || target >= found.siblings.length) return false;
  const current = found.siblings[found.index];
  const swap = found.siblings[target];
  if (!current || !swap) return false;
  found.siblings[found.index] = swap;
  found.siblings[target] = current;
  return true;
}

export function indentNode(roots: ArchNode[], id: string): boolean {
  const found = locate(roots, id);
  if (!found || found.index === 0) return false;
  const prev = found.siblings[found.index - 1];
  if (!prev || prev.type !== "folder") return false;
  found.siblings.splice(found.index, 1);
  prev.children.push(found.node);
  prev.collapsed = false;
  return true;
}

export function outdentNode(roots: ArchNode[], id: string): boolean {
  const found = locate(roots, id);
  if (!found?.parent) return false;
  const parentLoc = locate(roots, found.parent.id);
  if (!parentLoc) return false;
  found.siblings.splice(found.index, 1);
  parentLoc.siblings.splice(parentLoc.index + 1, 0, found.node);
  return true;
}

export interface FlatRow {
  node: ArchNode;
  depth: number;
  parent: ArchNode | null;
  isLast: boolean;
  prefix: string;
}

export function flattenVisible(roots: ArchNode[]): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (nodes: ArchNode[], depth: number, parent: ArchNode | null, prefix: string) => {
    nodes.forEach((node, index) => {
      const last = index === nodes.length - 1;
      const branch = depth === 0 ? "" : last ? "└── " : "├── ";
      rows.push({ node, depth, parent, isLast: last, prefix: prefix + branch });
      if (node.type === "folder" && !node.collapsed) {
        const nextPrefix = depth === 0 ? "" : prefix + (last ? "    " : "│   ");
        walk(node.children, depth + 1, node, nextPrefix);
      }
    });
  };
  walk(roots, 0, null, "");
  return rows;
}

export function ensureRelPath(node: ArchNode, parentPath = ""): void {
  const rel = parentPath ? `${parentPath}/${node.name}` : node.name;
  node.relPath = rel;
  for (const child of node.children) ensureRelPath(child, rel);
}

export function collapseAll(nodes: ArchNode[], collapsed: boolean): void {
  for (const node of nodes) {
    if (node.type === "folder") node.collapsed = collapsed;
    collapseAll(node.children, collapsed);
  }
}

export function dismissMissing(roots: ArchNode[]): void {
  const filter = (nodes: ArchNode[]): ArchNode[] => {
    const kept = nodes.filter((node) => !node.missing);
    for (const node of kept) node.children = filter(node.children);
    return kept;
  };
  const next = filter(roots);
  roots.splice(0, roots.length, ...next);
}
