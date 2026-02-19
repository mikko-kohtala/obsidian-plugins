import { App, Component, MarkdownRenderer, Notice, setIcon } from "obsidian";
import type { VerifyContext, VerifyResult } from "../types";
import type { ChatMessage, StreamUpdate } from "../utils/aiProvider";
import { runAIChatStreaming } from "../utils/aiProvider";

const CHAT_SYSTEM = `You are a web clipping verification assistant for Obsidian.
You help users understand differences between their clipped markdown notes and the original source pages.
Answer follow-up questions about the verification results concisely and helpfully.`;

export class ClipperVerifyPanel {
	private app: App;
	private fileName: string;
	private initialPrompt: string;
	private verifyCtx: VerifyContext | null;
	private renderComponent: Component;
	private containerEl: HTMLDivElement;
	private thinkingEl: HTMLDivElement;
	private thinkingTextEl: HTMLPreElement;
	private streamEl: HTMLPreElement;
	private outputDiv: HTMLDivElement;
	private copyBtn: HTMLButtonElement;
	private footerEl: HTMLDivElement;
	private footerStatus: HTMLSpanElement;
	private chatRowEl: HTMLDivElement;
	private chatInputEl: HTMLTextAreaElement;
	private chatSendBtn: HTMLButtonElement;
	private chatHistory: ChatMessage[] = [];
	private accumulated = "";
	private isBusy = false;
	private isClosed = false;

	constructor(app: App, fileName: string, initialPrompt: string, verifyCtx: VerifyContext | null = null) {
		this.app = app;
		this.fileName = fileName;
		this.initialPrompt = initialPrompt;
		this.verifyCtx = verifyCtx;
		this.renderComponent = new Component();
		this.containerEl = document.body.createDiv({ cls: "clipper-verifier-panel" });
		this.build();
	}

	private build(): void {
		this.renderComponent.load();

		// Header
		const header = this.containerEl.createDiv({ cls: "clipper-verifier-panel-header" });

		const titleRow = header.createDiv({ cls: "clipper-verifier-panel-title-row" });
		const title = titleRow.createSpan({ cls: "clipper-verifier-panel-title" });
		title.createSpan({ text: "Verify Clipping: " });
		title.createEl("code", { text: this.fileName });

		const actions = titleRow.createDiv({ cls: "clipper-verifier-panel-actions" });

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
			cls: "clipper-verifier-panel-thinking",
		});
		this.thinkingEl.style.display = "none";
		this.thinkingEl.createDiv({
			cls: "clipper-verifier-panel-thinking-label",
			text: "Thinking...",
		});
		this.thinkingTextEl = this.thinkingEl.createEl("pre", {
			cls: "clipper-verifier-panel-thinking-text",
		});

		// Streaming plain text (hidden until text arrives)
		this.streamEl = this.containerEl.createEl("pre", {
			cls: "clipper-verifier-panel-stream",
		});
		this.streamEl.style.display = "none";

		// Rendered markdown output (hidden until finalize)
		this.outputDiv = this.containerEl.createDiv({
			cls: "clipper-verifier-panel-output",
		});
		this.outputDiv.style.display = "none";

		// Footer
		this.footerEl = this.containerEl.createDiv({
			cls: "clipper-verifier-panel-footer",
		});
		this.footerStatus = this.footerEl.createEl("span", {
			cls: "clipper-verifier-panel-status",
			text: "Initializing...",
		});

		// Chat input row (hidden until first check completes)
		this.chatRowEl = this.footerEl.createDiv({
			cls: "clipper-verifier-chat-row",
		});
		this.chatRowEl.style.display = "none";

		this.chatInputEl = this.chatRowEl.createEl("textarea", {
			cls: "clipper-verifier-chat-input",
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
			cls: "clickable-icon clipper-verifier-chat-send",
			attr: { "aria-label": "Send" },
		});
		setIcon(this.chatSendBtn, "send-horizontal");
		this.chatSendBtn.addEventListener("click", () => this.sendChat());
	}

	setStatus(text: string, isError = false): void {
		this.footerStatus.style.display = "";
		this.footerStatus.setText(text);
		if (isError) {
			this.footerStatus.addClass("clipper-verifier-panel-status-error");
			this.footerStatus.style.animation = "none";
		} else {
			this.footerStatus.removeClass("clipper-verifier-panel-status-error");
			this.footerStatus.style.animation = "";
		}
	}

	updateContent(update: StreamUpdate): void {
		if (update.thinking) {
			this.thinkingEl.style.display = "";
			this.thinkingTextEl.textContent = update.thinking;
			this.thinkingTextEl.scrollTop = this.thinkingTextEl.scrollHeight;
		}

		if (update.text) {
			this.setStatus("Writing response...");
			this.streamEl.style.display = "";
			this.streamEl.textContent = update.text;
			this.streamEl.scrollTop = this.streamEl.scrollHeight;
		}
	}

	finalize(result: VerifyResult): void {
		this.accumulated = result.output;
		this.isBusy = false;

		if (!result.success) {
			this.setStatus(result.error ?? "An error occurred.", true);
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

		const settings = this.verifyCtx?.settings;
		if (!settings) return;

		if (settings.debugLogs) {
			console.log("[clipper-verifier] [debug] chat send:", text);
			console.log("[clipper-verifier] [debug] chat history length:", this.chatHistory.length);
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
		this.outputDiv.style.display = "none";
		this.footerStatus.style.display = "";
		this.footerStatus.setText("Thinking...");
		this.footerStatus.removeClass("clipper-verifier-panel-status-error");
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
}
