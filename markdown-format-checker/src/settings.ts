import { App, PluginSettingTab, Setting } from "obsidian";
import type MarkdownFormatCheckerPlugin from "./main";

export interface MarkdownFormatCheckerSettings {
	provider: "claude" | "gemini" | "moonshot";
	claudeModel: string;
	geminiModel: string;
	moonshotModel: string;
	timeoutMs: number;
	customPromptAdditions: string;
	debugLogs: boolean;
}

export const DEFAULT_SETTINGS: MarkdownFormatCheckerSettings = {
	provider: "claude",
	claudeModel: "claude-haiku-4-5",
	geminiModel: "gemini-3-flash-preview",
	moonshotModel: "kimi-k2.5",
	timeoutMs: 120000,
	customPromptAdditions: "",
	debugLogs: false,
};

export const SECRET_IDS = {
	claude: "format-checker-claude-api-key",
	gemini: "format-checker-gemini-api-key",
	moonshot: "format-checker-moonshot-api-key",
} as const;

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
			.setDesc("Which AI provider to use for format checking.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("claude", "Claude")
					.addOption("gemini", "Gemini")
					.addOption("moonshot", "Moonshot AI")
					.setValue(this.plugin.settings.provider)
					.onChange(async (value) => {
						this.plugin.settings.provider = value as "claude" | "gemini" | "moonshot";
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (isClaude) {
			this.addSecretSetting(containerEl, {
				name: "API key",
				desc: "Anthropic API key. Get one from console.anthropic.com.",
				placeholder: "sk-ant-...",
				secretId: SECRET_IDS.claude,
			});

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
		} else if (this.plugin.settings.provider === "gemini") {
			this.addSecretSetting(containerEl, {
				name: "API key",
				desc: "Google AI API key. Get one from aistudio.google.com.",
				placeholder: "AIza...",
				secretId: SECRET_IDS.gemini,
			});

			new Setting(containerEl)
				.setName("Model")
				.setDesc("Gemini model to use.")
				.addDropdown((dropdown) =>
					dropdown
						.addOption("gemini-3-flash-preview", "Gemini 3 Flash (preview)")
						.addOption("gemini-2.5-flash", "Gemini 2.5 Flash")
						.addOption("gemini-2.5-pro", "Gemini 2.5 Pro")
						.setValue(this.plugin.settings.geminiModel)
						.onChange(async (value) => {
							this.plugin.settings.geminiModel = value;
							await this.plugin.saveSettings();
						})
				);
		} else if (this.plugin.settings.provider === "moonshot") {
			this.addSecretSetting(containerEl, {
				name: "API key",
				desc: "Moonshot AI API key. Get one from platform.moonshot.ai.",
				placeholder: "sk-...",
				secretId: SECRET_IDS.moonshot,
			});

			new Setting(containerEl)
				.setName("Model")
				.setDesc("Moonshot model to use.")
				.addDropdown((dropdown) =>
					dropdown
						.addOption("kimi-k2.5", "Kimi K2.5")
						.addOption("kimi-k2", "Kimi K2")
						.addOption("kimi-k2-turbo", "Kimi K2 Turbo")
						.setValue(this.plugin.settings.moonshotModel)
						.onChange(async (value) => {
							this.plugin.settings.moonshotModel = value;
							await this.plugin.saveSettings();
						})
				);
		}

		new Setting(containerEl)
			.setName("Timeout (seconds)")
			.setDesc("Maximum time to wait for a response.")
			.addText((text) =>
				text
					.setPlaceholder("120")
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

		new Setting(containerEl)
			.setName("Debug logs")
			.setDesc(
				"Log prompts, messages, and AI responses to the developer console."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debugLogs)
					.onChange(async (value) => {
						this.plugin.settings.debugLogs = value;
						await this.plugin.saveSettings();
					})
			);
	}

	private addSecretSetting(containerEl: HTMLElement, opts: {
		name: string;
		desc: string;
		placeholder: string;
		secretId: string;
	}): void {
		const existing = this.app.secretStorage.getSecret(opts.secretId);
		new Setting(containerEl)
			.setName(opts.name)
			.setDesc(opts.desc)
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder(opts.placeholder)
					.setValue(existing ?? "")
					.onChange(async (value) => {
						this.app.secretStorage.setSecret(opts.secretId, value);
					});
			});
	}
}
