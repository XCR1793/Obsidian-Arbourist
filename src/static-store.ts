import { toAsciiTree } from "./ascii";
import { type ArchitectDoc } from "./model";
import { stripRefreshFromSrc } from "./query";
import { parseDoc } from "./serialize";

const FENCE_LANG = "arbourist-static";
const FENCE_AFTER = /^(?:\r?\n)*```(?:arbourist-static|text|ascii|plaintext)?\r?\n[\s\S]*?```/;
const LEGACY_STATIC = /%%fa-static[^\n]*\r?\n([\s\S]*?)%%/g;
const LEGACY_AFTER_EMBED = /^(?:\r?\n)*%%fa-static[\s\S]*?%%/;

function asciiFence(ascii: string): string {
  return "```" + FENCE_LANG + "\n" + ascii.replace(/\s+$/, "") + "\n```";
}

function embedNeedles(src: string): string[] {
  const inner = src.replace(/^!\[\[/, "").replace(/\]\]$/, "").trim();
  const variants = new Set([inner, stripRefreshFromSrc(inner)]);
  const needles: string[] = [];
  for (const value of variants) {
    if (!value) continue;
    const unslashed = value.replace(/^\/+/, "");
    needles.push(`![[${value}]]`, `![[/${unslashed}]]`, `![[${unslashed}]]`);
  }
  return [...new Set(needles)];
}

function locateEmbed(markdown: string, src: string): { start: number; end: number; inner: string } | null {
  for (const needle of embedNeedles(src)) {
    const start = markdown.indexOf(needle);
    if (start < 0) continue;
    return {
      start,
      end: start + needle.length,
      inner: needle.slice(3, -2),
    };
  }
  return null;
}

function consumeStore(after: string): number {
  const fence = after.match(FENCE_AFTER);
  if (fence) return fence[0].length;
  const legacy = after.match(LEGACY_AFTER_EMBED);
  if (legacy) return legacy[0].length;
  return 0;
}

export function asciiFromDoc(doc: ArchitectDoc): string {
  return toAsciiTree(doc.roots);
}

export function findBakedAscii(markdown: string, src: string): string | null {
  const loc = locateEmbed(markdown, src);
  if (!loc) return null;
  const after = markdown.slice(loc.end);
  const fence = after.match(FENCE_AFTER);
  if (!fence) return null;
  const body = fence[0].replace(/^(?:\r?\n)*```[^\n]*\r?\n/, "").replace(/```$/, "");
  return body.replace(/\s+$/, "") || null;
}

export function findLegacyStaticDoc(markdown: string, src?: string): ArchitectDoc | null {
  LEGACY_STATIC.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LEGACY_STATIC.exec(markdown))) {
    try {
      const doc = parseDoc(match[1] ?? "");
      if (!src) return doc;
      const path = src.replace(/^\/+/, "").split(",")[0]?.trim();
      if (!path || doc.sourcePath === path || doc.title === path.split("/").pop()) return doc;
    } catch {
      // keep looking
    }
  }
  return null;
}

export function bakeStaticIntoMarkdown(markdown: string, src: string, ascii: string): string {
  const loc = locateEmbed(markdown, src);
  if (!loc) return migrateLegacyStatic(markdown);
  const clean = stripRefreshFromSrc(loc.inner);
  const consume = consumeStore(markdown.slice(loc.end));
  const next =
    markdown.slice(0, loc.start) +
    `![[${clean}]]\n\n` +
    asciiFence(ascii) +
    markdown.slice(loc.end + consume);
  return migrateLegacyStatic(next);
}

export function migrateLegacyStatic(markdown: string): string {
  return markdown.replace(LEGACY_STATIC, (_, json: string) => {
    try {
      return asciiFence(toAsciiTree(parseDoc(json).roots));
    } catch {
      return "";
    }
  });
}
