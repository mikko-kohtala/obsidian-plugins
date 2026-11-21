import {
	Component,
	ItemView,
	MarkdownRenderer,
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

/** Side panel: what a fix is doing, then what it changed. */
export class ReportView extends ItemView {
	private shownId: number | null = null;
	private renderer = new Component();
	private elapsedEl: HTMLElement | null = null;
	private logEl: HTMLElement | null = null;
	private logCount = 0;
	private ticker: number | null = null;

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
		this.ticker = window.setInterval(() => this.tick(), 1000);
		this.render();
	}

	async onClose(): Promise<void> {
		if (this.ticker !== null) window.clearInterval(this.ticker);
		this.renderer.unload();
	}

	/** Show this run (or the latest one). */
	show(runId: number | null): void {
		this.shownId = runId;
		this.render();
	}

	/** Called by the plugin when a run changes. */
	update(run: FixRun, change: "log" | "state"): void {
		if (this.current()?.id !== run.id && change === "log") return;
		if (change === "log" && this.logEl) {
			this.appendLogEntries(run);
			return;
		}
		this.render();
	}

	private current(): FixRun | undefined {
		const runs = this.plugin.runs;
		return runs.find((run) => run.id === this.shownId) ?? runs[0];
	}

	private tick(): void {
		const run = this.current();
		if (run?.status === "running" && this.elapsedEl) {
			this.elapsedEl.setText(formatDuration(Date.now() - run.startedAt));
		}
	}

	private render(): void {
		this.renderer.unload();
		this.renderer = new Component();
		this.renderer.load();
		this.elapsedEl = null;
		this.logEl = null;
		this.logCount = 0;

		const root = this.contentEl;
		root.empty();
		const run = this.current();
		if (!run) {
			root.createDiv({
				cls: "fix-markdown-empty",
				text: "Press the wand button on a note to fix it. What Claude does and what it changes shows up here.",
			});
			return;
		}

		this.renderPicker(root, run);
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

	private renderPicker(root: HTMLElement, run: FixRun): void {
		const runs = this.plugin.runs;
		if (runs.length < 2) return;
		const select = root.createEl("select", { cls: "dropdown fix-markdown-picker" });
		for (const each of runs) {
			const when = new Date(each.startedAt).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			});
			const option = select.createEl("option", {
				text: `${when} · ${each.noteName} · ${this.statusLabel(each)}`,
				value: String(each.id),
			});
			option.selected = each.id === run.id;
		}
		select.addEventListener("change", () => this.show(Number(select.value)));
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
			void this.app.workspace.openLinkText(run.notePath, "", false);
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
			this.button(actions, "terminal", "Copy resume command", (button) => {
				void navigator.clipboard.writeText(`claude --resume ${sessionId}`);
				button.setText("Copied: run it from the vault folder");
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
		onClick: (button: HTMLElement) => void,
	): void {
		const button = parent.createEl("button", { cls: "fix-markdown-button" });
		const iconEl = button.createSpan();
		setIcon(iconEl, icon);
		const labelEl = button.createSpan({ text: label });
		button.addEventListener("click", () => onClick(labelEl));
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
			body.createDiv({ cls: "fix-markdown-muted", text: "The note was not changed." });
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
		this.render();
	}
}
