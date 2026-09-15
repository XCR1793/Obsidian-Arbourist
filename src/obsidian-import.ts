import { App, TFolder } from "obsidian";
import { mergeLiveScan } from "./merge";
import { type ArchNode, type ArchitectDoc } from "./model";
import { buildTreeFromLister, DEFAULT_SCAN, docFromImport, scanFsFolder, type ScanOptions } from "./scan";
import type { ImportDraft } from "./ui";

export async function scanVaultFolder(app: App, vaultPath: string, options: Partial<ScanOptions> = {}): Promise<ArchNode> {
  const folder =
    !vaultPath || vaultPath === "/"
      ? app.vault.getRoot()
      : app.vault.getAbstractFileByPath(vaultPath);
  if (!(folder instanceof TFolder)) {
    throw new Error(`Vault folder not found: ${vaultPath || "/"}`);
  }
  const rootName = folder.name || app.vault.getName() || "vault";
  const rootRel = folder.path;
  const opts: ScanOptions = {
    ...DEFAULT_SCAN,
    sourceKind: "vault",
    ...options,
    ignore: [...DEFAULT_SCAN.ignore, ...(options.ignore ?? []), app.vault.configDir],
  };
  return buildTreeFromLister(
    rootName,
    rootRel,
    async (rel) => {
      const target = rel ? app.vault.getAbstractFileByPath(rel) : app.vault.getRoot();
      if (!(target instanceof TFolder)) return [];
      return target.children.map((child) => ({
        name: child.name,
        isDirectory: child instanceof TFolder,
      }));
    },
    opts,
  );
}

export async function importDraftToDoc(
  app: App,
  draft: ImportDraft,
  existingId?: string,
  maxDepth = 20,
): Promise<ArchitectDoc> {
  const options: Partial<ScanOptions> = {
    includeFiles: draft.includeFiles,
    linkFiles: draft.linkFiles && draft.sourceKind === "vault",
    sourceKind: draft.sourceKind,
    maxDepth,
  };
  const root =
    draft.sourceKind === "vault"
      ? await scanVaultFolder(app, draft.path, options)
      : await scanFsFolder(draft.path, options);
  return docFromImport({
    root,
    mode: draft.mode,
    sourcePath: draft.path,
    sourceKind: draft.sourceKind,
    includeFiles: draft.includeFiles,
    linkFiles: Boolean(options.linkFiles),
    existingId,
  });
}

export async function refreshLiveDoc(app: App, doc: ArchitectDoc): Promise<ArchitectDoc> {
  if (doc.mode !== "live" || !doc.sourcePath || !doc.sourceKind) {
    throw new Error("This blueprint is not a live folder view.");
  }
  const options: Partial<ScanOptions> = {
    includeFiles: doc.includeFiles,
    linkFiles: doc.linkFiles,
    sourceKind: doc.sourceKind,
  };
  const root =
    doc.sourceKind === "vault"
      ? await scanVaultFolder(app, doc.sourcePath, options)
      : await scanFsFolder(doc.sourcePath, options);
  return mergeLiveScan(doc, root);
}

export async function pickComputerFolder(): Promise<string | null> {
  const attempts: Array<() => Promise<string | null>> = [
    async () => {
      const electron = loadNodeModule<{
        remote?: { dialog?: ElectronDialog; getCurrentWindow?: () => unknown };
        dialog?: ElectronDialog;
      }>("electron");
      const dialog = electron?.remote?.dialog ?? electron?.dialog;
      if (!dialog?.showOpenDialog) return null;
      const parent = electron?.remote?.getCurrentWindow?.();
      const result = await dialog.showOpenDialog(parent, {
        title: "Choose a folder to import",
        properties: ["openDirectory"],
      });
      if (result?.canceled) return null;
      return result?.filePaths?.[0] ?? null;
    },
    async () => {
      const remote = loadNodeModule<{
        dialog: ElectronDialog;
        getCurrentWindow: () => unknown;
      }>("@electron/remote");
      if (!remote?.dialog?.showOpenDialog) return null;
      const result = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
        title: "Choose a folder to import",
        properties: ["openDirectory"],
      });
      if (result?.canceled) return null;
      return result?.filePaths?.[0] ?? null;
    },
  ];
  for (const attempt of attempts) {
    try {
      const picked = await attempt();
      if (picked) return picked;
    } catch {
      // try next API
    }
  }
  return null;
}

interface ElectronDialog {
  showOpenDialog: (
    window: unknown,
    options: { title: string; properties: string[] },
  ) => Promise<{ canceled?: boolean; filePaths?: string[] }>;
}

function loadNodeModule<T>(id: string): T | null {
  const req = (globalThis as { require?: (name: string) => T }).require;
  if (typeof req !== "function") return null;
  try {
    return req(id);
  } catch {
    return null;
  }
}
