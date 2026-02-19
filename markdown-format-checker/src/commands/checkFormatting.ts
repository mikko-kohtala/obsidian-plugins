import { MarkdownView, Notice } from "obsidian";
import type MarkdownFormatCheckerPlugin from "../main";
import { runClaudeCheck } from "../utils/claudeRunner";
import { buildFormatCheckPrompt } from "../utils/promptBuilder";
import { FormatCheckResultsModal } from "../ui/resultsModal";

let isRunning = false;

export function registerCheckFormattingCommand(
	plugin: MarkdownFormatCheckerPlugin
): void {
	plugin.addCommand({
		id: "check-formatting",
		name: "Check formatting of current file",
		checkCallback: (checking: boolean) => {
			const view =
				plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) {
				return false;
			}
			if (!checking) {
				void performFormatCheck(plugin, view);
			}
			return true;
		},
	});
}

async function performFormatCheck(
	plugin: MarkdownFormatCheckerPlugin,
	view: MarkdownView
): Promise<void> {
	if (isRunning) {
		new Notice("A formatting check is already in progress.");
		return;
	}

	const file = view.file;
	if (!file) {
		new Notice("No file is currently open.");
		return;
	}

	const fileName = file.path;
	const fileContent = view.editor.getValue();

	if (!fileContent.trim()) {
		new Notice("The current file is empty.");
		return;
	}

	isRunning = true;
	const loadingNotice = new Notice("Checking formatting with Claude...", 0);

	try {
		const prompt = buildFormatCheckPrompt(
			fileName,
			fileContent,
			plugin.settings
		);
		const result = await runClaudeCheck(prompt, plugin.settings);

		loadingNotice.hide();
		new FormatCheckResultsModal(plugin.app, result).open();
	} catch (err) {
		loadingNotice.hide();
		new Notice(
			`Format check failed: ${err instanceof Error ? err.message : String(err)}`
		);
	} finally {
		isRunning = false;
	}
}
