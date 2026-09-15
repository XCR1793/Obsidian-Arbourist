import type { ArchNode, ArchitectDoc } from "./model";

function suffix(node: ArchNode): string {
  if (node.type === "folder") return "/";
  return "";
}

function comment(node: ArchNode): string {
  const bits: string[] = [];
  if (node.description.trim()) bits.push(node.description.trim());
  if (node.link) bits.push(`[[${node.link}]]`);
  if (node.missing) bits.push("missing from disk");
  return bits.length ? `  — ${bits.join(" · ")}` : "";
}

export function toAsciiTree(nodes: ArchNode[]): string {
  const lines: string[] = [];
  const walk = (list: ArchNode[], prefix: string, isRoot: boolean) => {
    list.forEach((node, index) => {
      if (isRoot) {
        lines.push(`${node.name}${suffix(node)}${comment(node)}`);
        walk(node.children, "", false);
        return;
      }
      const last = index === list.length - 1;
      const branch = last ? "└── " : "├── ";
      lines.push(`${prefix}${branch}${node.name}${suffix(node)}${comment(node)}`);
      const nextPrefix = prefix + (last ? "    " : "│   ");
      walk(node.children, nextPrefix, false);
    });
  };
  walk(nodes, "", true);
  return lines.join("\n");
}

export function toAsciiDoc(doc: ArchitectDoc): string {
  const header = doc.mode === "live" ? `# ${doc.title ?? "Live folder"} (live)` : `# ${doc.title ?? "Blueprint"}`;
  const body = toAsciiTree(doc.roots);
  return `${header}\n\n${body}\n`;
}
