import type { Editor } from "obsidian";
import type { MarkdownFormatCheckerSettings } from "./settings";

export interface FormatCheckResult {
	success: boolean;
	output: string;
	error?: string;
	timedOut?: boolean;
	exitCode?: number;
}

export interface ApplyFixContext {
	editor: Editor;
	fileContent: string;
	settings: MarkdownFormatCheckerSettings;
}
