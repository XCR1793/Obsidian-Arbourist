import { cloneNode, type ArchNode } from "./model";

export function filterTree(root: ArchNode, filter: string, ext: string): ArchNode {
  if (!filter && !ext) return root;
  const needle = filter.trim().toLowerCase();
  const extension = ext.trim().toLowerCase().replace(/^\./, "");

  const keep = (node: ArchNode): ArchNode | null => {
    const next = cloneNode(node, false);
    next.children = node.children.map(keep).filter((child): child is ArchNode => child !== null);
    const selfFileOk =
      node.type === "file" &&
      (!needle || node.name.toLowerCase().includes(needle) || (node.relPath ?? "").toLowerCase().includes(needle)) &&
      (!extension || node.name.toLowerCase().endsWith(`.${extension}`));
    const selfFolderMatch = node.type === "folder" && (!needle || node.name.toLowerCase().includes(needle));
    if (node.type === "file") return selfFileOk ? next : null;
    if (next.children.length > 0 || selfFolderMatch) return next;
    return null;
  };

  return keep(root) ?? { ...cloneNode(root, false), children: [] };
}
