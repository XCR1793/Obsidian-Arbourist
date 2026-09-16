import { App, FuzzySuggestModal, Modal, Setting, TFile, TFolder } from "obsidian";

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

export class BlueprintFileModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private files: TFile[],
    private onPick: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose a blueprint note…");
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path.replace(/\.md$/i, "");
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}

export function pickBlueprintFile(app: App, files: TFile[]): Promise<TFile | null> {
  return new Promise((resolve) => {
    if (files.length === 0) {
      resolve(null);
      return;
    }
    let settled = false;
    const modal = new BlueprintFileModal(app, files, (file) => {
      settled = true;
      resolve(file);
    });
    const close = modal.onClose.bind(modal);
    modal.onClose = () => {
      close();
      if (!settled) resolve(null);
    };
    modal.open();
  });
}

export function promptSaveBlueprint(
  app: App,
  defaults: { folder: string; name: string },
): Promise<{ folder: string; name: string } | null> {
  return new Promise((resolve) => {
    new SaveBlueprintModal(app, defaults, resolve).open();
  });
}

class SaveBlueprintModal extends Modal {
  private folder: string;
  private name: string;
  private settled = false;

  constructor(
    app: App,
    defaults: { folder: string; name: string },
    private onDone: (value: { folder: string; name: string } | null) => void,
  ) {
    super(app);
    this.folder = defaults.folder;
    this.name = defaults.name;
  }

  onOpen(): void {
    this.titleEl.setText("Save blueprint");
    const { contentEl } = this;
    contentEl.empty();

    let folderField: HTMLInputElement | null = null;
    new Setting(contentEl)
      .setName("Folder")
      .setDesc("Vault folder for the note.")
      .addText((text) => {
        folderField = text.inputEl;
        text.setValue(this.folder).onChange((value) => {
          this.folder = value.trim();
        });
      })
      .addButton((button) =>
        button.setButtonText("Browse").onClick(() => {
          void (async () => {
            const picked = await pickVaultFolder(this.app);
            if (!picked) return;
            this.folder = picked === "/" ? "" : picked.replace(/^\//, "");
            if (folderField) folderField.value = this.folder;
          })();
        }),
      );

    new Setting(contentEl)
      .setName("File name")
      .addText((text) => {
        text.setValue(this.name).onChange((value) => {
          this.name = value;
        });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.submit();
          }
        });
        window.setTimeout(() => text.inputEl.focus(), 20);
      });

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => {
          this.close();
        }),
      )
      .addButton((button) =>
        button.setButtonText("Save").setCta().onClick(() => {
          this.submit();
        }),
      );
  }

  private submit(): void {
    const name = this.name.trim().replace(/\.md$/i, "");
    if (!name) return;
    this.settled = true;
    this.close();
    this.onDone({ folder: this.folder.trim().replace(/^\/+|\/+$/g, ""), name });
  }

  onClose(): void {
    if (!this.settled) this.onDone(null);
  }
}
