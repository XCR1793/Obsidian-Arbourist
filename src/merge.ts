import type { ArchNode, ArchitectDoc } from "./model";
import { applyAnnotation, cloneNode, collectAnnotations } from "./model";

function indexByRel(nodes: ArchNode[], into = new Map<string, ArchNode>()): Map<string, ArchNode> {
  for (const node of nodes) {
    if (node.relPath) into.set(node.relPath, node);
    indexByRel(node.children, into);
  }
  return into;
}

export function mergeLiveScan(current: ArchitectDoc, scannedRoot: ArchNode): ArchitectDoc {
  const annotations = {
    ...current.annotations,
    ...collectAnnotations(current.roots),
  };
  const oldByRel = indexByRel(current.roots);
  const nextRoot = cloneNode(scannedRoot, true);

  const restore = (node: ArchNode) => {
    applyAnnotation(node, annotations);
    const previous = node.relPath ? oldByRel.get(node.relPath) : undefined;
    if (previous?.link && !node.link) node.link = previous.link;
    if (previous?.description && !node.description) node.description = previous.description;
    if (previous?.collapsed) node.collapsed = true;
    for (const child of node.children) restore(child);
  };
  restore(nextRoot);

  const nextRels = indexByRel([nextRoot]);
  const missing: ArchNode[] = [];
  for (const [rel, node] of oldByRel) {
    if (nextRels.has(rel)) continue;
    if (!node.description.trim() && !node.link) continue;
    missing.push({
      ...cloneNode(node, true),
      missing: true,
      children: [],
    });
  }

  if (missing.length > 0) {
    const bucket = nextRoot.children.find((child) => child.name === "_missing") ?? {
      ...cloneNode(nextRoot, true),
      id: nextRoot.id + "-missing",
      name: "_missing",
      type: "folder" as const,
      description: "Present in the last snapshot, gone from disk. Descriptions kept until you dismiss them.",
      relPath: `${nextRoot.relPath ?? nextRoot.name}/_missing`,
      children: [],
      missing: true,
    };
    if (!nextRoot.children.includes(bucket)) nextRoot.children.push(bucket);
    bucket.children = missing;
  }

  return {
    ...current,
    mode: "live",
    title: current.title ?? scannedRoot.name,
    roots: [nextRoot],
    annotations,
  };
}

export function detachToSnapshot(doc: ArchitectDoc): ArchitectDoc {
  return {
    ...doc,
    mode: "design",
    annotations: {
      ...doc.annotations,
      ...collectAnnotations(doc.roots),
    },
  };
}
