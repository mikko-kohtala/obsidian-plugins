import { spawn } from "child_process";
import type { FormatCheckResult } from "../types";
import type { MarkdownFormatCheckerSettings } from "../settings";
import { homedir } from "os";

const TAG = "[format-checker]";

function resolvePath(p: string): string {
	if (p.startsWith("~/")) {
		return homedir() + p.slice(1);
	}
	return p;
}

export interface StreamUpdate {
	thinking: string;
	text: string;
}

export interface StreamCallbacks {
	onData: (update: StreamUpdate) => void;
	onDone: (result: FormatCheckResult) => void;
}

interface ParsedDelta {
	kind: "thinking" | "text";
	content: string;
}

function extractDelta(line: string): ParsedDelta | null {
	try {
		const event = JSON.parse(line);

		if (event.type === "stream_event") {
			const inner = event.event;
			if (inner?.type === "content_block_delta") {
				const delta = inner.delta;
				if (delta?.type === "thinking_delta" && delta.thinking) {
					return { kind: "thinking", content: delta.thinking };
				}
				if (delta?.type === "text_delta" && delta.text) {
					return { kind: "text", content: delta.text };
				}
			}
			return null;
		}

		if (event.type === "content_block_delta") {
			const delta = event.delta;
			if (delta?.type === "thinking_delta" && delta.thinking) {
				return { kind: "thinking", content: delta.thinking };
			}
			if (delta?.type === "text_delta" && delta.text) {
				return { kind: "text", content: delta.text };
			}
		}

		return null;
	} catch {
		return null;
	}
}

function extractModel(line: string): string | null {
	try {
		const event = JSON.parse(line);
		if (event.type === "stream_event" && event.event?.type === "message_start") {
			return event.event.message?.model ?? null;
		}
		return null;
	} catch {
		return null;
	}
}

function extractResult(line: string): { text: string; cost?: number; duration?: number } | null {
	try {
		const event = JSON.parse(line);
		if (event.type === "result" && typeof event.result === "string") {
			return {
				text: event.result,
				cost: event.total_cost_usd,
				duration: event.duration_ms,
			};
		}
		return null;
	} catch {
		return null;
	}
}

export function runClaudeCheckStreaming(
	prompt: string,
	settings: MarkdownFormatCheckerSettings,
	callbacks: StreamCallbacks
): void {
	const env = { ...process.env };
	delete env.CLAUDECODE;

	let resolved = false;
	let thinkingText = "";
	let outputText = "";
	let stderr = "";
	let lineBuffer = "";

	const binaryPath = resolvePath(settings.claudeBinaryPath);
	const args = [
		"-p",
		"--model", settings.claudeModel,
		"--output-format", "stream-json",
		"--verbose",
		"--include-partial-messages",
	];

	console.log(TAG, "spawning:", binaryPath, args.join(" "));
	console.log(TAG, "model:", settings.claudeModel, "| timeout:", settings.timeoutMs / 1000 + "s");

	const child = spawn(binaryPath, args, {
		env,
		stdio: ["pipe", "pipe", "pipe"],
	});

	console.log(TAG, "process started, pid:", child.pid);

	child.stdout.on("data", (data: Buffer) => {
		lineBuffer += data.toString();

		const lines = lineBuffer.split("\n");
		lineBuffer = lines.pop() ?? "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			// Log model from message_start
			const model = extractModel(trimmed);
			if (model) {
				console.log(TAG, "model confirmed:", model);
			}

			// Check for final result
			const result = extractResult(trimmed);
			if (result) {
				outputText = result.text;
				console.log(TAG, "done |",
					"output:", outputText.length, "chars |",
					"cost: $" + (result.cost?.toFixed(4) ?? "?") + " |",
					"duration:", (result.duration ?? 0) / 1000 + "s");
				callbacks.onData({ thinking: thinkingText, text: outputText });
				continue;
			}

			// Check for streaming delta
			const delta = extractDelta(trimmed);
			if (delta) {
				if (delta.kind === "thinking") {
					thinkingText += delta.content;
				} else {
					outputText += delta.content;
				}
				callbacks.onData({ thinking: thinkingText, text: outputText });
			}
		}
	});

	child.stderr.on("data", (data: Buffer) => {
		stderr += data.toString();
	});

	child.on("error", (error: NodeJS.ErrnoException) => {
		if (resolved) return;
		resolved = true;
		clearTimeout(timer);
		console.error(TAG, "spawn error:", error.code, error.message);

		if (error.code === "ENOENT") {
			callbacks.onDone({
				success: false,
				output: "",
				error: `Claude CLI not found at "${settings.claudeBinaryPath}". Please install Claude Code or update the binary path in settings.`,
			});
		} else {
			callbacks.onDone({
				success: false,
				output: outputText,
				error: `Failed to start Claude CLI: ${error.message}`,
			});
		}
	});

	child.on("close", (code: number | null) => {
		if (resolved) return;
		resolved = true;
		clearTimeout(timer);
		console.log(TAG, "process exited, code:", code);

		if (code !== 0) {
			console.error(TAG, "non-zero exit |", stderr.slice(0, 200));
			callbacks.onDone({
				success: false,
				output: outputText,
				error: `Claude CLI exited with code ${code}${stderr ? "\nStderr: " + stderr : ""}`,
				exitCode: code ?? undefined,
			});
			return;
		}

		callbacks.onDone({
			success: true,
			output: outputText,
			exitCode: 0,
		});
	});

	console.log(TAG, "sending prompt:", prompt.length, "chars");
	child.stdin.write(prompt);
	child.stdin.end();

	const timer = setTimeout(() => {
		if (resolved) return;
		resolved = true;
		child.kill("SIGTERM");
		console.warn(TAG, "timeout after", settings.timeoutMs / 1000 + "s");
		callbacks.onDone({
			success: false,
			output: outputText,
			error: `Claude CLI timed out after ${settings.timeoutMs / 1000} seconds. You can increase the timeout in settings.`,
			timedOut: true,
		});
	}, settings.timeoutMs);
}
