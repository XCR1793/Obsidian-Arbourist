import { App, PluginSettingTab, Setting } from "obsidian";
import type FolderArchitectPlugin from "./main";

export interface ArchitectSettings {
  defaultIncludeFiles: boolean;
  defaultLinkFiles: boolean;
  maxDepth: number;
  blueprintsFolder: string;
  commentsByFolder: Record<string, Record<string, string>>;
}

export const DEFAULT_SETTINGS: ArchitectSettings = {
  defaultIncludeFiles: true,
  defaultLinkFiles: false,
  maxDepth: 20,
  blueprintsFolder: "Blueprints",
  commentsByFolder: {},
};

export class ArchitectSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: FolderArchitectPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Arbourist" });

    new Setting(containerEl)
      .setName("Blueprints folder")
      .setDesc("New blueprints are created here.")
      .addText((text) =>
        text.setValue(this.plugin.settings.blueprintsFolder).onChange(async (value) => {
          this.plugin.settings.blueprintsFolder = value.trim() || "Blueprints";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Import files by default")
      .setDesc("When importing, include files as well as folders.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.defaultIncludeFiles).onChange(async (value) => {
          this.plugin.settings.defaultIncludeFiles = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Create wikilinks by default")
      .setDesc("Only applies to vault imports. Leave off if you want a copy of a structure that may not exist anymore.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.defaultLinkFiles).onChange(async (value) => {
          this.plugin.settings.defaultLinkFiles = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Max import depth")
      .setDesc("Prevents runaway scans of huge trees.")
      .addSlider((slider) =>
        slider
          .setLimits(2, 40, 1)
          .setValue(this.plugin.settings.maxDepth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxDepth = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
