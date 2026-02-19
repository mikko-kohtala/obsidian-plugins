import { MarkdownView, Notice, parseYaml } from "obsidian";
import type WebClipperVerifierPlugin from "../main";
import type { VerifyContext } from "../types";
import { runAIStreaming } from "../utils/aiProvider";
import { extractFromUrl, FetchError } from "../utils/htmlExtractor";
import { buildVerifyPrompt } from "../utils/promptBuilder";
import { ClipperVerifyPanel } from "../ui/resultsModal";

const TAG = "[clipper-verifier]";

let isRunning = false;

export function registerVerifyClippingCommand(
	plugin: WebClipperVerifierPlugin
): void {
	plugin.addCommand({
		id: "verify-clipping",
		name: "Verify clipping against source",
		checkCallback: (checking: boolean) => {
			const view =
				plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) {
				return false;
			}
			if (!checking) {
				void performVerification(plugin, view);
			}
			return true;
		},
	});
}

function extractFrontmatter(content: string): { yaml: Record<string, unknown>; body: string } | null {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return null;

	try {
		const yaml = parseYaml(match[1]!) as Record<string, unknown>;
		return { yaml, body: match[2]! };
	} catch {
		return null;
	}
}

function getSourceUrl(yaml: Record<string, unknown>): string | null {
	// Web Clipper uses "source" field
	const source = yaml["source"];
	if (typeof source === "string" && source.trim()) {
		try {
			new URL(source.trim());
			return source.trim();
		} catch {
			return null;
		}
	}

	// Also check "url" as fallback
	const url = yaml["url"];
	if (typeof url === "string" && url.trim()) {
		try {
			new URL(url.trim());
			return url.trim();
		} catch {
			return null;
		}
	}

	return null;
}

async function performVerification(
	plugin: WebClipperVerifierPlugin,
	view: MarkdownView
): Promise<void> {
	if (isRunning) {
		new Notice("A verification is already in progress.");
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

	// Parse frontmatter
	const parsed = extractFrontmatter(fileContent);
	if (!parsed) {
		new Notice("No frontmatter found. This file doesn't appear to be a web clipping.");
		return;
	}

	const sourceUrl = getSourceUrl(parsed.yaml);
	if (!sourceUrl) {
		new Notice("No 'source' URL found in frontmatter. This file doesn't appear to be a web clipping.");
		return;
	}

	isRunning = true;

	const verifyCtx: VerifyContext = {
		fileContent,
		settings: plugin.settings,
	};

	// Create panel immediately to show status
	const panel = new ClipperVerifyPanel(plugin.app, fileName, "", verifyCtx);
	panel.setStatus(`Fetching source: ${sourceUrl}`);

	try {
		// Fetch and extract source content
		const sourceContent = await extractFromUrl(sourceUrl, plugin.settings);

		panel.setStatus(`Comparing with ${plugin.settings.provider}...`);

		// Build prompt
		const prompt = buildVerifyPrompt(sourceContent, parsed.body, plugin.settings);

		// Update panel's initial prompt for chat history
		(panel as any).initialPrompt = prompt;

		// Stream AI comparison
		runAIStreaming(plugin.app, prompt, plugin.settings, {
			onData: (update) => {
				panel.updateContent(update);
			},
			onDone: (result) => {
				isRunning = false;
				panel.finalize(result);
			},
		});
	} catch (error: unknown) {
		isRunning = false;
		if (error instanceof FetchError) {
			console.error(TAG, "fetch error:", error.message, "status:", error.statusCode);
			panel.setStatus(error.message, true);
		} else {
			const msg = error instanceof Error ? error.message : String(error);
			console.error(TAG, "error:", msg);
			panel.setStatus(`Error: ${msg}`, true);
		}
	}
}
