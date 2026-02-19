import type { FormatCheckResult } from "../types";
import type { MarkdownFormatCheckerSettings } from "../settings";
import { runClaudeCheckStreaming } from "./claudeRunner";
import { runGeminiStreaming } from "./geminiRunner";

export interface StreamUpdate {
	thinking: string;
	text: string;
}

export interface StreamCallbacks {
	onData: (update: StreamUpdate) => void;
	onDone: (result: FormatCheckResult) => void;
}

export function runAIStreaming(
	prompt: string,
	settings: MarkdownFormatCheckerSettings,
	callbacks: StreamCallbacks
): void {
	if (settings.provider === "gemini") {
		runGeminiStreaming(prompt, settings, callbacks);
	} else {
		runClaudeCheckStreaming(prompt, settings, callbacks);
	}
}
