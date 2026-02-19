import { App, PluginSettingTab, Setting } from "obsidian";
import type MarkdownFormatCheckerPlugin from "./main";

export interface MarkdownFormatCheckerSettings {
	provider: "claude" | "gemini";
	claudeBinaryPath: string;
	claudeModel: string;
	effortLevel: "low" | "medium" | "high";
	geminiBinaryPath: string;
	geminiModel: string;
	timeoutMs: number;
	customPromptAdditions: string;
}

export const DEFAULT_SETTINGS: MarkdownFormatCheckerSettings = {
	provider: "claude",
	claudeBinaryPath: "~/.local/bin/claude",
	claudeModel: "claude-haiku-4-5",
	effortLevel: "low",
	geminiBinaryPath: "~/.local/share/mise/installs/node/24.11.0/bin/gemini",
	geminiModel: "gemini-3-flash-preview",
	timeoutMs: 120000,
	customPromptAdditions: "",
};

const MODEL_ALIASES: Record<string, string> = {
	haiku: "claude-haiku-4-5",
	sonnet: "claude-sonnet-4-6",
	opus: "claude-opus-4-6",
};

export function migrateModel(model: string): string {
	return MODEL_ALIASES[model] ?? model;
}

export class MarkdownFormatCheckerSettingTab extends PluginSettingTab {
	plugin: MarkdownFormatCheckerPlugin;

	constructor(app: App, plugin: MarkdownFormatCheckerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const isClaude = this.plugin.settings.provider === "claude";

		new Setting(containerEl)
			.setName("AI provider")
			.setDesc("Which AI CLI to use for format checking.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("claude", "Claude")
					.addOption("gemini", "Gemini")
					.setValue(this.plugin.settings.provider)
					.onChange(async (value) => {
						this.plugin.settings.provider = value as "claude" | "gemini";
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (isClaude) {
			new Setting(containerEl)
				.setName("Claude binary path")
				.setDesc(
					"Path to the Claude Code CLI binary. Use \"claude\" if it's in your PATH, or set the full path (e.g., ~/.local/bin/claude)."
				)
				.addText((text) =>
					text
						.setPlaceholder("~/.local/bin/claude")
						.setValue(this.plugin.settings.claudeBinaryPath)
						.onChange(async (value) => {
							this.plugin.settings.claudeBinaryPath = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Model")
				.setDesc(
					"Claude model to use. Haiku is fast and cheap, Sonnet is more capable."
				)
				.addDropdown((dropdown) =>
					dropdown
						.addOption("claude-haiku-4-5", "Haiku (fast)")
						.addOption("claude-sonnet-4-6", "Sonnet")
						.addOption("claude-opus-4-6", "Opus")
						.setValue(this.plugin.settings.claudeModel)
						.onChange(async (value) => {
							this.plugin.settings.claudeModel = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Effort level")
				.setDesc(
					"Controls thinking depth. Low is fast with minimal reasoning, high enables deep analysis."
				)
				.addDropdown((dropdown) =>
					dropdown
						.addOption("low", "Low (fast)")
						.addOption("medium", "Medium")
						.addOption("high", "High (thorough)")
						.setValue(this.plugin.settings.effortLevel)
						.onChange(async (value) => {
							this.plugin.settings.effortLevel = value as "low" | "medium" | "high";
							await this.plugin.saveSettings();
						})
				);
		} else {
			new Setting(containerEl)
				.setName("Gemini binary path")
				.setDesc(
					"Path to the Gemini CLI binary. Use \"gemini\" if it's in your PATH, or set the full path."
				)
				.addText((text) =>
					text
						.setPlaceholder("~/.local/share/mise/installs/node/24.11.0/bin/gemini")
						.setValue(this.plugin.settings.geminiBinaryPath)
						.onChange(async (value) => {
							this.plugin.settings.geminiBinaryPath = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Model")
				.setDesc("Gemini model to use.")
				.addDropdown((dropdown) =>
					dropdown
						.addOption("gemini-3-flash-preview", "Gemini 3 Flash (preview)")
						.addOption("gemini-2.5-flash", "Gemini 2.5 Flash")
						.setValue(this.plugin.settings.geminiModel)
						.onChange(async (value) => {
							this.plugin.settings.geminiModel = value;
							await this.plugin.saveSettings();
						})
				);
		}

		new Setting(containerEl)
			.setName("Timeout (seconds)")
			.setDesc("Maximum time to wait for a response.")
			.addText((text) =>
				text
					.setPlaceholder("60")
					.setValue(String(this.plugin.settings.timeoutMs / 1000))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (!isNaN(parsed) && parsed > 0) {
							this.plugin.settings.timeoutMs = parsed * 1000;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Custom prompt additions")
			.setDesc(
				"Additional instructions appended to the formatting check prompt. Use this to add custom rules or preferences."
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("e.g., Always use dashes for list markers...")
					.setValue(this.plugin.settings.customPromptAdditions)
					.onChange(async (value) => {
						this.plugin.settings.customPromptAdditions = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
