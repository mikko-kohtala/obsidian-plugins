import { execFile } from "child_process";
import { mkdirSync, mkdtempSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { MarkdownView, Notice, Platform, Plugin, TFile } from "obsidian";
import { buildPage, printToPdf } from "./render";
import {
	DEFAULT_SETTINGS,
	PrintNoteSettingTab,
	type AfterPdf,
	type PrintNoteSettings,
} from "./settings";

const ICON = "printer";
const LABEL = "Print note";

function run(file: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile(file, args, { timeout: 30_000 }, (error, _stdout, stderr) => {
			if (error) reject(new Error(stderr.trim() || error.message));
			else resolve();
		});
	});
}

/** Open the PDF in Preview and bring up its print dialog. */
function printInPreview(pdfPath: string): Promise<void> {
	const quoted = pdfPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	return run("osascript", [
		"-e",
		`set f to POSIX file "${quoted}"`,
		"-e",
		'tell application "Preview"',
		"-e",
		"activate",
		"-e",
		"open f",
		"-e",
		"delay 0.6",
		"-e",
		// Don't wait for the dialog: it stays open as long as the person needs.
		"ignoring application responses",
		"-e",
		"print front document with print dialog",
		"-e",
		"end ignoring",
		"-e",
		"end tell",
	]);
}

export default class PrintNotePlugin extends Plugin {
	settings: PrintNoteSettings = DEFAULT_SETTINGS;

	private busy = false;
	private ribbonIcon: HTMLElement | null = null;
	private readonly headerButtons = new Map<MarkdownView, HTMLElement>();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addCommand({
			id: "print",
			name: "Print current note",
			checkCallback: (checking) => this.forActiveNote(checking, this.settings.after),
		});
		this.addCommand({
			id: "open-pdf",
			name: "Open current note as PDF in Preview",
			checkCallback: (checking) => this.forActiveNote(checking, "preview"),
		});
		this.addCommand({
			id: "save-pdf",
			name: "Save current note as PDF to the Desktop",
			checkCallback: (checking) => this.forActiveNote(checking, "desktop"),
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				menu.addItem((item) =>
					item
						.setTitle(LABEL)
						.setIcon(ICON)
						.onClick(() => void this.print(file, this.settings.after)),
				);
			}),
		);

		this.registerEvent(this.app.workspace.on("layout-change", () => this.syncHeaderButtons()));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncHeaderButtons()));
		this.app.workspace.onLayoutReady(() => this.syncHeaderButtons());
		this.syncRibbonIcon();

		this.addSettingTab(new PrintNoteSettingTab(this.app, this));
	}

	onunload(): void {
		for (const button of this.headerButtons.values()) button.remove();
		this.headerButtons.clear();
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<PrintNoteSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	syncRibbonIcon(): void {
		if (this.settings.showRibbonIcon && !this.ribbonIcon) {
			this.ribbonIcon = this.addRibbonIcon(ICON, LABEL, () => {
				const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
				if (!file) {
					new Notice("Open a note to print it.");
					return;
				}
				void this.print(file, this.settings.after);
			});
		} else if (!this.settings.showRibbonIcon && this.ribbonIcon) {
			this.ribbonIcon.remove();
			this.ribbonIcon = null;
		}
	}

	/** Keep one Print button in the header of every open note. */
	syncHeaderButtons(): void {
		const open = new Set<MarkdownView>();
		if (this.settings.showHeaderButton) {
			for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
				const view = leaf.view;
				if (!(view instanceof MarkdownView)) continue; // tab not loaded yet
				open.add(view);
				if (this.headerButtons.has(view)) continue;
				const button = view.addAction(ICON, LABEL, () => {
					if (view.file) void this.print(view.file, this.settings.after);
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

	private forActiveNote(checking: boolean, after: AfterPdf): boolean {
		const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		if (!file) return false;
		if (!checking) void this.print(file, after);
		return true;
	}

	/** Write out unsaved edits, so the print matches what is on screen. */
	private async saveOpenEdits(file: TFile): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === file.path) await view.save();
		}
	}

	/** Render the note, make the PDF, then print / open / save it. Returns the PDF path. */
	/** Render the note and write its PDF: into pdfDir, or a fresh temporary folder. */
	async makePdf(
		file: TFile,
		pdfDir: string | null,
	): Promise<{ pdfPath: string; missingImages: number }> {
		mkdirSync(join(tmpdir(), "obsidian-print"), { recursive: true });
		const workDir = mkdtempSync(join(tmpdir(), "obsidian-print", "note-"));
		const pdfPath = join(pdfDir ?? workDir, `${file.basename}.pdf`);
		const page = await buildPage(this.app, file, this.settings, workDir);
		await printToPdf(page.htmlPath, pdfPath, this.settings);
		return { pdfPath, missingImages: page.missingImages };
	}

	async print(file: TFile, after: AfterPdf): Promise<string | null> {
		if (!Platform.isMacOS) {
			new Notice("Print Note needs macOS: it prints through Preview.");
			return null;
		}
		if (this.busy) {
			new Notice("Already preparing a print.");
			return null;
		}
		this.busy = true;
		const progress = new Notice(`Preparing "${file.basename}" for printing…`, 0);
		try {
			await this.saveOpenEdits(file);
			const { pdfPath, missingImages } = await this.makePdf(
				file,
				after === "desktop" ? join(homedir(), "Desktop") : null,
			);
			const page = { missingImages };

			if (after === "print") {
				try {
					await printInPreview(pdfPath);
				} catch (error) {
					console.error("[print-note]", error);
					await run("open", ["-a", "Preview", pdfPath]);
					new Notice("Opened in Preview. Press ⌘P to print.", 8000);
				}
			} else if (after === "preview") {
				await run("open", ["-a", "Preview", pdfPath]);
			} else {
				await run("open", ["-R", pdfPath]);
				new Notice(`Saved "${file.basename}.pdf" to the Desktop.`, 5000);
			}
			if (page.missingImages > 0) {
				new Notice(
					`${page.missingImages} image(s) could not be loaded and are missing from the print.`,
					8000,
				);
			}
			return pdfPath;
		} catch (error) {
			console.error("[print-note]", error);
			new Notice(`Print failed: ${error instanceof Error ? error.message : String(error)}`, 0);
			return null;
		} finally {
			progress.hide();
			this.busy = false;
		}
	}
}
