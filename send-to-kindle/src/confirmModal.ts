import { App, Modal, Setting } from "obsidian";

/** A yes/no question. Resolves false when dismissed. */
export function confirm(
	app: App,
	title: string,
	message: string,
	confirmLabel: string,
): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmModal(app, title, message, confirmLabel, resolve).open();
	});
}

class ConfirmModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private readonly heading: string,
		private readonly message: string,
		private readonly confirmLabel: string,
		private readonly answer: (confirmed: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.heading);
		this.contentEl.createEl("p", { text: this.message });
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText(this.confirmLabel)
					.setCta()
					.onClick(() => {
						this.answered = true;
						this.answer(true);
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.answered) this.answer(false);
	}
}
