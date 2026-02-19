import { App, Component, MarkdownRenderer, Modal } from "obsidian";
import type { FormatCheckResult } from "../types";

export class FormatCheckResultsModal extends Modal {
	private result: FormatCheckResult;
	private renderComponent: Component;

	constructor(app: App, result: FormatCheckResult) {
		super(app);
		this.result = result;
		this.renderComponent = new Component();
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		this.renderComponent.load();

		contentEl.addClass("format-checker-modal");

		contentEl.createEl("h2", { text: "Markdown Format Check Results" });

		if (!this.result.success) {
			const errorContainer = contentEl.createDiv({
				cls: "format-checker-error",
			});
			errorContainer.createEl("p", {
				text: this.result.error ?? "An unknown error occurred.",
				cls: "format-checker-error-message",
			});

			if (this.result.timedOut) {
				errorContainer.createEl("p", {
					text: "Tip: You can increase the timeout in the plugin settings.",
					cls: "format-checker-tip",
				});
			}

			if (this.result.output) {
				contentEl.createEl("h3", { text: "Partial Output" });
				const outputDiv = contentEl.createDiv({
					cls: "format-checker-output",
				});
				await MarkdownRenderer.render(
					this.app,
					this.result.output,
					outputDiv,
					"",
					this.renderComponent
				);
			}
			return;
		}

		const outputDiv = contentEl.createDiv({ cls: "format-checker-output" });
		await MarkdownRenderer.render(
			this.app,
			this.result.output,
			outputDiv,
			"",
			this.renderComponent
		);
	}

	onClose(): void {
		this.renderComponent.unload();
		this.contentEl.empty();
	}
}
