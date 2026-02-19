import { spawn } from "child_process";
import { dirname } from "path";
import type { FormatCheckResult } from "../types";
import type { MarkdownFormatCheckerSettings } from "../settings";
import type { StreamCallbacks, StreamUpdate } from "./aiProvider";
import { homedir } from "os";

const TAG = "[format-checker]";

function resolvePath(p: string): string {
	if (p.startsWith("~/")) {
		return homedir() + p.slice(1);
	}
	return p;
}

export function runGeminiStreaming(
	prompt: string,
	settings: MarkdownFormatCheckerSettings,
	callbacks: StreamCallbacks
): void {
	let resolved = false;
	let outputText = "";
	let stderr = "";
	let lineBuffer = "";

	const binaryPath = resolvePath(settings.geminiBinaryPath);
	const args = [
		"-p", "",
		"--model", settings.geminiModel,
		"--output-format", "stream-json",
	];

	console.log(TAG, "spawning:", binaryPath, args.join(" "));
	console.log(TAG, "model:", settings.geminiModel, "| timeout:", settings.timeoutMs / 1000 + "s");

	// Gemini CLI is a Node.js script (#!/usr/bin/env node).
	// Obsidian's subprocess may not have node in PATH, so prepend
	// the binary's directory (which contains the node binary too).
	const env = { ...process.env };
	const binDir = dirname(binaryPath);
	env.PATH = binDir + ":" + (env.PATH ?? "");

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

			let event: any;
			try {
				event = JSON.parse(trimmed);
			} catch {
				continue;
			}

			// Accumulate assistant message deltas
			if (
				event.type === "message" &&
				event.role === "assistant" &&
				event.delta === true &&
				typeof event.content === "string"
			) {
				outputText += event.content;
				const update: StreamUpdate = { thinking: "", text: outputText };
				callbacks.onData(update);
				continue;
			}

			// Result event
			if (event.type === "result") {
				const duration = event.stats?.duration_ms;
				const tokens = event.stats?.total_tokens;
				console.log(TAG, "done |",
					"output:", outputText.length, "chars |",
					"tokens:", tokens ?? "?" , "|",
					"duration:", duration ? (duration / 1000 + "s") : "?");

				if (event.status === "error") {
					if (!resolved) {
						resolved = true;
						clearTimeout(timer);
						callbacks.onDone({
							success: false,
							output: outputText,
							error: `Gemini returned an error: ${event.error_message ?? "unknown error"}`,
						});
					}
				}
				continue;
			}

			// Error event
			if (event.type === "error") {
				if (!resolved) {
					resolved = true;
					clearTimeout(timer);
					callbacks.onDone({
						success: false,
						output: outputText,
						error: `Gemini error: ${event.message ?? event.error ?? "unknown error"}`,
					});
				}
				continue;
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
				error: `Gemini CLI not found at "${settings.geminiBinaryPath}". Please install the Gemini CLI or update the binary path in settings.`,
			});
		} else {
			callbacks.onDone({
				success: false,
				output: outputText,
				error: `Failed to start Gemini CLI: ${error.message}`,
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
				error: `Gemini CLI exited with code ${code}${stderr ? "\nStderr: " + stderr : ""}`,
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
			error: `Gemini CLI timed out after ${settings.timeoutMs / 1000} seconds. You can increase the timeout in settings.`,
			timedOut: true,
		});
	}, settings.timeoutMs);
}
