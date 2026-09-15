import { App, FuzzySuggestModal, TFolder } from "obsidian";

export class VaultFolderModal extends FuzzySuggestModal<TFolder> {
  constructor(
    app: App,
    private onPick: (path: string) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose a folder in this vault…");
  }

  getItems(): TFolder[] {
    const root = this.app.vault.getRoot();
    const folders: TFolder[] = [root];
    const walk = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          folders.push(child);
          walk(child);
        }
      }
    };
    walk(root);
    return folders;
  }

  getItemText(folder: TFolder): string {
    return folder.path || "/";
  }

  onChooseItem(folder: TFolder): void {
    this.onPick(folder.path || "/");
  }
}

export function pickVaultFolder(app: App): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const modal = new VaultFolderModal(app, (path) => {
      settled = true;
      resolve(path);
    });
    const close = modal.onClose.bind(modal);
    modal.onClose = () => {
      close();
      if (!settled) resolve(null);
    };
    modal.open();
  });
}
