// Runs the local Claude Code CLI headless and follows its progress. Nothing in
// here touches Obsidian, so it can be exercised on its own.
import { spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";

/** "plan" is a dry run: Claude reads and reports, and changes nothing. */
export type PermissionMode = "auto" | "acceptEdits" | "plan";

/** Reasoning effort levels `claude --effort` accepts. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface ClaudeOptions {
	/** Path to the claude binary. */
	claudePath: string;
	/** Prepended to PATH: apps started from the Dock don't get the shell's PATH. */
	extraPath: string;
	/** Working directory: the vault, so its .claude/skills are found. */
	cwd: string;
	prompt: string;
	/** Extra system prompt for this run. */
	systemPrompt: string;
	permissionMode: PermissionMode;
	/** Empty = Claude Code's default model. */
	model: string;
	/** Empty = Claude Code's default effort. */
	effort: Effort | "";
	timeoutMs: number;
}

export interface ClaudeResult {
	ok: boolean;
	/** Claude's final message, or what went wrong. */
	report: string;
	/** For `claude --resume <id>`. */
	sessionId?: string;
	durationMs: number;
	turns?: number;
	/** Actions the permission mode refused. */
	denials: string[];
	cancelled: boolean;
}

export interface ClaudeRun {
	done: Promise<ClaudeResult>;
	cancel(): void;
}

export function expandHome(path: string): string {
	const trimmed = path.trim();
	if (trimmed === "~") return homedir();
	if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
	return trimmed;
}

function expandPathList(list: string): string {
	return list
		.split(":")
		.map((part) => expandHome(part))
		.filter(Boolean)
		.join(":");
}

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
	return typeof value === "object" && value !== null ? (value as Json) : null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function clip(value: string, max: number): string {
	const oneLine = value.replace(/\s+/g, " ").trim();
	return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** A short "what is it doing now" line for one tool call. */
export function describeTool(name: string, input: Json): string {
	const file = text(input["file_path"]) || text(input["path"]) || text(input["notebook_path"]);
	switch (name) {
		case "Read":
			return `Reading ${basename(file)}`;
		case "Edit":
		case "Write":
			return `Editing ${basename(file)}`;
		case "Bash":
			return `Running: ${clip(text(input["description"]) || text(input["command"]), 70)}`;
		case "WebFetch":
			return `Fetching ${clip(text(input["url"]), 70)}`;
		case "WebSearch":
			return `Searching: ${clip(text(input["query"]), 60)}`;
		case "Skill":
			return `Loading skill ${text(input["skill"])}`;
		case "Grep":
		case "Glob":
			return `Searching for ${clip(text(input["pattern"]), 50)}`;
		default:
			return name.startsWith("mcp__") ? `Using ${name.split("__").slice(1).join(" ")}` : name;
	}
}

/** The file path or command a tool call names, so a change on disk can be traced to its run. */
export function toolMention(name: string, input: Json): string {
	if (name === "Bash") return text(input["command"]);
	return text(input["file_path"]) || text(input["path"]) || text(input["notebook_path"]);
}

/**
 * Start `claude -p` and report activity as it happens.
 * The run uses the CLI's own login: API-key variables are removed from its
 * environment so it can never fall back to pay-per-token API billing.
 */
/** "tool" = an action Claude took, "text" = something Claude wrote along the way. */
export type ActivityKind = "tool" | "text";

export function runClaude(
	options: ClaudeOptions,
	/** `mention` is what a tool call names (see toolMention); empty for text. */
	onActivity: (kind: ActivityKind, line: string, mention: string) => void,
): ClaudeRun {
	const started = Date.now();
	const claudePath = expandHome(options.claudePath);
	const result: ClaudeResult = {
		ok: false,
		report: "",
		durationMs: 0,
		denials: [],
		cancelled: false,
	};

	if (!existsSync(claudePath)) {
		result.report = `Claude Code not found at ${claudePath}. Set its path in the Fix Markdown settings.`;
		return { done: Promise.resolve(result), cancel: () => {} };
	}

	const env: NodeJS.ProcessEnv = { ...process.env };
	delete env["ANTHROPIC_API_KEY"];
	delete env["ANTHROPIC_AUTH_TOKEN"];
	env["PATH"] = [expandPathList(options.extraPath), process.env["PATH"] ?? ""]
		.filter(Boolean)
		.join(":");

	const args = [
		"-p",
		options.prompt,
		"--output-format",
		"stream-json",
		"--verbose",
		"--permission-mode",
		options.permissionMode,
		"--append-system-prompt",
		options.systemPrompt,
	];
	if (options.model.trim()) args.push("--model", options.model.trim());
	if (options.effort) args.push("--effort", options.effort);

	const child = spawn(claudePath, args, {
		cwd: options.cwd,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});

	let finished = false;
	let stderr = "";
	let pending = "";
	let timedOut = false;

	const handle = (line: string): void => {
		let event: Json | null;
		try {
			event = asRecord(JSON.parse(line));
		} catch {
			return; // not a protocol line
		}
		if (!event) return;

		const sessionId = text(event["session_id"]);
		if (sessionId) result.sessionId = sessionId;

		if (event["type"] === "assistant") {
			const content = asRecord(event["message"])?.["content"];
			if (!Array.isArray(content)) return;
			for (const part of content) {
				const block = asRecord(part);
				if (block?.["type"] === "tool_use") {
					const name = text(block["name"]);
					const input = asRecord(block["input"]) ?? {};
					onActivity("tool", describeTool(name, input), toolMention(name, input));
				} else if (block?.["type"] === "text" && text(block["text"]).trim()) {
					onActivity("text", text(block["text"]).trim(), "");
				}
			}
		} else if (event["type"] === "result") {
			finished = true;
			result.ok = event["is_error"] !== true && event["subtype"] === "success";
			result.report =
				text(event["result"]) || `Claude stopped without a report (${text(event["subtype"])}).`;
			if (typeof event["num_turns"] === "number") result.turns = event["num_turns"];
			const denials = event["permission_denials"];
			if (Array.isArray(denials)) {
				result.denials = denials.map((denial) => {
					const record = asRecord(denial) ?? {};
					return describeTool(text(record["tool_name"]), asRecord(record["tool_input"]) ?? {});
				});
			}
		}
	};

	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		pending += chunk;
		let newline = pending.indexOf("\n");
		while (newline >= 0) {
			const line = pending.slice(0, newline).trim();
			pending = pending.slice(newline + 1);
			if (line) handle(line);
			newline = pending.indexOf("\n");
		}
	});
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => {
		stderr = (stderr + chunk).slice(-4000);
	});

	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGTERM");
	}, options.timeoutMs);

	const done = new Promise<ClaudeResult>((resolve) => {
		const finish = (problem?: string): void => {
			clearTimeout(timer);
			if (pending.trim()) handle(pending.trim());
			pending = "";
			result.durationMs = Date.now() - started;
			if (result.cancelled) {
				result.ok = false;
				result.report = "Cancelled. Changes made before the cancel are still in the note.";
			} else if (timedOut) {
				result.ok = false;
				result.report = `Stopped after ${Math.round(options.timeoutMs / 60000)} minutes without finishing. Changes made so far are still in the note.`;
			} else if (!finished) {
				result.ok = false;
				result.report = problem || stderr.trim() || "Claude exited without a result.";
			}
			resolve(result);
		};
		child.on("error", (error) => finish(error.message));
		child.on("close", (code) => finish(code === 0 ? undefined : stderr.trim()));
	});

	return {
		done,
		cancel: () => {
			result.cancelled = true;
			child.kill("SIGTERM");
		},
	};
}
