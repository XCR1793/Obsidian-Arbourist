export interface EmbedQuery {
  path: string;
  display: "live" | "static";
  comments: boolean;
  files: boolean;
  links: boolean;
  depth: number;
  filter: string;
  ext: string;
  refresh: boolean;
  explicit: boolean;
}

const REFRESH_KEYS = new Set(["refresh", "rebake", "reload"]);

const OPTION_KEYS = new Set([
  "display",
  "mode",
  "comments",
  "comment",
  "files",
  "file",
  "folders",
  "links",
  "link",
  "depth",
  "filter",
  "tag",
  "tags",
  "ext",
  "extension",
  "refresh",
  "rebake",
  "reload",
]);

function splitComma(raw: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const char of raw) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ",") {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseBool(value: string, fallback: boolean): boolean {
  const v = value.trim().toLowerCase();
  if (["off", "disable", "disabled", "false", "no", "0"] .includes(v)) return false;
  if (["on", "enable", "enabled", "true", "yes", "1", ""] .includes(v)) return true;
  return fallback;
}

function parsePair(token: string): { key: string; value: string } | null {
  const colon = token.indexOf(":");
  const eq = token.indexOf("=");
  const idx = colon >= 0 && (eq < 0 || colon < eq) ? colon : eq;
  if (idx <= 0) return null;
  return {
    key: token.slice(0, idx).trim().toLowerCase(),
    value: token.slice(idx + 1).trim(),
  };
}

export function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

export function parseEmbedQuery(raw: string, defaults?: Partial<EmbedQuery>): EmbedQuery | null {
  const text = raw.trim();
  if (!text) return null;
  const parts = splitComma(text);
  if (parts.length === 0) return null;

  const query: EmbedQuery = {
    path: "",
    display: "live",
    comments: false,
    files: true,
    links: false,
    depth: 20,
    filter: "",
    ext: "",
    refresh: false,
    explicit: false,
    ...defaults,
  };

  const first = parts[0] ?? "";
  const firstPair = parsePair(first);
  let start = 0;
  if (firstPair && OPTION_KEYS.has(firstPair.key)) {
    start = 0;
  } else {
    query.path = normalizeVaultPath(first.replace(/^\[\[|\]\]$/g, ""));
    start = 1;
  }

  for (const token of parts.slice(start)) {
    if (token.toLowerCase() === "folders" || token.toLowerCase() === "folders-only") {
      query.files = false;
      query.explicit = true;
      continue;
    }
    if (REFRESH_KEYS.has(token.toLowerCase())) {
      query.refresh = true;
      query.explicit = true;
      continue;
    }
    const pair = parsePair(token);
    if (!pair || !OPTION_KEYS.has(pair.key)) continue;
    query.explicit = true;
    switch (pair.key) {
      case "display":
      case "mode": {
        const value = pair.value.toLowerCase();
        query.display = ["snapshot", "design", "static", "once"].includes(value) ? "static" : "live";
        break;
      }
      case "comments":
      case "comment":
        query.comments = parseBool(pair.value, true);
        break;
      case "files":
      case "file":
        query.files = parseBool(pair.value, true);
        break;
      case "folders":
        query.files = false;
        break;
      case "links":
      case "link":
        query.links = parseBool(pair.value, true);
        break;
      case "depth": {
        const depth = Number(pair.value);
        if (Number.isFinite(depth) && depth > 0) query.depth = Math.floor(depth);
        break;
      }
      case "filter":
      case "tag":
      case "tags":
        query.filter = pair.value;
        break;
      case "ext":
      case "extension":
        query.ext = pair.value.replace(/^\./, "");
        break;
      case "refresh":
      case "rebake":
      case "reload":
        query.refresh = parseBool(pair.value, true);
        break;
      default:
        break;
    }
  }

  if (!query.path && !query.explicit) return null;
  return query;
}

export function toEmbedMarkdown(query: EmbedQuery): string {
  const bits = [query.path ? `/${query.path}` : "/"];
  bits.push(`display:${query.display}`);
  bits.push(`comments:${query.comments ? "enable" : "disable"}`);
  if (!query.files) bits.push("files:off");
  if (query.links) bits.push("links:on");
  if (query.filter) bits.push(`filter:${query.filter}`);
  if (query.ext) bits.push(`ext:${query.ext}`);
  if (query.depth !== 20) bits.push(`depth:${query.depth}`);
  return `![[${bits.join(", ")}]]`;
}

export function stripRefreshFromSrc(src: string): string {
  const wrapped = src.trim();
  const inner = wrapped.replace(/^!\[\[/, "").replace(/\]\]$/, "").trim();
  const parts = splitComma(inner).filter((token) => {
    const lower = token.toLowerCase();
    if (REFRESH_KEYS.has(lower)) return false;
    const pair = parsePair(token);
    if (pair && REFRESH_KEYS.has(pair.key)) return false;
    return true;
  });
  return parts.join(", ");
}
