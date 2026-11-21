import { tmpdir } from "os";
import { join } from "path";
import { FileSystemAdapter, MarkdownView, Notice, Platform, Plugin, TFile } from "obsidian";
import { confirm } from "./confirmModal";
import {
	buildEpub,
	deliver,
	kindleMounted,
	KindleError,
	revealInFinder,
	type Delivery,
	type ToolOptions,
} from "./kindle";
import {
	DEFAULT_SETTINGS,
	SendToKindleSettingTab,
	type DefaultDelivery,
	type SendToKindleSettings,
} from "./settings";

const ICON = "send";
const LABEL = "Send to Kindle";
const TAG = "[send-to-kindle]";

export default class SendToKindlePlugin extends Plugin {
	settings: SendToKindleSettings = DEFAULT_SETTINGS;

	private busy = false;
	private ribbonIcon: HTMLElement | null = null;
	private readonly headerButtons = new Map<MarkdownView, HTMLElement>();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addCommand({
			id: "send",
			name: "Send current note to Kindle",
			checkCallback: (checking) => this.forActiveNote(checking, this.settings.defaultDelivery),
		});
		this.addCommand({
			id: "send-email",
			name: "Send current note to Kindle by email",
			checkCallback: (checking) => this.forActiveNote(checking, "email"),
		});
		this.addCommand({
			id: "send-usb",
			name: "Copy current note to Kindle over USB",
			checkCallback: (checking) => this.forActiveNote(checking, "usb"),
		});
		this.addCommand({
			id: "build-epub",
			name: "Build EPUB of current note and show it in Finder",
			checkCallback: (checking) => this.forActiveNote(checking, "epub"),
		});

		// Right-click a note in the file explorer, or the "more options" menu of a tab.
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				menu.addItem((item) =>
					item
						.setTitle(LABEL)
						.setIcon(ICON)
						.onClick(() => void this.send(file, this.settings.defaultDelivery)),
				);
			}),
		);

		this.registerEvent(this.app.workspace.on("layout-change", () => this.syncHeaderButtons()));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncHeaderButtons()));
		this.app.workspace.onLayoutReady(() => this.syncHeaderButtons());
		this.syncRibbonIcon();

		this.addSettingTab(new SendToKindleSettingTab(this.app, this));
	}

	onunload(): void {
		for (const button of this.headerButtons.values()) button.remove();
		this.headerButtons.clear();
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<SendToKindleSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		this.settings.sent = Object.assign({}, saved?.sent);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	syncRibbonIcon(): void {
		if (this.settings.showRibbonIcon && !this.ribbonIcon) {
			this.ribbonIcon = this.addRibbonIcon(ICON, LABEL, () => {
				const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
				if (!file) {
					new Notice("Open a note to send it to the Kindle.");
					return;
				}
				void this.send(file, this.settings.defaultDelivery);
			});
		} else if (!this.settings.showRibbonIcon && this.ribbonIcon) {
			this.ribbonIcon.remove();
			this.ribbonIcon = null;
		}
	}

	/** Keep one Send to Kindle button in the header of every open note. */
	syncHeaderButtons(): void {
		const open = new Set<MarkdownView>();
		if (this.settings.showHeaderButton) {
			for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
				const view = leaf.view;
				if (!(view instanceof MarkdownView)) continue; // tab not loaded yet
				open.add(view);
				if (this.headerButtons.has(view)) continue;
				const button = view.addAction(ICON, LABEL, () => {
					if (view.file) void this.send(view.file, this.settings.defaultDelivery);
				});
				this.headerButtons.set(view, button);
			}
		}
		for (const [view, button] of this.headerButtons) {
			if (open.has(view)) continue;
			button.remove();
			this.headerButtons.delete(view);
		}
	}

	private forActiveNote(checking: boolean, delivery: DefaultDelivery): boolean {
		const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		if (!file) return false;
		if (!checking) void this.send(file, delivery);
		return true;
	}

	private toolOptions(): ToolOptions {
		return {
			toolsDir: this.settings.toolsDir,
			extraPath: this.settings.extraPath,
			outDir: this.settings.outDir || join(tmpdir(), "send-to-kindle"),
			kindleMount: this.settings.kindleMount,
			ejectAfterUsb: this.settings.ejectAfterUsb,
		};
	}

	private resolveDelivery(choice: DefaultDelivery): Delivery {
		if (choice !== "auto") return choice;
		return kindleMounted(this.settings.kindleMount) ? "usb" : "email";
	}

	/** Write out unsaved edits, so the tools read what is on screen. */
	private async saveOpenEdits(file: TFile): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === file.path) await view.save();
		}
	}

	async send(file: TFile, choice: DefaultDelivery): Promise<void> {
		if (!Platform.isMacOS) {
			new Notice("Send to Kindle needs macOS: it sends through Mail.app.");
			return;
		}
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			new Notice("Send to Kindle needs a vault stored on this computer.");
			return;
		}
		if (this.busy) {
			new Notice("Already sending a note to the Kindle.");
			return;
		}

		const delivery = this.resolveDelivery(choice);

		// Amazon never replaces an emailed document: a second send is a second copy.
		const previous = this.settings.sent[file.path];
		if (delivery === "email" && previous?.delivery === "email") {
			const when = new Date(previous.at).toLocaleString();
			const again = await confirm(
				this.app,
				"Send again?",
				`"${file.basename}" was already emailed to the Kindle on ${when}. Sending it again adds a second copy to your library.`,
				"Send again",
			);
			if (!again) return;
		}

		this.busy = true;
		const progress = new Notice(`Building "${file.basename}" for the Kindle…`, 0);
		try {
			await this.saveOpenEdits(file);
			const options = this.toolOptions();
			const built = await buildEpub(adapter.getFullPath(file.path), options);

			if (delivery === "email") progress.setMessage("Emailing to the Kindle…");
			if (delivery === "usb") progress.setMessage("Copying to the Kindle…");
			const result = await deliver(built.epubPath, delivery, options);

			if (delivery === "epub") {
				revealInFinder(built.epubPath);
			} else {
				this.settings.sent[file.path] = { at: new Date().toISOString(), delivery };
				await this.saveSettings();
			}

			const notes = [...built.warnings, result.warning].filter(Boolean);
			progress.hide();
			if (notes.length > 0) {
				new Notice(`${file.basename}: ${result.summary}\n\n${notes.join("\n")}`, 0);
			} else {
				new Notice(`${file.basename}: ${result.summary}`, 6000);
			}
		} catch (error) {
			progress.hide();
			const message = error instanceof Error ? error.message : String(error);
			if (error instanceof KindleError && error.log) console.error(TAG, error.log);
			else console.error(TAG, error);
			new Notice(`Send to Kindle failed: ${message}`, 0);
		} finally {
			this.busy = false;
		}
	}
}
