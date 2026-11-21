import { FileSystemAdapter, MarkdownView, Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import { runClaude } from "./claude";
import { diffNote } from "./diff";
import { confirm, formatDuration } from "./modals";
import type { FixRun } from "./runs";
import {
	DEFAULT_SETTINGS,
	FixMarkdownSettingTab,
	folderList,
	type FixMarkdownSettings,
} from "./settings";
import { REPORT_VIEW, ReportView } from "./view";

const ICON = "wand-2";
const LABEL = "Fix Markdown with Claude";
/** Runs kept for the report panel's picker. */
const KEEP_RUNS = 20;

/** The address a note was clipped from, as Web Clipper records it. */
export function sourceUrl(frontmatter: Record<string, unknown> | undefined): string | null {
	for (const key of ["source", "url"]) {
		const value = frontmatter?.[key];
		if (typeof value !== "string") continue;
		try {
			const url = new URL(value.trim());
			if (url.protocol === "http:" || url.protocol === "https:") return url.href;
		} catch {
			// not a URL
		}
	}
	return null;
}

export function buildPrompt(skill: string, notePath: string, url: string | null): string {
	// Quote the path: note names have spaces, and may have quotes of their own.
	const quoted = `"${notePath.replace(/(["\\])/g, "\\$1")}"`;
	return `/${skill} ${quoted}${url ? ` ${url}` : ""}`;
}

export function buildSystemPrompt(dryRun: boolean, confirmedProtected: boolean): string {
	const lines = [
		"This run was started by a button in Obsidian and is unattended: nobody can answer a question or approve a prompt.",
		"Never ask. When the skill says to ask the user, take the safe option instead and say in the report what you left undone and why.",
		"If an action is refused, carry on with the rest and list it in the report.",
		"While you work, say in a sentence what you found or are about to do before each step: the user watches these lines live.",
		"Obsidian keeps its own copy of the note from before the run and shows the user a diff, so you do not need to make a backup.",
		"Your final message is shown to the user as the report. Write it in Markdown with these sections, skipping any that would be empty: **What was wrong**, **What I changed**, **New files**, **Left as is** (with why). Be specific, name the place in the note, keep it short, and add nothing after it.",
	];
	if (confirmedProtected) {
		lines.push(
			"The user was asked and confirmed that this note may be fixed even though it is in a folder of already-ingested sources.",
		);
	}
	if (dryRun) {
		lines.push(
			"This is a dry run: change nothing. Report what is wrong with the note and what you would change.",
		);
	}
	return lines.join("\n");
}

export default class FixMarkdownPlugin extends Plugin {
	settings: FixMarkdownSettings = DEFAULT_SETTINGS;
	/** Newest first. */
	runs: FixRun[] = [];

	private nextId = 1;
	private ribbonIcon: HTMLElement | null = null;
	private readonly headerButtons = new Map<MarkdownView, HTMLElement>();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(REPORT_VIEW, (leaf) => new ReportView(leaf, this));

		this.addCommand({
			id: "fix",
			name: "Fix current note with Claude",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
				if (!file) return false;
				if (!checking) void this.fix(file);
				return true;
			},
		});
		this.addCommand({
			id: "cancel",
			name: "Cancel the running fix",
			checkCallback: (checking) => {
				const running = this.runs.filter((run) => run.status === "running");
				if (running.length === 0) return false;
				if (!checking) for (const run of running) run.cancel();
				return true;
			},
		});
		this.addCommand({
			id: "show-report",
			name: "Show the fix report",
			callback: () => void this.showReport(null),
		});

		// Right-click a note in the file explorer, or the "more options" menu of a tab.
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				menu.addItem((item) =>
					item
						.setTitle(LABEL)
						.setIcon(ICON)
						.onClick(() => void this.fix(file)),
				);
			}),
		);

		this.registerEvent(this.app.workspace.on("layout-change", () => this.syncHeaderButtons()));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncHeaderButtons()));
		this.app.workspace.onLayoutReady(() => this.syncHeaderButtons());
		this.syncRibbonIcon();

		this.addSettingTab(new FixMarkdownSettingTab(this.app, this));
	}

	onunload(): void {
		for (const run of this.runs) if (run.status === "running") run.cancel();
		for (const button of this.headerButtons.values()) button.remove();
		this.headerButtons.clear();
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<FixMarkdownSettings> | null;
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
					new Notice("Open a note to fix it.");
					return;
				}
				void this.fix(file);
			});
		} else if (!this.settings.showRibbonIcon && this.ribbonIcon) {
			this.ribbonIcon.remove();
			this.ribbonIcon = null;
		}
	}

	/** Keep one Fix Markdown button in the header of every open note. */
	syncHeaderButtons(): void {
		const open = new Set<MarkdownView>();
		if (this.settings.showHeaderButton) {
			for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
				const view = leaf.view;
				if (!(view instanceof MarkdownView)) continue; // tab not loaded yet
				open.add(view);
				if (this.headerButtons.has(view)) continue;
				const button = view.addAction(ICON, LABEL, () => {
					if (view.file) void this.fix(view.file);
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

	/** Open the report panel in the right sidebar, on this run (or the latest). */
	async showReport(runId: number | null): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(REPORT_VIEW)[0];
		if (!leaf) {
			leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf("split");
			await leaf.setViewState({ type: REPORT_VIEW, active: true });
		}
		await workspace.revealLeaf(leaf);
		if (leaf.view instanceof ReportView) leaf.view.show(runId);
	}

	private notifyViews(run: FixRun, change: "log" | "state"): void {
		for (const leaf of this.app.workspace.getLeavesOfType(REPORT_VIEW)) {
			if (leaf.view instanceof ReportView) leaf.view.update(run, change);
		}
	}

	/** True when the note sits in a folder whose notes should not change without asking. */
	private isProtected(path: string): boolean {
		const inAny = (folders: string[]): boolean => folders.some((f) => path.startsWith(f));
		return (
			inAny(folderList(this.settings.confirmFolders)) &&
			!inAny(folderList(this.settings.confirmExceptions))
		);
	}

	/** Write out unsaved edits, so Claude reads what is on screen. */
	private async saveOpenEdits(file: TFile): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === file.path) await view.save();
		}
	}

	async fix(file: TFile): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			new Notice("Fix Markdown needs a vault stored on this computer.");
			return;
		}
		const already = this.runs.find((run) => run.notePath === file.path && run.status === "running");
		if (already) {
			void this.showReport(already.id);
			new Notice(`Claude is already fixing "${file.basename}".`);
			return;
		}

		const dryRun = this.settings.permissionMode === "plan";
		let confirmedProtected = false;
		if (!dryRun && this.isProtected(file.path)) {
			confirmedProtected = await confirm(
				this.app,
				"Fix this note?",
				`"${file.basename}" is in ${file.parent?.path ?? "a protected folder"}, where notes are treated as finished. Let Claude change it anyway?`,
				"Fix it",
			);
			if (!confirmedProtected) return;
		}

		await this.saveOpenEdits(file);
		const url = sourceUrl(this.app.metadataCache.getFileCache(file)?.frontmatter);

		const run: FixRun = {
			id: this.nextId++,
			notePath: file.path,
			noteName: file.basename,
			sourceUrl: url,
			dryRun,
			startedAt: Date.now(),
			status: "running",
			log: [],
			before: await adapter.read(file.path),
			created: [],
			modified: [],
			deleted: [],
			cancel: () => {},
		};
		this.runs.unshift(run);
		this.runs.splice(KEEP_RUNS);

		// Other files the run touches (attachments, mostly). Claude writes to disk;
		// Obsidian's file watcher turns that into these events.
		const others = {
			created: new Set<string>(),
			modified: new Set<string>(),
			deleted: new Set<string>(),
		};
		const track =
			(kind: "created" | "modified" | "deleted") =>
			(changed: TAbstractFile): void => {
				if (changed.path === file.path || !(changed instanceof TFile)) return;
				if (kind === "modified" && others.created.has(changed.path)) return;
				others[kind].add(changed.path);
			};
		const refs = [
			this.app.vault.on("create", track("created")),
			this.app.vault.on("modify", track("modified")),
			this.app.vault.on("delete", track("deleted")),
		];

		const handle = runClaude(
			{
				claudePath: this.settings.claudePath,
				extraPath: this.settings.extraPath,
				cwd: adapter.getBasePath(),
				prompt: buildPrompt(this.settings.skill, file.path, url),
				systemPrompt: buildSystemPrompt(dryRun, confirmedProtected),
				permissionMode: this.settings.permissionMode,
				model: this.settings.model,
				timeoutMs: this.settings.timeoutMinutes * 60_000,
			},
			(kind, text) => {
				run.log.push({ at: Date.now() - run.startedAt, kind, text });
				this.notifyViews(run, "log");
			},
		);
		run.cancel = handle.cancel;

		const mode = this.settings.showReport;
		let progress: Notice | null = null;
		if (mode === "start") {
			await this.showReport(run.id);
		} else {
			progress = new Notice(
				`${dryRun ? "Checking" : "Fixing"} "${file.basename}" with Claude… Click to watch.`,
				0,
			);
			this.onNoticeClick(progress, () => void this.showReport(run.id));
		}

		const result = await handle.done;
		for (const ref of refs) this.app.vault.offref(ref);
		progress?.hide();

		run.result = result;
		// Claude's last message is the report, which has its own section.
		const last = run.log[run.log.length - 1];
		if (last?.kind === "text" && last.text.trim() === result.report.trim()) run.log.pop();
		run.after = await adapter.read(file.path).catch(() => "");
		run.diff = diffNote(run.before ?? "", run.after);
		run.created = [...others.created].sort();
		run.modified = [...others.modified].filter((path) => !others.deleted.has(path)).sort();
		run.deleted = [...others.deleted].filter((path) => !others.created.has(path)).sort();
		run.status = result.cancelled ? "cancelled" : result.ok ? "done" : "failed";
		this.notifyViews(run, "state");

		if (mode === "finish") await this.showReport(run.id);

		const changed = run.diff.added + run.diff.removed;
		const what = result.cancelled
			? "Cancelled"
			: !result.ok
				? "Fix failed for"
				: dryRun
					? "Checked"
					: changed > 0
						? `Fixed (${changed} lines changed)`
						: "No changes needed in";
		const done = new Notice(
			`${what} "${file.basename}" · ${formatDuration(result.durationMs)}${mode === "start" ? "" : ". Click for the report."}`,
			mode === "start" ? 5000 : 0,
		);
		this.onNoticeClick(done, () => void this.showReport(run.id));
	}

	private onNoticeClick(notice: Notice, action: () => void): void {
		// noticeEl is the whole notice in older Obsidian and only its text in newer
		// versions: listen on the notice box either way, so its padding counts too.
		const box = notice.noticeEl.closest(".notice") ?? notice.noticeEl;
		box.addEventListener("click", action);
	}
}
