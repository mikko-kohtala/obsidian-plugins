import type { ClaudeResult } from "./claude";
import type { NoteDiff } from "./diff";

export interface LogEntry {
	/** Milliseconds since the run started. */
	at: number;
	/** "tool" = something Claude did, "text" = something Claude said. */
	kind: "tool" | "text";
	text: string;
}

/** One press of the Fix button, from start to report. */
export interface FixRun {
	id: number;
	notePath: string;
	noteName: string;
	sourceUrl: string | null;
	dryRun: boolean;
	startedAt: number;
	status: "running" | "done" | "failed" | "cancelled";
	log: LogEntry[];
	result?: ClaudeResult;
	/** The note before and after the run, for the diff and Undo. */
	before?: string;
	after?: string;
	/** What changed in the note. Undefined until the run ends. */
	diff?: NoteDiff;
	undone?: boolean;
	/** Other vault files the run created, changed or deleted. */
	created: string[];
	modified: string[];
	deleted: string[];
	cancel: () => void;
}
