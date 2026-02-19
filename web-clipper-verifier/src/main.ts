import { MarkdownView, Notice, Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	WebClipperVerifierSettingTab,
	migrateModel,
	type WebClipperVerifierSettings,
} from "./settings";
import { registerVerifyClippingCommand } from "./commands/verifyClipping";

export default class WebClipperVerifierPlugin extends Plugin {
	settings: WebClipperVerifierSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addRibbonIcon(
			"clipboard-check",
			"Verify Web Clipping",
			() => {
				const view =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) {
					new Notice(
						"Open a web clipping file to verify it."
					);
					return;
				}
				(this.app as any).commands.executeCommandById(
					"web-clipper-verifier:verify-clipping"
				);
			}
		);

		registerVerifyClippingCommand(this);

		this.addSettingTab(
			new WebClipperVerifierSettingTab(this.app, this)
		);
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Record<string, unknown> | null;
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			saved,
		) as WebClipperVerifierSettings;
		this.settings.claudeModel = migrateModel(this.settings.claudeModel);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
