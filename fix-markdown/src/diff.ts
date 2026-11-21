// Line diff of a note before and after a fix, with the changed words marked
// inside lines that were edited rather than replaced. No Obsidian imports.

export interface Segment {
	text: string;
	changed: boolean;
}

export interface DiffLine {
	kind: "context" | "removed" | "added";
	text: string;
	/** Present when the line was edited: which parts of it differ. */
	segments?: Segment[];
}

export interface Hunk {
	/** 1-based line numbers where the hunk starts. */
	oldStart: number;
	newStart: number;
	lines: DiffLine[];
}

export interface NoteDiff {
	hunks: Hunk[];
	added: number;
	removed: number;
	/** The note was too big to compare line by line. */
	tooLarge: boolean;
}

type Op = { kind: "equal" | "removed" | "added"; text: string };

const MAX_CELLS = 6_000_000;
const CONTEXT = 1;

/** Shortest edit script between two sequences, or null when it would be too big. */
function editScript(a: string[], b: string[]): Op[] | null {
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}

	const n = endA - start;
	const m = endB - start;
	if (n * m > MAX_CELLS || n > 65_000 || m > 65_000) return null;

	// lcs[i * width + j] = length of the longest common subsequence of a[i..] and b[j..]
	const width = m + 1;
	const lcs = new Uint16Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i * width + j] =
				a[start + i] === b[start + j]
					? lcs[(i + 1) * width + j + 1]! + 1
					: Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
		}
	}

	const ops: Op[] = [];
	for (let k = 0; k < start; k++) ops.push({ kind: "equal", text: a[k]! });
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[start + i] === b[start + j]) {
			ops.push({ kind: "equal", text: a[start + i]! });
			i++;
			j++;
		} else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) {
			ops.push({ kind: "removed", text: a[start + i++]! });
		} else {
			ops.push({ kind: "added", text: b[start + j++]! });
		}
	}
	while (i < n) ops.push({ kind: "removed", text: a[start + i++]! });
	while (j < m) ops.push({ kind: "added", text: b[start + j++]! });
	for (let k = endA; k < a.length; k++) ops.push({ kind: "equal", text: a[k]! });
	return ops;
}

/** Mark which words of an edited line differ. Null when the lines share too little. */
function wordSegments(before: string, after: string): [Segment[], Segment[]] | null {
	const a = before.split(/(\s+)/).filter(Boolean);
	const b = after.split(/(\s+)/).filter(Boolean);
	const ops = editScript(a, b);
	if (!ops) return null;

	const shared = ops.filter((op) => op.kind === "equal" && op.text.trim()).length;
	const words = Math.max(
		a.filter((token) => token.trim()).length,
		b.filter((token) => token.trim()).length,
	);
	if (words === 0 || shared / words < 0.4) return null;

	const removed: Segment[] = [];
	const added: Segment[] = [];
	const push = (list: Segment[], text: string, changed: boolean): void => {
		const last = list[list.length - 1];
		if (last && last.changed === changed) last.text += text;
		else list.push({ text, changed });
	};
	for (const op of ops) {
		if (op.kind !== "added") push(removed, op.text, op.kind === "removed");
		if (op.kind !== "removed") push(added, op.text, op.kind === "added");
	}
	return [removed, added];
}

/** A removed block followed by an added block of the same size is an edit, line for line. */
function markEditedLines(lines: DiffLine[]): void {
	let index = 0;
	while (index < lines.length) {
		if (lines[index]!.kind !== "removed") {
			index++;
			continue;
		}
		let removedEnd = index;
		while (removedEnd < lines.length && lines[removedEnd]!.kind === "removed") removedEnd++;
		let addedEnd = removedEnd;
		while (addedEnd < lines.length && lines[addedEnd]!.kind === "added") addedEnd++;

		const count = removedEnd - index;
		if (count === addedEnd - removedEnd) {
			for (let k = 0; k < count; k++) {
				const before = lines[index + k]!;
				const after = lines[removedEnd + k]!;
				const segments = wordSegments(before.text, after.text);
				if (!segments) continue;
				before.segments = segments[0];
				after.segments = segments[1];
			}
		}
		index = addedEnd;
	}
}

export function diffNote(before: string, after: string): NoteDiff {
	const result: NoteDiff = { hunks: [], added: 0, removed: 0, tooLarge: false };
	if (before === after) return result;

	const ops = editScript(before.split("\n"), after.split("\n"));
	if (!ops) {
		result.tooLarge = true;
		return result;
	}

	// Which ops to show: every change, plus CONTEXT unchanged lines around it.
	const shown = Array.from<boolean>({ length: ops.length }).fill(false);
	ops.forEach((op, index) => {
		if (op.kind === "equal") return;
		const from = Math.max(0, index - CONTEXT);
		const to = Math.min(ops.length - 1, index + CONTEXT);
		for (let k = from; k <= to; k++) shown[k] = true;
	});

	let oldLine = 1;
	let newLine = 1;
	let hunk: Hunk | null = null;
	ops.forEach((op, index) => {
		if (shown[index]) {
			if (!hunk) {
				hunk = { oldStart: oldLine, newStart: newLine, lines: [] };
				result.hunks.push(hunk);
			}
			hunk.lines.push({ kind: op.kind === "equal" ? "context" : op.kind, text: op.text });
		} else {
			hunk = null;
		}
		if (op.kind !== "added") oldLine++;
		if (op.kind !== "removed") newLine++;
		if (op.kind === "added") result.added++;
		if (op.kind === "removed") result.removed++;
	});

	for (const each of result.hunks) markEditedLines(each.lines);
	return result;
}

/** Shorten long unchanged stretches so the changed words stay in view. */
export function elide(segments: Segment[], keep = 40): Segment[] {
	return segments.map((segment, index) => {
		if (segment.changed || segment.text.length <= keep * 2 + 5) return segment;
		const first = index === 0;
		const last = index === segments.length - 1;
		const head = first ? "" : segment.text.slice(0, keep);
		const tail = last ? "" : segment.text.slice(-keep);
		return { changed: false, text: `${head} … ${tail}` };
	});
}
