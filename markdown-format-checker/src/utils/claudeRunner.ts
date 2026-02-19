import { spawn } from "child_process";
import type { FormatCheckResult } from "../types";
import type { MarkdownFormatCheckerSettings } from "../settings";

export function runClaudeCheck(
	prompt: string,
	settings: MarkdownFormatCheckerSettings
): Promise<FormatCheckResult> {
	return new Promise((resolve) => {
		let resolved = false;

		const env = { ...process.env };
		delete env.CLAUDECODE;

		const child = spawn(settings.claudeBinaryPath, ["-p"], {
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
		});

		child.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		child.on("error", (error: NodeJS.ErrnoException) => {
			if (resolved) return;
			resolved = true;
			clearTimeout(timer);

			if (error.code === "ENOENT") {
				resolve({
					success: false,
					output: "",
					error: `Claude CLI not found at "${settings.claudeBinaryPath}". Please install Claude Code or update the binary path in settings.`,
				});
			} else {
				resolve({
					success: false,
					output: stdout,
					error: `Failed to start Claude CLI: ${error.message}`,
				});
			}
		});

		child.on("close", (code: number | null) => {
			if (resolved) return;
			resolved = true;
			clearTimeout(timer);

			if (code !== 0) {
				resolve({
					success: false,
					output: stdout,
					error: `Claude CLI exited with code ${code}${stderr ? "\nStderr: " + stderr : ""}`,
					exitCode: code ?? undefined,
				});
				return;
			}

			resolve({
				success: true,
				output: stdout,
				exitCode: 0,
			});
		});

		// Write prompt to stdin and close
		child.stdin.write(prompt);
		child.stdin.end();

		// Manual timeout
		const timer = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			child.kill("SIGTERM");
			resolve({
				success: false,
				output: stdout,
				error: `Claude CLI timed out after ${settings.timeoutMs / 1000} seconds. You can increase the timeout in settings.`,
				timedOut: true,
			});
		}, settings.timeoutMs);
	});
}
