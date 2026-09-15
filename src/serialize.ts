import { emptyDoc, type ArchitectDoc } from "./model";

const FENCE = "arbourist";

export function stringifyDoc(doc: ArchitectDoc): string {
  return JSON.stringify(doc, null, 2);
}

export function parseDoc(raw: string): ArchitectDoc {
  const parsed = JSON.parse(raw) as Partial<ArchitectDoc>;
  const base = emptyDoc();
  return {
    ...base,
    ...parsed,
    version: 1,
    roots: Array.isArray(parsed.roots) ? parsed.roots : [],
    annotations: parsed.annotations ?? {},
    includeFiles: parsed.includeFiles !== false,
    linkFiles: Boolean(parsed.linkFiles),
    mode: parsed.mode === "live" ? "live" : "design",
  };
}

export function extractBlocks(markdown: string): { start: number; end: number; json: string; doc: ArchitectDoc }[] {
  const re = /```arbourist\s*\r?\n([\s\S]*?)```/g;
  const blocks: { start: number; end: number; json: string; doc: ArchitectDoc }[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown))) {
    const json = match[1] ?? "";
    try {
      blocks.push({
        start: match.index,
        end: match.index + match[0].length,
        json,
        doc: parseDoc(json),
      });
    } catch {
      // skip malformed
    }
  }
  return blocks;
}

export function upsertArchitectBlock(markdown: string, doc: ArchitectDoc): string {
  const json = stringifyDoc(doc);
  const block = "```" + FENCE + "\n" + json + "\n```";
  const blocks = extractBlocks(markdown);
  const existing = blocks.find((item) => item.doc.id === doc.id) ?? blocks[0];
  if (existing) {
    return markdown.slice(0, existing.start) + block + markdown.slice(existing.end);
  }
  const trimmed = markdown.replace(/\s*$/, "");
  return (trimmed ? trimmed + "\n\n" : "") + block + "\n";
}

export function newBlueprintMarkdown(doc: ArchitectDoc): string {
  const title = doc.title?.trim() || "Untitled blueprint";
  return [
    `# ${title}`,
    "",
    "Design a folder structure here. Import a folder as a snapshot or a live view, add descriptions, then rebuild it on disk when you are ready.",
    "",
    "```" + FENCE,
    stringifyDoc(doc),
    "```",
    "",
  ].join("\n");
}

export function isArchitectMarkdown(markdown: string): boolean {
  return extractBlocks(markdown).length > 0;
}
