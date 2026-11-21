// Runs the kindle-epub command-line tools. Nothing in here touches Obsidian,
// so it can be exercised on its own.
import { execFile } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/** How a book reaches the Kindle. "epub" only builds the file. */
export type Delivery = "email" | "usb" | "epub";

export interface ToolOptions {
	/** Folder of the kindle-epub checkout (the one that contains bin/). */
	toolsDir: string;
	/** Prepended to PATH: apps started from the Dock don't get the shell's PATH. */
	extraPath: string;
	/** Where the .epub is written. */
	outDir: string;
	/** Where a USB-connected Kindle mounts. */
	kindleMount: string;
	ejectAfterUsb: boolean;
}

export interface BuildResult {
	epubPath: string;
	/** Warnings the converter printed (unresolved images, malformed markup). */
	warnings: string[];
}

export interface DeliverResult {
	/** One line for the user: what happened. */
	summary: string;
	/** Set when the action finished but something needs attention. */
	warning?: string;
}

export class KindleError extends Error {
	/** Full output of the failed tool, for the developer console. */
	readonly log: string;

	constructor(message: string, log = "") {
		super(message);
		this.name = "KindleError";
		this.log = log;
	}
}

const TIMEOUT_MS = 180_000;

export function expandHome(path: string): string {
	const trimmed = path.trim();
	if (trimmed === "~") return homedir();
	if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
	return trimmed;
}

export function kindleMounted(mount: string): boolean {
	return existsSync(join(expandHome(mount), "documents"));
}

function tool(options: ToolOptions, name: string): string {
	const path = join(expandHome(options.toolsDir), "bin", name);
	if (!existsSync(path)) {
		throw new KindleError(
			`kindle-epub tools not found (${path}). Set the tools folder in the Send to Kindle settings.`,
		);
	}
	return path;
}

interface RunOutput {
	stdout: string;
	stderr: string;
}

function run(
	file: string,
	args: string[],
	options: ToolOptions,
	env: Record<string, string> = {},
): Promise<RunOutput> {
	const path = [options.extraPath.trim(), process.env["PATH"] ?? ""].filter(Boolean).join(":");
	return new Promise((resolve, reject) => {
		execFile(
			file,
			args,
			{
				env: { ...process.env, ...env, PATH: path },
				timeout: TIMEOUT_MS,
				maxBuffer: 16 * 1024 * 1024,
			},
			(error, stdout, stderr) => {
				if (!error) {
					resolve({ stdout, stderr });
					return;
				}
				const log = [stderr, stdout].filter(Boolean).join("\n").trim();
				const reason = error.killed
					? `timed out after ${TIMEOUT_MS / 1000}s`
					: lastLine(stderr) || lastLine(stdout) || error.message;
				reject(new KindleError(reason, log));
			},
		);
	});
}

function lines(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

function lastLine(text: string): string {
	const all = lines(text);
	return all[all.length - 1] ?? "";
}

/** Strip the "tool-name: " prefix the scripts put on their messages. */
function unprefix(line: string): string {
	return line.replace(/^(md2epub|send-to-kindle|usb-to-kindle):\s*/, "").replace(/^!\s*/, "");
}

/** Markdown note -> EPUB, via bin/md2epub. */
export async function buildEpub(notePath: string, options: ToolOptions): Promise<BuildResult> {
	const md2epub = tool(options, "md2epub");
	const outDir = expandHome(options.outDir);
	mkdirSync(outDir, { recursive: true });

	const { stdout, stderr } = await run(md2epub, ["-o", outDir, notePath], options);
	const epubPath = lastLine(stdout);
	if (!epubPath || !existsSync(epubPath)) {
		throw new KindleError("The converter produced no EPUB.", stderr);
	}
	// md2epub reports progress on stderr too; keep only what needs attention.
	const warnings = lines(stderr)
		.filter((line) => line.includes("WARNING") || line.startsWith("!"))
		.map(unprefix);
	return { epubPath, warnings };
}

/** Email the EPUB through Mail.app, via bin/send-to-kindle. */
async function email(epubPath: string, options: ToolOptions): Promise<DeliverResult> {
	const { stdout } = await run(tool(options, "send-to-kindle"), [epubPath], options);
	const report = lastLine(stdout);
	const recipient = /\bto (\S+@\S+)/.exec(report)?.[1];
	const stuck = Number(/still in outbox:\s*(\d+)/.exec(report)?.[1] ?? 0);
	return {
		summary: recipient ? `Emailed to ${recipient}.` : "Emailed to the Kindle.",
		warning:
			stuck > 0
				? `${stuck} message(s) still in Mail's Outbox — check that Mail is online.`
				: undefined,
	};
}

/** Convert and copy onto a mounted Kindle, via bin/usb-to-kindle. */
async function usb(epubPath: string, options: ToolOptions): Promise<DeliverResult> {
	if (!kindleMounted(options.kindleMount)) {
		throw new KindleError(
			`No Kindle at ${options.kindleMount}. Plug it in and unlock it, or send by email.`,
		);
	}
	const { stderr } = await run(tool(options, "usb-to-kindle"), [epubPath], options, {
		KINDLE_MOUNT: expandHome(options.kindleMount),
		KINDLE_EJECT: options.ejectAfterUsb ? "1" : "",
	});
	const ejected = stderr.includes("ejected");
	const ejectFailed = stderr.includes("could not eject");
	return {
		summary: ejected ? "Copied to the Kindle and ejected it." : "Copied to the Kindle.",
		warning: ejectFailed ? "Could not eject the Kindle — eject it in Finder." : undefined,
	};
}

export async function deliver(
	epubPath: string,
	delivery: Delivery,
	options: ToolOptions,
): Promise<DeliverResult> {
	switch (delivery) {
		case "email":
			return email(epubPath, options);
		case "usb":
			return usb(epubPath, options);
		case "epub":
			return { summary: "EPUB built." };
	}
}

/** Show a file in Finder. */
export function revealInFinder(path: string): void {
	execFile("open", ["-R", path], () => {});
}
