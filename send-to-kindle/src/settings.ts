import { App, PluginSettingTab, Setting } from "obsidian";
import type SendToKindlePlugin from "./main";

/** "auto" = USB when a Kindle is plugged in, otherwise email. */
export type DefaultDelivery = "auto" | "email" | "usb" | "epub";

export interface SentRecord {
	/** ISO timestamp of the send. */
	at: string;
	delivery: "email" | "usb";
}

export interface SendToKindleSettings {
	toolsDir: string;
	defaultDelivery: DefaultDelivery;
	ejectAfterUsb: boolean;
	showHeaderButton: boolean;
	showRibbonIcon: boolean;
	kindleMount: string;
	extraPath: string;
	/** Empty = a temporary folder. */
	outDir: string;
	/** Vault path -> last time the note was sent. */
	sent: Record<string, SentRecord>;
}

export const DEFAULT_SETTINGS: SendToKindleSettings = {
	toolsDir: "~/code/mikko/kindle-epub",
	defaultDelivery: "auto",
	ejectAfterUsb: true,
	showHeaderButton: true,
	showRibbonIcon: true,
	kindleMount: "/Volumes/Kindle",
	extraPath: "/opt/homebrew/bin:/usr/local/bin",
	outDir: "",
	sent: {},
};

export class SendToKindleSettingTab extends PluginSettingTab {
	plugin: SendToKindlePlugin;

	constructor(app: App, plugin: SendToKindlePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const { settings } = this.plugin;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Default delivery")
			.setDesc(
				"What the Send to Kindle button does. Email goes through Amazon's Send to Kindle (best typesetting, needs Wi-Fi on the Kindle). USB copies straight onto a plugged-in Kindle.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("auto", "USB if the Kindle is plugged in, otherwise email")
					.addOption("email", "Always email")
					.addOption("usb", "Always USB")
					.addOption("epub", "Only build the EPUB and show it in Finder")
					.setValue(settings.defaultDelivery)
					.onChange(async (value) => {
						settings.defaultDelivery = value as DefaultDelivery;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Eject after USB copy")
			.setDesc("Eject the Kindle once the book is on it, so it is ready to read.")
			.addToggle((toggle) =>
				toggle.setValue(settings.ejectAfterUsb).onChange(async (value) => {
					settings.ejectAfterUsb = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Button in the note header")
			.setDesc("Show a Send to Kindle button at the top right of every note.")
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

		new Setting(containerEl).setName("Advanced").setHeading();

		new Setting(containerEl)
			.setName("kindle-epub folder")
			.setDesc("The checkout that contains bin/md2epub. It does the conversion and sending.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.toolsDir)
					.setValue(settings.toolsDir)
					.onChange(async (value) => {
						settings.toolsDir = value.trim() || DEFAULT_SETTINGS.toolsDir;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Kindle mount point")
			.setDesc("Where the Kindle appears when plugged in.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.kindleMount)
					.setValue(settings.kindleMount)
					.onChange(async (value) => {
						settings.kindleMount = value.trim() || DEFAULT_SETTINGS.kindleMount;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Extra PATH")
			.setDesc(
				"Folders to search for pandoc and Calibre. Obsidian started from the Dock does not see your shell's PATH.",
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

		new Setting(containerEl)
			.setName("EPUB folder")
			.setDesc("Where built EPUBs are written. Leave empty for a temporary folder.")
			.addText((text) =>
				text
					.setPlaceholder("temporary folder")
					.setValue(settings.outDir)
					.onChange(async (value) => {
						settings.outDir = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}
