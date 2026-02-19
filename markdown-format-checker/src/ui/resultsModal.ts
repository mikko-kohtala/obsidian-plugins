import { App, Component, MarkdownRenderer, Notice, setIcon } from "obsidian";
import type { ApplyFixContext, FormatCheckResult } from "../types";
import type { ChatMessage, StreamUpdate } from "../utils/aiProvider";
import { runAIChatStreaming, runAIStreaming } from "../utils/aiProvider";
import { buildApplyFixPrompt } from "../utils/promptBuilder";

const CHAT_SYSTEM = `You are a markdown formatting assistant for Obsidian.

When asked to fix formatting issues, output SEARCH/REPLACE blocks using this exact format:

<<<SEARCH
exact text to find
===
replacement text
>>>

Rules for fix blocks:
- Output ONLY SEARCH/REPLACE blocks, no commentary or explanations
- The SEARCH text must be an EXACT match of the original file content (including whitespace and newlines)
- Include enough context in SEARCH to be unique (typically 1-3 lines)
- Preserve all content, links, and meaning — only fix formatting
- Each block fixes one issue`;

export class FormatCheckPanel {
	private app: App;
	private fileName: string;
	private initialPrompt: string;
	private applyCtx: ApplyFixContext | null;
	private renderComponent: Component;
	private containerEl: HTMLDivElement;
	private thinkingEl: HTMLDivElement;
	private thinkingTextEl: HTMLPreElement;
	private streamEl: HTMLPreElement;
	private outputDiv: HTMLDivElement;
	private copyBtn: HTMLButtonElement;
	private fixAllBtn: HTMLButtonElement;
	private applyBtn: HTMLButtonElement;
	private footerEl: HTMLDivElement;
	private footerStatus: HTMLSpanElement;
	private chatRowEl: HTMLDivElement;
	private chatInputEl: HTMLTextAreaElement;
	private chatSendBtn: HTMLButtonElement;
	private chatHistory: ChatMessage[] = [];
	private accumulated = "";
	private isBusy = false;
	private isClosed = false;

	constructor(app: App, fileName: string, initialPrompt: string, applyCtx: ApplyFixContext | null = null) {
		this.app = app;
		this.fileName = fileName;
		this.initialPrompt = initialPrompt;
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
		this.thinkingEl.createDiv({
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

		// Footer
		this.footerEl = this.containerEl.createDiv({
			cls: "format-checker-panel-footer",
		});
		const providerLabel = this.applyCtx?.settings.provider ?? "AI";
		this.footerStatus = this.footerEl.createEl("span", {
			cls: "format-checker-panel-status",
			text: `Checking with ${providerLabel}...`,
		});

		// Fix all button (asks AI to generate SEARCH/REPLACE blocks)
		this.fixAllBtn = this.footerEl.createEl("button", {
			cls: "format-checker-apply-btn",
			text: "Fix all",
		});
		this.fixAllBtn.style.display = "none";
		this.fixAllBtn.addEventListener("click", () => this.onFixAllClick());

		// Apply edits button (shown when response has SEARCH/REPLACE blocks)
		this.applyBtn = this.footerEl.createEl("button", {
			cls: "format-checker-apply-btn format-checker-apply-edits-btn",
			text: "Apply edits",
		});
		this.applyBtn.style.display = "none";
		this.applyBtn.addEventListener("click", () => this.onApplyClick());

		// Chat input row (hidden until first check completes)
		this.chatRowEl = this.footerEl.createDiv({
			cls: "format-checker-chat-row",
		});
		this.chatRowEl.style.display = "none";

		this.chatInputEl = this.chatRowEl.createEl("textarea", {
			cls: "format-checker-chat-input",
			attr: { placeholder: "Ask a follow-up...", rows: "1" },
		});
		this.chatInputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.sendChat();
			}
		});
		this.chatInputEl.addEventListener("input", () => {
			this.chatInputEl.style.height = "auto";
			this.chatInputEl.style.height = Math.min(this.chatInputEl.scrollHeight, 80) + "px";
		});

		this.chatSendBtn = this.chatRowEl.createEl("button", {
			cls: "clickable-icon format-checker-chat-send",
			attr: { "aria-label": "Send" },
		});
		setIcon(this.chatSendBtn, "send-horizontal");
		this.chatSendBtn.addEventListener("click", () => this.sendChat());
	}

	updateContent(update: StreamUpdate): void {
		if (update.thinking) {
			this.thinkingEl.style.display = "";
			this.thinkingTextEl.textContent = update.thinking;
			this.thinkingTextEl.scrollTop = this.thinkingTextEl.scrollHeight;
		}

		if (update.text) {
			this.footerStatus.setText("Writing response...");
			this.streamEl.style.display = "";
			this.streamEl.textContent = update.text;
			this.streamEl.scrollTop = this.streamEl.scrollHeight;
		}
	}

	finalize(result: FormatCheckResult): void {
		this.accumulated = result.output;
		this.isBusy = false;

		if (!result.success) {
			this.footerStatus.setText(result.error ?? "An error occurred.");
			this.footerStatus.addClass("format-checker-panel-status-error");
			this.footerStatus.style.animation = "none";
			this.chatRowEl.style.display = "";
			return;
		}

		this.footerStatus.style.display = "none";

		// Store conversation history
		if (this.chatHistory.length === 0) {
			this.chatHistory.push({ role: "user", content: this.initialPrompt });
		}
		this.chatHistory.push({ role: "assistant", content: this.accumulated });

		// Collapse thinking
		this.thinkingEl.style.display = "none";

		if (this.accumulated) {
			this.copyBtn.style.display = "";
		}

		// Switch from plain text to rendered markdown
		this.streamEl.style.display = "none";
		this.outputDiv.style.display = "";
		void this.renderMarkdown();

		// Show appropriate buttons
		const blocks = parseSearchReplaceBlocks(this.accumulated);
		if (blocks.length > 0 && this.applyCtx) {
			// Response has fix blocks — show "Apply edits", hide "Fix all"
			this.applyBtn.style.display = "";
			this.fixAllBtn.style.display = "none";
		} else if (this.applyCtx) {
			// Normal check result — show "Fix all", hide "Apply edits"
			this.applyBtn.style.display = "none";
			this.fixAllBtn.style.display = "";
		}

		// Show chat input
		this.chatRowEl.style.display = "";
		this.chatInputEl.focus();
	}

	private sendChat(): void {
		const text = this.chatInputEl.value.trim();
		if (!text || this.isBusy) return;

		this.chatInputEl.value = "";
		this.chatInputEl.style.height = "auto";

		this.chatHistory.push({ role: "user", content: text });
		this.startStreaming();

		const settings = this.applyCtx?.settings;
		if (!settings) return;

		if (settings.debugLogs) {
			console.log("[format-checker] [debug] chat send:", text);
			console.log("[format-checker] [debug] chat history length:", this.chatHistory.length);
		}

		runAIChatStreaming(this.app, CHAT_SYSTEM, [...this.chatHistory], settings, {
			onData: (update) => {
				if (this.isClosed) return;
				this.updateContent(update);
			},
			onDone: (result) => {
				if (this.isClosed) return;
				this.finalize(result);
			},
		});
	}

	private startStreaming(): void {
		this.isBusy = true;
		this.fixAllBtn.style.display = "none";
		this.applyBtn.style.display = "none";
		this.outputDiv.style.display = "none";
		this.footerStatus.style.display = "";
		this.footerStatus.setText("Thinking...");
		this.footerStatus.removeClass("format-checker-panel-status-error");
		this.footerStatus.style.animation = "";
		this.thinkingEl.style.display = "none";
		this.thinkingTextEl.textContent = "";
		this.streamEl.style.display = "none";
		this.streamEl.textContent = "";
		this.chatRowEl.style.display = "none";
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

	private onFixAllClick(): void {
		if (this.isBusy || !this.applyCtx) return;

		const prompt = buildApplyFixPrompt(
			this.fileName,
			this.applyCtx.fileContent,
			this.accumulated,
			this.applyCtx.settings
		);

		this.startStreaming();

		runAIStreaming(this.app, prompt, this.applyCtx.settings, {
			onData: (update) => {
				if (this.isClosed) return;
				this.updateContent(update);
			},
			onDone: (result) => {
				if (this.isClosed) return;
				this.finalize(result);
			},
		});
	}

	private onApplyClick(): void {
		if (!this.applyCtx) return;

		try {
			this.applyCtx.editor.getValue();
		} catch {
			new Notice("The editor is no longer available. Re-open the file and try again.");
			return;
		}

		const blocks = parseSearchReplaceBlocks(this.accumulated);
		if (blocks.length === 0) {
			new Notice("No edits could be parsed from the response.");
			return;
		}

		let content = this.applyCtx.fileContent;
		let applied = 0;
		for (const block of blocks) {
			if (content.includes(block.search)) {
				content = content.replace(block.search, block.replace);
				applied++;
			}
		}

		if (applied === 0) {
			new Notice("None of the edits matched the file content.");
			return;
		}

		try {
			this.applyCtx.editor.setValue(content);
		} catch {
			new Notice("Could not update the editor. The file may have been closed.");
			return;
		}

		this.applyCtx.fileContent = content;
		this.applyBtn.style.display = "none";
		const msg = applied === blocks.length
			? `All ${applied} fixes applied.`
			: `${applied} of ${blocks.length} fixes applied.`;
		this.footerStatus.style.display = "";
		this.footerStatus.setText(`${msg} Ctrl/Cmd+Z to undo.`);
		this.footerStatus.style.animation = "none";
	}
}

function parseSearchReplaceBlocks(
	output: string
): { search: string; replace: string }[] {
	// Strip markdown code fences that models often wrap output in
	const stripped = output.replace(/^```[\w]*\n?/gm, "").replace(/^```$/gm, "");

	const blocks: { search: string; replace: string }[] = [];
	const regex = /<<<\s*SEARCH\s*\r?\n([\s\S]*?)\r?\n===\r?\n([\s\S]*?)\r?\n>>>/g;
	let match;
	while ((match = regex.exec(stripped)) !== null) {
		blocks.push({ search: match[1]!, replace: match[2]! });
	}

	if (blocks.length === 0 && output.includes("<<<")) {
		console.log("[format-checker] no SEARCH/REPLACE blocks parsed. Raw output:", output.slice(0, 500));
	}

	return blocks;
}
