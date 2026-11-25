import {
	Component,
	ItemView,
	Keymap,
	MarkdownRenderer,
	MarkdownView,
	Notice,
	setIcon,
	TFile,
	type WorkspaceLeaf,
} from "obsidian";
import { elide, type DiffLine, type Segment } from "./diff";
import type FixMarkdownPlugin from "./main";
import { confirm, formatDuration } from "./modals";
import type { FixRun, LogEntry } from "./runs";

export const REPORT_VIEW = "mikko-fix-markdown-report";

const STATUS_TEXT: Record<FixRun["status"], string> = {
	running: "Running",
	done: "Fixed",
	failed: "Failed",
	cancelled: "Cancelled",
};

/** The parts of a run's row in the list that change while it runs. */
interface RunRow {
	time: HTMLElement;
	detail: HTMLElement;
}

/**
 * Side panel: what a fix is doing, then what it changed.
 *
 * It follows the note open in the main area and shows that note's latest run.
 * Above it, a list of this session's runs shows every fix at a glance; picking
 * one opens its note.
 */
export class ReportView extends ItemView {
	/** The note the panel follows: the last one opened in the main area. */
	private followPath: string | null = null;
	/** A run chosen by hand (list, notice, Fix again); wins until another note opens. */
	private pickedId: number | null = null;
	/** What the body shows: "run:<id>", "note:<path>" or "". */
	private bodyKey = "";
	private listOpen = true;

	private listEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private readonly rows = new Map<number, RunRow>();
	private renderer = new Component();
	private elapsedEl: HTMLElement | null = null;
	private logEl: HTMLElement | null = null;
	private logCount = 0;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: FixMarkdownPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return REPORT_VIEW;
	}

	getDisplayText(): string {
		return "Fix report";
	}

	getIcon(): string {
		return "wand-2";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("fix-markdown-view");
		this.listEl = this.contentEl.createDiv();
		this.bodyEl = this.contentEl.createDiv();
		const followActive = (): void => {
			const active = this.app.workspace.getActiveFile();
			if (active?.extension === "md") this.follow(active.path);
		};
		followActive();
		// Restored at startup, the panel can open before any note has.
		this.app.workspace.onLayoutReady(followActive);
		// Focusing this panel, or a non-note tab, opens no note: keep the last one.
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file?.extension === "md") this.follow(file.path);
			}),
		);
		this.registerInterval(window.setInterval(() => this.tick(), 1000));
		if (!this.bodyKey) {
			this.renderList();
			this.renderBody();
		}
	}

	async onClose(): Promise<void> {
		this.renderer.unload();
	}

	/** Show this run, or (null) the latest run of the note in view. */
	show(runId: number | null): void {
		this.pickedId = runId;
		this.renderList();
		this.renderBody();
	}

	/** Called by the plugin when a run changes. */
	update(run: FixRun, change: "log" | "state"): void {
		if (change === "log") {
			this.updateRow(run);
			if (this.bodyKey === `run:${run.id}`) this.appendLogEntries(run);
			return;
		}
		this.renderList();
		// Re-render the body only when it is about this run, or when this run is now
		// the one to show (a new fix of the followed note). Otherwise the report being
		// read keeps its scroll and open sections.
		if (this.bodyKey === `run:${run.id}` || this.keyOf(this.current()) !== this.bodyKey) {
			this.renderBody();
		}
	}

	/** True when the panel shows a report of some other run. */
	showsOtherRun(runId: number): boolean {
		return this.bodyKey.startsWith("run:") && this.bodyKey !== `run:${runId}`;
	}

	/** Called by the plugin before it reports a renamed note's runs. */
	noteRenamed(oldPath: string, newPath: string): void {
		if (this.followPath === oldPath) this.followPath = newPath;
		if (this.bodyKey === `note:${oldPath}`) this.bodyKey = `note:${newPath}`;
	}

	private follow(path: string): void {
		if (path === this.followPath) return;
		this.followPath = path;
		if (this.picked()?.notePath !== path) this.pickedId = null;
		this.renderList();
		if (this.keyOf(this.current()) !== this.bodyKey) this.renderBody();
	}

	private picked(): FixRun | undefined {
		return this.pickedId === null
			? undefined
			: this.plugin.runs.find((run) => run.id === this.pickedId);
	}

	private current(): FixRun | undefined {
		return this.picked() ?? (this.followPath ? this.plugin.latestRun(this.followPath) : undefined);
	}

	private keyOf(run: FixRun | undefined): string {
		if (run) return `run:${run.id}`;
		return this.followPath ? `note:${this.followPath}` : "";
	}

	private tick(): void {
		const run = this.current();
		if (run?.status === "running" && this.elapsedEl) {
			this.elapsedEl.setText(formatDuration(Date.now() - run.startedAt));
		}
		for (const each of this.plugin.runs) {
			if (each.status === "running") this.updateRow(each);
		}
	}

	/** Open the run's note, reusing its tab when it is already open. */
	private openNote(path: string, event?: MouseEvent | KeyboardEvent): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice("The note is gone.");
			return;
		}
		const newTab = event ? Keymap.isModEvent(event) : false;
		const open = this.app.workspace
			.getLeavesOfType("markdown")
			.find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === path);
		if (open && !newTab) {
			this.app.workspace.setActiveLeaf(open, { focus: true });
		} else {
			void this.app.workspace.getLeaf(newTab).openFile(file);
		}
	}

	// --- the list of runs -----------------------------------------------------

	private renderList(): void {
		this.listEl.empty();
		this.rows.clear();
		const runs = this.plugin.runs;
		const shown = this.current();
		// A list of just the run already on screen says nothing.
		if (runs.length === 0 || (runs.length === 1 && runs[0] === shown)) return;

		const details = this.listEl.createEl("details", { cls: "fix-markdown-runs" });
		details.open = this.listOpen;
		details.addEventListener("toggle", () => (this.listOpen = details.open));
		const running = runs.filter((run) => run.status === "running").length;
		const summary = details.createEl("summary");
		summary.createSpan({ text: "Fixes this session" });
		summary.createSpan({
			cls: "fix-markdown-runs-count",
			text: running > 0 ? `${running} running` : String(runs.length),
		});

		const list = details.createDiv({ cls: "fix-markdown-runs-list" });
		for (const run of runs) {
			const row = list.createDiv({
				cls: `fix-markdown-run fix-markdown-run-${run.status}`,
				attr: { role: "button", tabindex: "0" },
			});
			if (run === shown) row.addClass("is-active");
			row.createSpan({ cls: `fix-markdown-dot fix-markdown-dot-${this.dotKind(run)}` });
			const main = row.createDiv({ cls: "fix-markdown-run-main" });
			const top = main.createDiv({ cls: "fix-markdown-run-top" });
			top.createSpan({ cls: "fix-markdown-run-name", text: run.noteName });
			const time = top.createSpan({ cls: "fix-markdown-run-time" });
			const detail = main.createDiv({ cls: "fix-markdown-run-detail" });
			this.rows.set(run.id, { time, detail });
			this.updateRow(run);

			row.addEventListener("click", (event) => this.pick(run, event));
			row.addEventListener("keydown", (event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				this.pick(run, event);
			});
		}
	}

	private dotKind(run: FixRun): string {
		if (run.status === "done" && run.dryRun) return "dry";
		return run.status;
	}

	private updateRow(run: FixRun): void {
		const row = this.rows.get(run.id);
		if (!row) return;
		if (run.status === "running") {
			row.time.setText(formatDuration(Date.now() - run.startedAt));
			row.detail.setText(this.lastActivity(run));
			return;
		}
		row.time.setText(
			new Date(run.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
		);
		const parts = [this.statusLabel(run)];
		if (run.result) parts.push(formatDuration(run.result.durationMs));
		if (run.undone) parts.push("undone");
		else if (run.diff && run.diff.added + run.diff.removed > 0) {
			parts.push(`+${run.diff.added} −${run.diff.removed}`);
		}
		row.detail.setText(parts.join(" · "));
	}

	/** One line on what a running fix is doing now. */
	private lastActivity(run: FixRun): string {
		const last = run.log[run.log.length - 1];
		if (!last) return "Starting…";
		const line = last.text.split("\n")[0] ?? "";
		return line.replace(/[*_`#>]/g, "").trim();
	}

	private pick(run: FixRun, event: MouseEvent | KeyboardEvent): void {
		this.pickedId = run.id;
		if (run.notePath !== this.followPath) {
			this.followPath = run.notePath;
			this.openNote(run.notePath, event);
		}
		this.renderList();
		this.renderBody();
	}

	// --- the shown run (or the followed note) --------------------------------

	private renderBody(): void {
		this.renderer.unload();
		this.renderer = new Component();
		this.renderer.load();
		this.elapsedEl = null;
		this.logEl = null;
		this.logCount = 0;

		const root = this.bodyEl;
		root.empty();
		const run = this.current();
		this.bodyKey = this.keyOf(run);
		if (!run) {
			this.renderIdle(root);
			return;
		}

		this.renderHeader(root, run);

		if (run.status === "running") {
			this.renderLog(root, run, true);
			return;
		}

		this.renderReport(root, run);
		this.renderChanges(root, run);
		this.renderOtherFiles(root, run);
		this.renderDenials(root, run);
		this.renderLog(root, run, false);
	}

	/** The followed note has not been fixed in this session. */
	private renderIdle(root: HTMLElement): void {
		const file = this.followPath ? this.app.vault.getAbstractFileByPath(this.followPath) : null;
		if (!(file instanceof TFile)) {
			root.createDiv({
				cls: "fix-markdown-empty",
				text: "Open a note to fix it. What Claude does and what it changes shows up here.",
			});
			return;
		}
		const header = root.createDiv({ cls: "fix-markdown-header" });
		header.createDiv({ cls: "fix-markdown-title", text: file.basename });
		header.createDiv({ cls: "fix-markdown-meta", text: "Not fixed in this session." });

		const url = this.plugin.noteSourceUrl(file);
		const source = header.createDiv({ cls: "fix-markdown-source" });
		if (url) {
			source.createSpan({ text: "Source: " });
			source.createEl("a", { text: url, href: url });
		} else {
			source.setText(
				"No source URL in the note's properties: Claude will fix it without comparing with the original.",
			);
		}

		const dryRun = this.plugin.settings.permissionMode === "plan";
		const actions = header.createDiv({ cls: "fix-markdown-actions" });
		this.button(actions, "wand-2", dryRun ? "Check this note" : "Fix this note", () => {
			void this.plugin.fix(file);
		}).addClass("mod-cta");
	}

	private statusLabel(run: FixRun): string {
		if (run.status === "done" && run.dryRun) return "Dry run";
		return STATUS_TEXT[run.status];
	}

	private renderHeader(root: HTMLElement, run: FixRun): void {
		const header = root.createDiv({ cls: "fix-markdown-header" });

		const title = header.createDiv({ cls: "fix-markdown-title" });
		const link = title.createEl("a", { text: run.noteName, href: "#" });
		link.addEventListener("click", (event) => {
			event.preventDefault();
			this.openNote(run.notePath, event);
		});

		const meta = header.createDiv({ cls: "fix-markdown-meta" });
		meta.createSpan({
			cls: `fix-markdown-status fix-markdown-status-${run.status}`,
			text: this.statusLabel(run),
		});
		const elapsed = meta.createSpan({
			cls: "fix-markdown-elapsed",
			text: formatDuration((run.result?.durationMs ?? Date.now() - run.startedAt) || 0),
		});
		if (run.status === "running") this.elapsedEl = elapsed;
		if (run.result?.turns !== undefined) meta.createSpan({ text: `${run.result.turns} steps` });
		const latest = this.plugin.latestRun(run.notePath);
		if (latest && latest !== run) {
			const newer = meta.createEl("a", { text: "Show the latest run", href: "#" });
			newer.addEventListener("click", (event) => {
				event.preventDefault();
				this.show(latest.id);
			});
		}

		if (run.sourceUrl) {
			const source = header.createDiv({ cls: "fix-markdown-source" });
			source.createSpan({ text: "Source: " });
			source.createEl("a", { text: run.sourceUrl, href: run.sourceUrl });
		} else {
			header.createDiv({
				cls: "fix-markdown-source",
				text: "No source URL in the note's properties: Claude could not compare with the original.",
			});
		}

		const actions = header.createDiv({ cls: "fix-markdown-actions" });
		if (run.status === "running") {
			this.button(actions, "square", "Cancel", () => run.cancel());
			return;
		}
		if (run.diff && run.diff.hunks.length > 0 && run.before !== undefined) {
			this.button(actions, "undo-2", "Undo changes to the note", () => void this.undo(run));
		}
		const sessionId = run.result?.sessionId;
		if (sessionId) {
			this.button(actions, "terminal", "Copy resume command", (label) => {
				void navigator.clipboard.writeText(`claude --resume ${sessionId}`);
				label.setText("Copied: run it from the vault folder");
			});
		}
		this.button(actions, "rotate-ccw", "Fix again", () => {
			const file = this.app.vault.getAbstractFileByPath(run.notePath);
			if (file instanceof TFile) void this.plugin.fix(file);
		});
	}

	private button(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: (label: HTMLElement) => void,
	): HTMLElement {
		const button = parent.createEl("button", { cls: "fix-markdown-button" });
		const iconEl = button.createSpan();
		setIcon(iconEl, icon);
		const labelEl = button.createSpan({ text: label });
		button.addEventListener("click", () => onClick(labelEl));
		return button;
	}

	private section(root: HTMLElement, title: string, open = true): HTMLElement {
		const details = root.createEl("details", { cls: "fix-markdown-section" });
		details.open = open;
		details.createEl("summary", { text: title });
		return details.createDiv({ cls: "fix-markdown-section-body" });
	}

	private renderReport(root: HTMLElement, run: FixRun): void {
		const body = this.section(root, "Claude's report");
		const text = run.result?.report.trim() || "Claude left no report.";
		void MarkdownRenderer.render(this.app, text, body, run.notePath, this.renderer);
	}

	private renderChanges(root: HTMLElement, run: FixRun): void {
		const diff = run.diff;
		if (!diff) return;
		const total = diff.added + diff.removed;
		const title =
			total === 0
				? "Changes to the note: none"
				: `Changes to the note: +${diff.added} −${diff.removed} lines`;
		const body = this.section(root, title);

		if (diff.tooLarge) {
			body.createDiv({
				cls: "fix-markdown-muted",
				text: "The note is too large to compare line by line. Use Undo to go back if you need to.",
			});
			return;
		}
		if (diff.hunks.length === 0) {
			body.createDiv({
				cls: "fix-markdown-muted",
				text: run.undone ? "The fix was undone." : "The note was not changed.",
			});
			return;
		}
		for (const hunk of diff.hunks) {
			const block = body.createDiv({ cls: "fix-markdown-hunk" });
			block.createDiv({ cls: "fix-markdown-hunk-head", text: `Line ${hunk.newStart}` });
			for (const line of hunk.lines) {
				// A blank line of context says nothing about where the change is.
				if (line.kind === "context" && line.text.trim() === "") continue;
				this.renderDiffLine(block, line);
			}
		}
	}

	private renderDiffLine(parent: HTMLElement, line: DiffLine): void {
		const row = parent.createDiv({ cls: `fix-markdown-line fix-markdown-line-${line.kind}` });
		row.createSpan({
			cls: "fix-markdown-sign",
			text: line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " ",
		});
		const text = row.createSpan({ cls: "fix-markdown-text" });
		if (line.text === "") {
			text.createSpan({ cls: "fix-markdown-blank", text: "(blank line)" });
			return;
		}
		const segments: Segment[] = line.segments
			? elide(line.segments)
			: [{ text: line.text, changed: false }];
		for (const segment of segments) {
			if (segment.changed) text.createEl("mark", { text: segment.text });
			else text.appendText(segment.text);
		}
	}

	private renderOtherFiles(root: HTMLElement, run: FixRun): void {
		const groups: Array<[string, string[]]> = [
			["New", run.created],
			["Changed", run.modified],
			["Deleted", run.deleted],
		];
		const count = groups.reduce((sum, [, files]) => sum + files.length, 0);
		if (count === 0) return;
		const body = this.section(root, `Other files: ${count}`);
		const uncertain = new Set(run.uncertain);
		if (uncertain.size > 0) {
			body.createDiv({
				cls: "fix-markdown-muted",
				text: "Another fix ran at the same time. Files marked “maybe” changed while both were running, and neither run named them.",
			});
		}
		for (const [label, files] of groups) {
			for (const path of files) {
				const row = body.createDiv({ cls: "fix-markdown-file" });
				row.createSpan({ cls: "fix-markdown-file-kind", text: label });
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					const link = row.createEl("a", { text: path, href: "#" });
					link.addEventListener("click", (event) => {
						event.preventDefault();
						void this.app.workspace.getLeaf("tab").openFile(file);
					});
				} else {
					row.createSpan({ text: path });
				}
				if (uncertain.has(path)) row.createSpan({ cls: "fix-markdown-maybe", text: "maybe" });
			}
		}
	}

	private renderDenials(root: HTMLElement, run: FixRun): void {
		const denials = run.result?.denials ?? [];
		if (denials.length === 0) return;
		const body = this.section(root, `Not allowed: ${denials.length}`);
		body.createDiv({
			cls: "fix-markdown-muted",
			text: "The permission setting refused these, so Claude skipped them.",
		});
		const list = body.createEl("ul");
		for (const denial of denials) list.createEl("li", { text: denial });
	}

	private renderLog(root: HTMLElement, run: FixRun, open: boolean): void {
		const body = this.section(root, `What Claude did (${run.log.length})`, open);
		this.logEl = body.createDiv({ cls: "fix-markdown-log" });
		this.appendLogEntries(run);
	}

	private appendLogEntries(run: FixRun): void {
		const logEl = this.logEl;
		if (!logEl) return;
		const nearBottom =
			this.contentEl.scrollHeight - this.contentEl.scrollTop - this.contentEl.clientHeight < 80;
		for (const entry of run.log.slice(this.logCount)) this.appendLogEntry(logEl, entry);
		this.logCount = run.log.length;
		const summary = logEl.parentElement?.parentElement?.querySelector("summary");
		summary?.setText(`What Claude did (${run.log.length})`);
		if (nearBottom && run.status === "running")
			this.contentEl.scrollTop = this.contentEl.scrollHeight;
	}

	private appendLogEntry(parent: HTMLElement, entry: LogEntry): void {
		const row = parent.createDiv({ cls: `fix-markdown-log-${entry.kind}` });
		row.createSpan({ cls: "fix-markdown-log-time", text: formatDuration(entry.at) });
		if (entry.kind === "tool") {
			row.createSpan({ text: entry.text });
		} else {
			const said = row.createDiv({ cls: "fix-markdown-log-said" });
			void MarkdownRenderer.render(this.app, entry.text, said, "", this.renderer);
		}
	}

	private async undo(run: FixRun): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(run.notePath);
		if (!(file instanceof TFile) || run.before === undefined) {
			new Notice("The note is gone, so there is nothing to undo.");
			return;
		}
		const now = await this.app.vault.adapter.read(run.notePath);
		const editedSince = now !== run.after;
		const extra =
			run.created.length > 0
				? ` The ${run.created.length} new file(s) it made (such as attachments) are kept.`
				: "";
		const ok = await confirm(
			this.app,
			"Undo the fix?",
			editedSince
				? `"${run.noteName}" has changed since the fix. Undoing puts back the note as it was before the fix and loses those later edits too.${extra}`
				: `Put "${run.noteName}" back the way it was before the fix?${extra}`,
			"Undo",
		);
		if (!ok) return;
		await this.app.vault.modify(file, run.before);
		run.diff = { hunks: [], added: 0, removed: 0, tooLarge: false };
		run.undone = true;
		new Notice(`Undid the fix to "${run.noteName}".`, 5000);
		this.renderList();
		this.renderBody();
	}
}
