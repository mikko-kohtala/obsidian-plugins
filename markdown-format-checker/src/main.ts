import { MarkdownView, Notice, Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	MarkdownFormatCheckerSettingTab,
	migrateModel,
	type MarkdownFormatCheckerSettings,
} from "./settings";
import { registerCheckFormattingCommand } from "./commands/checkFormatting";

export default class MarkdownFormatCheckerPlugin extends Plugin {
	settings: MarkdownFormatCheckerSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addRibbonIcon(
			"check-circle",
			"Check Markdown Formatting",
			() => {
				const view =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) {
					new Notice(
						"Open a markdown file to check its formatting."
					);
					return;
				}
				(this.app as any).commands.executeCommandById(
					"markdown-format-checker:check-formatting"
				);
			}
		);

		registerCheckFormattingCommand(this);

		this.addSettingTab(
			new MarkdownFormatCheckerSettingTab(this.app, this)
		);
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Record<string, unknown> | null;
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			saved,
		) as MarkdownFormatCheckerSettings;
		this.settings.claudeModel = migrateModel(this.settings.claudeModel);

		const deprecated = ["effortLevel", "claudeBinaryPath", "geminiBinaryPath"];
		const settingsObj = this.settings as unknown as Record<string, unknown>;
		if (saved && deprecated.some((k) => k in saved)) {
			for (const key of deprecated) delete settingsObj[key];
			await this.saveSettings();
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
