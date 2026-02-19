import { MarkdownView, Notice } from "obsidian";
import type MarkdownFormatCheckerPlugin from "../main";
import type { ApplyFixContext } from "../types";
import { runAIStreaming } from "../utils/aiProvider";
import { buildFormatCheckPrompt } from "../utils/promptBuilder";
import { FormatCheckPanel } from "../ui/resultsModal";

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

	const prompt = buildFormatCheckPrompt(
		fileName,
		fileContent,
		plugin.settings
	);

	const applyCtx: ApplyFixContext = {
		editor: view.editor,
		fileContent,
		settings: plugin.settings,
	};
	const panel = new FormatCheckPanel(plugin.app, fileName, prompt, applyCtx);

	runAIStreaming(plugin.app, prompt, plugin.settings, {
		onData: (update) => {
			panel.updateContent(update);
		},
		onDone: (result) => {
			isRunning = false;
			panel.finalize(result);
		},
	});
}
