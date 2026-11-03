import type { TextRange } from './types';

/** Matches a `JE: ` line after optional indentation, callout `>` markers and a list marker. */
const JE_LINE = /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d+[.)])[ \t]+)?JE: /;

/** Matches a Markdown heading whose text contains DO NOT EDIT (case-insensitive). */
const DO_NOT_EDIT_HEADING = /^#{1,6}[ \t]+.*\bDO NOT EDIT\b/i;

export function isJeLine(line: string): boolean {
	return JE_LINE.test(line);
}

/** Split text into lines with their start offsets (line text excludes the newline). */
export function lineSpans(text: string): Array<{ start: number; end: number; line: string }> {
	const out: Array<{ start: number; end: number; line: string }> = [];
	let start = 0;
	while (start <= text.length) {
		const nl = text.indexOf('\n', start);
		const end = nl === -1 ? text.length : nl;
		out.push({ start, end, line: text.slice(start, end) });
		if (nl === -1) break;
		start = nl + 1;
	}
	return out;
}

/** Range of the YAML frontmatter block (including both `---` fences), or null. */
export function frontmatterRange(text: string): TextRange | null {
	if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return null;
	const lines = lineSpans(text);
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].line.replace(/\r$/, '') === '---') {
			const to = i + 1 < lines.length ? lines[i + 1].start : text.length;
			return { from: 0, to };
		}
	}
	return null;
}

/**
 * All regions the plugin must never edit: frontmatter, every `JE: ` line, and
 * everything from a `DO NOT EDIT` heading to the end of the note.
 */
export function protectedRanges(text: string): TextRange[] {
	const ranges: TextRange[] = [];
	const fm = frontmatterRange(text);
	if (fm) ranges.push(fm);
	for (const span of lineSpans(text)) {
		if (fm && span.start < fm.to) continue;
		if (DO_NOT_EDIT_HEADING.test(span.line)) {
			ranges.push({ from: span.start, to: text.length });
			break;
		}
		if (isJeLine(span.line)) ranges.push({ from: span.start, to: span.end });
	}
	return ranges;
}

export function overlaps(a: TextRange, b: TextRange): boolean {
	// Zero-length ranges (pure insertions) still count when they sit inside b.
	if (a.from === a.to) return a.from >= b.from && a.from < b.to;
	return a.from < b.to && b.from < a.to;
}

export function isProtected(range: TextRange, protectedList: TextRange[]): boolean {
	return protectedList.some((p) => overlaps(range, p));
}

/** Insert `JE: ` after the line's indentation / callout / list prefix. Idempotent. */
export function toJeLine(line: string): string {
	if (isJeLine(line)) return line;
	const m = /^([ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d+[.)])[ \t]+)?)/.exec(line);
	const prefix = m ? m[1] : '';
	return `${prefix}JE: ${line.slice(prefix.length)}`;
}
