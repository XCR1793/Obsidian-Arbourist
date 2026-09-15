declare module "arbourist-node-io" {
  export function existsSync(absPath: string): boolean;
  export function basename(absPath: string): string;
  export function joinPaths(left: string, right: string): string;
  export function readDirEntries(absPath: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
}
