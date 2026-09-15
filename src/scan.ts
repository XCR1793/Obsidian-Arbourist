import { existsSync, promises as fs } from "node:fs";
import { basename, join } from "node:path";
import { buildTreeFromLister, DEFAULT_SCAN, type DirEntry, type ScanOptions } from "./scan-core";
import type { ArchNode } from "./model";

export {
  buildTreeFromLister,
  DEFAULT_SCAN,
  docFromImport,
  treeFromRelativePaths,
  type DirEntry,
  type ScanOptions,
} from "./scan-core";

export async function scanFsFolder(absPath: string, options: Partial<ScanOptions> = {}): Promise<ArchNode> {
  if (!existsSync(absPath)) throw new Error(`Folder not found: ${absPath}`);
  const opts: ScanOptions = { ...DEFAULT_SCAN, sourceKind: "fs", ...options };
  const rootName = basename(absPath.replace(/[\\/]+$/, "")) || absPath;
  return buildTreeFromLister(rootName, rootName, async (rel): Promise<DirEntry[]> => {
    const suffix = rel === rootName ? "" : rel.slice(rootName.length).replace(/^[/\\]/, "");
    const full = suffix ? join(absPath, suffix) : absPath;
    const names = await fs.readdir(full, { withFileTypes: true });
    return names.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }));
  }, opts);
}

export function fsFolderExists(absPath: string): boolean {
  return existsSync(absPath);
}
