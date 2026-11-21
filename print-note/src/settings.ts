import { App, PluginSettingTab, Setting } from "obsidian";
import type PrintNotePlugin from "./main";
import type { PageSize } from "./render";

/** What happens once the PDF is ready. */
export type AfterPdf = "print" | "preview" | "desktop";

export interface PrintNoteSettings {
	after: AfterPdf;
	pageSize: PageSize;
	includeTitle: boolean;
	includeSource: boolean;
	pageNumbers: boolean;
	showHeaderButton: boolean;
	showRibbonIcon: boolean;
}

export const DEFAULT_SETTINGS: PrintNoteSettings = {
	after: "print",
	pageSize: "A4",
	includeTitle: true,
	includeSource: true,
	pageNumbers: true,
	showHeaderButton: true,
	showRibbonIcon: true,
};

export class PrintNoteSettingTab extends PluginSettingTab {
	plugin: PrintNotePlugin;

	constructor(app: App, plugin: PrintNotePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const { settings } = this.plugin;
		containerEl.empty();

		const save = async (): Promise<void> => this.plugin.saveSettings();

		new Setting(containerEl).setName("When the button is pressed").addDropdown((dropdown) =>
			dropdown
				.addOption("print", "Open the print dialog (in Preview)")
				.addOption("preview", "Open the PDF in Preview")
				.addOption("desktop", "Save the PDF to the Desktop")
				.setValue(settings.after)
				.onChange(async (value) => {
					settings.after = value as AfterPdf;
					await save();
				}),
		);

		new Setting(containerEl).setName("Page size").addDropdown((dropdown) =>
			dropdown
				.addOption("A4", "A4")
				.addOption("Letter", "Letter")
				.setValue(settings.pageSize)
				.onChange(async (value) => {
					settings.pageSize = value as PageSize;
					await save();
				}),
		);

		new Setting(containerEl)
			.setName("Title at the top")
			.setDesc("The note's title (or file name) as a heading on the first page.")
			.addToggle((toggle) =>
				toggle.setValue(settings.includeTitle).onChange(async (value) => {
					settings.includeTitle = value;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Author, date and site under the title")
			.setDesc("From the note's author, published and source properties, when it has them.")
			.addToggle((toggle) =>
				toggle.setValue(settings.includeSource).onChange(async (value) => {
					settings.includeSource = value;
					await save();
				}),
			);

		new Setting(containerEl).setName("Page numbers").addToggle((toggle) =>
			toggle.setValue(settings.pageNumbers).onChange(async (value) => {
				settings.pageNumbers = value;
				await save();
			}),
		);

		new Setting(containerEl).setName("Button in the note header").addToggle((toggle) =>
			toggle.setValue(settings.showHeaderButton).onChange(async (value) => {
				settings.showHeaderButton = value;
				await save();
				this.plugin.syncHeaderButtons();
			}),
		);

		new Setting(containerEl).setName("Icon in the left ribbon").addToggle((toggle) =>
			toggle.setValue(settings.showRibbonIcon).onChange(async (value) => {
				settings.showRibbonIcon = value;
				await save();
				this.plugin.syncRibbonIcon();
			}),
		);
	}
}
