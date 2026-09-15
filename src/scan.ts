import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { buildTreeFromLister, DEFAULT_SCAN, type ScanOptions } from "./scan-core";
import type { ArchNode } from "./model";

export {
  buildTreeFromLister,
  DEFAULT_SCAN,
  docFromImport,
  treeFromRelativePaths,
  type DirEntry,
  type ScanOptions,
} from "./scan-core";

interface NodeDirent {
  name: string;
  isDirectory(): boolean;
}

interface NodeFs {
  existsSync(path: string): boolean;
  promises: {
    readdir(path: string, options: { withFileTypes: true }): Promise<NodeDirent[]>;
  };
}

interface NodePath {
  basename(path: string): string;
  join(...paths: string[]): string;
}

const fs: NodeFs = nodeFs as unknown as NodeFs;
const path: NodePath = nodePath as unknown as NodePath;

export async function scanFsFolder(absPath: string, options: Partial<ScanOptions> = {}): Promise<ArchNode> {
  if (!fs.existsSync(absPath)) throw new Error(`Folder not found: ${absPath}`);
  const opts: ScanOptions = { ...DEFAULT_SCAN, sourceKind: "fs", ...options };
  const rootName = path.basename(absPath.replace(/[\\/]+$/, "")) || absPath;
  return buildTreeFromLister(rootName, rootName, async (rel) => {
    const suffix = rel === rootName ? "" : rel.slice(rootName.length).replace(/^[/\\]/, "");
    const full = suffix ? path.join(absPath, suffix) : absPath;
    const names = await fs.promises.readdir(full, { withFileTypes: true });
    return names.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }));
  }, opts);
}

export function fsFolderExists(absPath: string): boolean {
  return fs.existsSync(absPath);
}
