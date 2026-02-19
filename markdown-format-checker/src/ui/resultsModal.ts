import { App, Component, MarkdownRenderer, Notice, setIcon } from "obsidian";
import type { ApplyFixContext, FormatCheckResult } from "../types";
import type { StreamUpdate } from "../utils/claudeRunner";
import { runClaudeCheckStreaming } from "../utils/claudeRunner";
import { buildApplyFixPrompt } from "../utils/promptBuilder";

export class FormatCheckPanel {
	private app: App;
	private fileName: string;
	private applyCtx: ApplyFixContext | null;
	private renderComponent: Component;
	private containerEl: HTMLDivElement;
	private thinkingEl: HTMLDivElement;
	private thinkingTextEl: HTMLPreElement;
	private streamEl: HTMLPreElement;
	private outputDiv: HTMLDivElement;
	private copyBtn: HTMLButtonElement;
	private applyBtn: HTMLButtonElement;
	private footerEl: HTMLDivElement;
	private footerStatus: HTMLSpanElement;
	private accumulated = "";
	private isApplying = false;
	private isClosed = false;

	constructor(app: App, fileName: string, applyCtx: ApplyFixContext | null = null) {
		this.app = app;
		this.fileName = fileName;
		this.applyCtx = applyCtx;
		this.renderComponent = new Component();
		this.containerEl = document.body.createDiv({ cls: "format-checker-panel" });
		this.build();
	}

	private build(): void {
		this.renderComponent.load();

		// Header
		const header = this.containerEl.createDiv({ cls: "format-checker-panel-header" });

		const titleRow = header.createDiv({ cls: "format-checker-panel-title-row" });
		const title = titleRow.createSpan({ cls: "format-checker-panel-title" });
		title.createSpan({ text: "Format Check: " });
		title.createEl("code", { text: this.fileName });

		const actions = titleRow.createDiv({ cls: "format-checker-panel-actions" });

		this.copyBtn = actions.createEl("button", {
			cls: "clickable-icon",
			attr: { "aria-label": "Copy to clipboard" },
		});
		setIcon(this.copyBtn, "copy");
		this.copyBtn.style.display = "none";
		this.copyBtn.addEventListener("click", () => {
			navigator.clipboard.writeText(this.accumulated).then(() => {
				new Notice("Copied to clipboard");
			});
		});

		const closeBtn = actions.createEl("button", {
			cls: "clickable-icon",
			attr: { "aria-label": "Close" },
		});
		setIcon(closeBtn, "x");
		closeBtn.addEventListener("click", () => this.close());

		// Thinking section (collapsible, muted)
		this.thinkingEl = this.containerEl.createDiv({
			cls: "format-checker-panel-thinking",
		});
		this.thinkingEl.style.display = "none";
		const thinkingLabel = this.thinkingEl.createDiv({
			cls: "format-checker-panel-thinking-label",
			text: "Thinking...",
		});
		this.thinkingTextEl = this.thinkingEl.createEl("pre", {
			cls: "format-checker-panel-thinking-text",
		});

		// Streaming plain text (hidden until text arrives)
		this.streamEl = this.containerEl.createEl("pre", {
			cls: "format-checker-panel-stream",
		});
		this.streamEl.style.display = "none";

		// Rendered markdown output (hidden until finalize)
		this.outputDiv = this.containerEl.createDiv({
			cls: "format-checker-panel-output",
		});
		this.outputDiv.style.display = "none";

		// Footer: status + apply button
		this.footerEl = this.containerEl.createDiv({
			cls: "format-checker-panel-footer",
		});
		this.footerStatus = this.footerEl.createEl("span", {
			cls: "format-checker-panel-status",
			text: "Checking with Claude...",
		});
		this.applyBtn = this.footerEl.createEl("button", {
			cls: "format-checker-apply-btn",
			text: "Apply fixes",
		});
		this.applyBtn.style.display = "none";
		this.applyBtn.addEventListener("click", () => this.onApplyClick());
	}

	updateContent(update: StreamUpdate): void {
		// Show thinking
		if (update.thinking) {
			this.thinkingEl.style.display = "";
			this.thinkingTextEl.textContent = update.thinking;
			this.thinkingTextEl.scrollTop = this.thinkingTextEl.scrollHeight;
		}

		// Show text output
		if (update.text) {
			this.footerStatus.setText("Writing response...");
			this.streamEl.style.display = "";
			this.streamEl.textContent = update.text;
			this.streamEl.scrollTop = this.streamEl.scrollHeight;
		}
	}

	finalize(result: FormatCheckResult): void {
		this.accumulated = result.output;

		if (!result.success) {
			this.footerStatus.setText(result.error ?? "An error occurred.");
			this.footerStatus.addClass("format-checker-panel-status-error");
			this.footerStatus.style.animation = "none";
		} else {
			// Hide status, show apply button
			this.footerStatus.style.display = "none";
			if (this.accumulated && this.applyCtx) {
				this.applyBtn.style.display = "";
			}
		}

		// Collapse thinking
		this.thinkingEl.style.display = "none";

		if (this.accumulated) {
			this.copyBtn.style.display = "";
		}

		// Switch from plain text to rendered markdown
		this.streamEl.style.display = "none";
		this.outputDiv.style.display = "";
		void this.renderMarkdown();
	}

	private async renderMarkdown(): Promise<void> {
		if (!this.accumulated) return;
		this.outputDiv.empty();
		this.renderComponent.unload();
		this.renderComponent = new Component();
		this.renderComponent.load();
		await MarkdownRenderer.render(
			this.app,
			this.accumulated,
			this.outputDiv,
			"",
			this.renderComponent
		);
	}

	close(): void {
		this.isClosed = true;
		this.renderComponent.unload();
		this.containerEl.remove();
	}

	private restoreApplyButton(): void {
		this.footerStatus.style.display = "none";
		this.applyBtn.style.display = "";
		this.applyBtn.setText("Apply fixes");
	}

	private async onApplyClick(): Promise<void> {
		if (this.isApplying || !this.applyCtx) return;

		// Check editor is still usable
		try {
			this.applyCtx.editor.getValue();
		} catch {
			new Notice("The editor is no longer available. Re-open the file and try again.");
			return;
		}

		this.isApplying = true;

		// Hide the check results and show streaming UI for apply
		this.applyBtn.style.display = "none";
		this.outputDiv.style.display = "none";
		this.footerStatus.style.display = "";
		this.footerStatus.setText("Applying fixes...");
		this.footerStatus.removeClass("format-checker-panel-status-error");
		this.footerStatus.style.animation = "";
		this.thinkingEl.style.display = "none";
		this.thinkingTextEl.textContent = "";
		this.streamEl.style.display = "none";
		this.streamEl.textContent = "";

		const prompt = buildApplyFixPrompt(
			this.fileName,
			this.applyCtx.fileContent,
			this.accumulated,
			this.applyCtx.settings
		);

		runClaudeCheckStreaming(prompt, this.applyCtx.settings, {
			onData: (update) => {
				if (this.isClosed) return;
				if (update.thinking) {
					this.thinkingEl.style.display = "";
					this.thinkingTextEl.textContent = update.thinking;
					this.thinkingTextEl.scrollTop = this.thinkingTextEl.scrollHeight;
				}
				if (update.text) {
					this.footerStatus.setText("Writing edits...");
					this.streamEl.style.display = "";
					this.streamEl.textContent = update.text;
					this.streamEl.scrollTop = this.streamEl.scrollHeight;
				}
			},
			onDone: (result) => {
				if (this.isClosed) return;

				this.isApplying = false;
				this.thinkingEl.style.display = "none";
				this.streamEl.style.display = "none";

				// Restore the check results view
				this.outputDiv.style.display = "";

				if (!result.success || !result.output.trim()) {
					this.restoreApplyButton();
					new Notice(result.error ?? "Apply failed — no output received.");
					return;
				}

				// Parse search/replace blocks and apply them
				const blocks = parseSearchReplaceBlocks(result.output);
				if (blocks.length === 0) {
					this.restoreApplyButton();
					new Notice("No edits could be parsed from the response.");
					return;
				}

				let content = this.applyCtx!.fileContent;
				let applied = 0;
				for (const block of blocks) {
					if (content.includes(block.search)) {
						content = content.replace(block.search, block.replace);
						applied++;
					}
				}

				if (applied === 0) {
					this.restoreApplyButton();
					new Notice("None of the edits matched the file content.");
					return;
				}

				try {
					this.applyCtx!.editor.setValue(content);
				} catch {
					new Notice("Could not update the editor. The file may have been closed.");
					this.restoreApplyButton();
					return;
				}

				// Success feedback
				const msg = applied === blocks.length
					? `All ${applied} fixes applied.`
					: `${applied} of ${blocks.length} fixes applied.`;
				this.footerStatus.setText(`${msg} Use Ctrl/Cmd+Z to undo.`);
				this.footerStatus.style.animation = "none";

				// Update stored content so re-apply uses corrected version
				this.applyCtx!.fileContent = content;
			},
		});
	}
}

function parseSearchReplaceBlocks(
	output: string
): { search: string; replace: string }[] {
	const blocks: { search: string; replace: string }[] = [];
	const regex = /<<<SEARCH\n([\s\S]*?)\n===\n([\s\S]*?)\n>>>/g;
	let match;
	while ((match = regex.exec(output)) !== null) {
		blocks.push({ search: match[1]!, replace: match[2]! });
	}
	return blocks;
}
