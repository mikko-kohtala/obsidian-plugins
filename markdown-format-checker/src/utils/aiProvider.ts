import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMoonshotAI } from "@ai-sdk/moonshotai";
import type { LanguageModel } from "ai";
import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";
import type { IncomingMessage } from "http";
import type { FormatCheckResult } from "../types";
import type { MarkdownFormatCheckerSettings } from "../settings";

const TAG = "[format-checker]";

export interface StreamUpdate {
	thinking: string;
	text: string;
}

export interface StreamCallbacks {
	onData: (update: StreamUpdate) => void;
	onDone: (result: FormatCheckResult) => void;
}

/**
 * Node.js-based fetch that bypasses CORS restrictions in Obsidian's Electron.
 * Browser fetch enforces CORS even in Electron; Node.js http/https do not.
 */
const nodeFetch: typeof globalThis.fetch = (input, init) => {
	return new Promise((resolve, reject) => {
		const url =
			typeof input === "string"
				? new URL(input)
				: input instanceof URL
					? input
					: new URL(input.url);

		const headers: Record<string, string> = {};
		if (init?.headers) {
			if (init.headers instanceof Headers) {
				init.headers.forEach((v, k) => { headers[k] = v; });
			} else if (Array.isArray(init.headers)) {
				for (const [k, v] of init.headers) headers[k] = v;
			} else {
				Object.assign(headers, init.headers);
			}
		}

		const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
		const req = requestFn(url, { method: init?.method ?? "GET", headers }, (res: IncomingMessage) => {
			const resHeaders = new Headers();
			for (const [k, v] of Object.entries(res.headers)) {
				if (v != null) resHeaders.set(k, Array.isArray(v) ? v.join(", ") : v);
			}

			const body = new ReadableStream({
				start(controller) {
					res.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
					res.on("end", () => controller.close());
					res.on("error", (e) => controller.error(e));
				},
				cancel() { res.destroy(); },
			});

			resolve(new Response(body, {
				status: res.statusCode ?? 200,
				statusText: res.statusMessage ?? "",
				headers: resHeaders,
			}));
		});

		req.on("error", reject);

		if (init?.signal) {
			if (init.signal.aborted) {
				req.destroy();
				reject(new DOMException("Aborted", "AbortError"));
				return;
			}
			init.signal.addEventListener("abort", () => {
				req.destroy();
				reject(new DOMException("Aborted", "AbortError"));
			}, { once: true });
		}

		if (typeof init?.body === "string") {
			req.end(init.body);
		} else if (init?.body instanceof ArrayBuffer || init?.body instanceof Uint8Array) {
			req.end(Buffer.from(init.body as ArrayBuffer));
		} else {
			req.end();
		}
	});
};

function createModel(settings: MarkdownFormatCheckerSettings): LanguageModel {
	switch (settings.provider) {
		case "claude": {
			const anthropic = createAnthropic({
				apiKey: settings.claudeApiKey,
				fetch: nodeFetch,
			});
			return anthropic(settings.claudeModel);
		}
		case "gemini": {
			const google = createGoogleGenerativeAI({
				apiKey: settings.geminiApiKey,
				fetch: nodeFetch,
			});
			return google(settings.geminiModel);
		}
		case "moonshot": {
			const moonshot = createMoonshotAI({
				apiKey: settings.moonshotApiKey,
				fetch: nodeFetch,
			});
			return moonshot(settings.moonshotModel);
		}
	}
}

export function runAIStreaming(
	prompt: string,
	settings: MarkdownFormatCheckerSettings,
	callbacks: StreamCallbacks
): void {
	void runSDKStreaming(prompt, settings, callbacks);
}

async function runSDKStreaming(
	prompt: string,
	settings: MarkdownFormatCheckerSettings,
	callbacks: StreamCallbacks
): Promise<void> {
	let thinkingText = "";
	let outputText = "";

	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, settings.timeoutMs);

	const providerName = settings.provider;
	console.log(TAG, "starting", providerName, "| timeout:", settings.timeoutMs / 1000 + "s");

	try {
		const model = createModel(settings);
		const result = streamText({
			model,
			prompt,
			abortSignal: controller.signal,
		});

		for await (const part of result.fullStream) {
			switch (part.type) {
				case "reasoning-delta":
					thinkingText += part.text;
					callbacks.onData({ thinking: thinkingText, text: outputText });
					break;
				case "text-delta":
					outputText += part.text;
					callbacks.onData({ thinking: thinkingText, text: outputText });
					break;
				case "error":
					throw part.error;
				case "finish":
					console.log(TAG, "done |",
						"output:", outputText.length, "chars |",
						"tokens:", part.totalUsage?.totalTokens ?? "?");
					break;
			}
		}

		clearTimeout(timer);
		callbacks.onDone({
			success: true,
			output: outputText,
			exitCode: 0,
		});
	} catch (error: unknown) {
		clearTimeout(timer);
		const message = error instanceof Error ? error.message : String(error);

		if (controller.signal.aborted) {
			console.warn(TAG, "timeout after", settings.timeoutMs / 1000 + "s");
			callbacks.onDone({
				success: false,
				output: outputText,
				error: `Timed out after ${settings.timeoutMs / 1000} seconds. You can increase the timeout in settings.`,
				timedOut: true,
			});
			return;
		}

		console.error(TAG, providerName, "error:", message);
		callbacks.onDone({
			success: false,
			output: outputText,
			error: message,
		});
	}
}
