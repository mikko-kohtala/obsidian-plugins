import { App, PluginSettingTab, Setting } from "obsidian";
import type { PermissionMode } from "./claude";
import type FixMarkdownPlugin from "./main";

/** When the report panel opens: as the fix starts, when it ends, or only from the notice. */
export type ShowReport = "start" | "finish" | "notice";

export interface FixMarkdownSettings {
	showReport: ShowReport;
	claudePath: string;
	/** Name of the skill in the vault's .claude/skills. */
	skill: string;
	permissionMode: PermissionMode;
	model: string;
	timeoutMinutes: number;
	/** Notes under these folders ask before a fix (one folder per line). */
	confirmFolders: string;
	/** …unless they are under one of these (one folder per line). */
	confirmExceptions: string;
	showHeaderButton: boolean;
	showRibbonIcon: boolean;
	extraPath: string;
}

export const DEFAULT_SETTINGS: FixMarkdownSettings = {
	showReport: "start",
	claudePath: "~/.local/bin/claude",
	skill: "fix-markdown-file",
	permissionMode: "auto",
	model: "",
	timeoutMinutes: 20,
	confirmFolders: "wiki/sources/",
	confirmExceptions: "wiki/sources/_unsorted/",
	showHeaderButton: true,
	showRibbonIcon: true,
	extraPath: "~/.local/bin:/opt/homebrew/bin:/usr/local/bin",
};

export function folderList(value: string): string[] {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((folder) => (folder.endsWith("/") ? folder : `${folder}/`));
}

export class FixMarkdownSettingTab extends PluginSettingTab {
	plugin: FixMarkdownPlugin;

	constructor(app: App, plugin: FixMarkdownPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const { settings } = this.plugin;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Open the report panel")
			.setDesc(
				"The panel in the right sidebar shows what Claude is doing, then its report, the changes to the note line by line (with Undo) and any new attachments.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("start", "Right away, to watch the fix live")
					.addOption("finish", "When the fix is done")
					.addOption("notice", "Only when I click the notice")
					.setValue(settings.showReport)
					.onChange(async (value) => {
						settings.showReport = value as ShowReport;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("What Claude may do")
			.setDesc(
				"Nobody is there to approve prompts, so this decides what a run can do on its own. Auto lets Claude Code's safety classifier approve each action. Dry run changes nothing and only reports what it would fix.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("auto", "Auto (classifier approves safe actions)")
					.addOption("acceptEdits", "Edits only (commands and downloads are refused)")
					.addOption("plan", "Dry run (report only)")
					.setValue(settings.permissionMode)
					.onChange(async (value) => {
						settings.permissionMode = value as PermissionMode;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Button in the note header")
			.setDesc("Show a Fix Markdown button at the top right of every note.")
			.addToggle((toggle) =>
				toggle.setValue(settings.showHeaderButton).onChange(async (value) => {
					settings.showHeaderButton = value;
					await this.plugin.saveSettings();
					this.plugin.syncHeaderButtons();
				}),
			);

		new Setting(containerEl).setName("Icon in the left ribbon").addToggle((toggle) =>
			toggle.setValue(settings.showRibbonIcon).onChange(async (value) => {
				settings.showRibbonIcon = value;
				await this.plugin.saveSettings();
				this.plugin.syncRibbonIcon();
			}),
		);

		new Setting(containerEl)
			.setName("Ask before fixing notes in")
			.setDesc("One folder per line. Notes here are treated as finished, so a fix asks first.")
			.addTextArea((area) =>
				area.setValue(settings.confirmFolders).onChange(async (value) => {
					settings.confirmFolders = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("…except in")
			.setDesc("One folder per line. Fresh clips land here and are fixed without asking.")
			.addTextArea((area) =>
				area.setValue(settings.confirmExceptions).onChange(async (value) => {
					settings.confirmExceptions = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Advanced").setHeading();

		new Setting(containerEl)
			.setName("Claude Code path")
			.setDesc(
				"The local claude command. It runs on its own login; API keys are never passed to it.",
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.claudePath)
					.setValue(settings.claudePath)
					.onChange(async (value) => {
						settings.claudePath = value.trim() || DEFAULT_SETTINGS.claudePath;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Skill")
			.setDesc("The skill in the vault's .claude/skills folder that does the fixing.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.skill)
					.setValue(settings.skill)
					.onChange(async (value) => {
						settings.skill = value.trim() || DEFAULT_SETTINGS.skill;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Model")
			.setDesc("Leave empty for Claude Code's default. Otherwise an alias such as opus or sonnet.")
			.addText((text) =>
				text
					.setPlaceholder("default")
					.setValue(settings.model)
					.onChange(async (value) => {
						settings.model = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Time limit (minutes)")
			.setDesc("A run that takes longer is stopped.")
			.addText((text) =>
				text.setValue(String(settings.timeoutMinutes)).onChange(async (value) => {
					const minutes = Number(value);
					if (!Number.isFinite(minutes) || minutes < 1) return;
					settings.timeoutMinutes = minutes;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Extra PATH")
			.setDesc(
				"Folders to search for tools the skill uses (python3, rsvg-convert). Obsidian started from the Dock does not see your shell's PATH.",
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.extraPath)
					.setValue(settings.extraPath)
					.onChange(async (value) => {
						settings.extraPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}
