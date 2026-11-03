import { locateQuote } from './anchor';
import type { ProposedEdit, TextRange } from './types';

/**
 * Math spans (`$...$` and `$$...$$`) in `text`, ignoring escaped `\$`.
 * An opening delimiter with no closing partner produces no span.
 */
export function mathSpans(text: string): TextRange[] {
	const spans: TextRange[] = [];
	const isDollar = (i: number): boolean => text[i] === '$' && (i === 0 || text[i - 1] !== '\\');
	let i = 0;
	while (i < text.length) {
		if (!isDollar(i)) {
			i++;
			continue;
		}
		const block = text[i + 1] === '$';
		const open = block ? 2 : 1;
		let j = i + open;
		let close = -1;
		while (j < text.length) {
			if (isDollar(j) && (!block || text[j + 1] === '$')) {
				close = j;
				break;
			}
			j++;
		}
		if (close === -1) {
			i += open;
			continue;
		}
		const end = close + open;
		spans.push({ from: i, to: end });
		i = end;
	}
	return spans;
}

/** True when every unescaped `$` in `s` is paired, so it renders as math rather than raw LaTeX. */
export function mathBalanced(s: string): boolean {
	let count = 0;
	for (let i = 0; i < s.length; i++) if (s[i] === '$' && (i === 0 || s[i - 1] !== '\\')) count++;
	return count % 2 === 0;
}

export interface EditPreview {
	before: string;
	after: string;
	/** True when the preview was widened beyond the edit's own text. */
	widened: boolean;
}

/**
 * Build a renderable before/after preview for one edit. The edit's range in the
 * live note is widened, within its own line(s), until it no longer cuts through
 * a math span, so equations render instead of showing raw LaTeX. Returns null
 * when the edit can't be located; callers then fall back to the raw fragment.
 */
export function previewEdit(text: string, edit: ProposedEdit): EditPreview | null {
	const loc = locateQuote(text, edit.find);
	if (loc.status !== 'unique') return null;
	const { from, to } = loc.range;
	const blockStart = from === 0 ? 0 : text.lastIndexOf('\n', from - 1) + 1;
	const nl = text.indexOf('\n', Math.max(to - 1, from));
	const blockEnd = nl === -1 ? text.length : nl;
	const block = text.slice(blockStart, blockEnd);
	const spans = mathSpans(block);

	let a = from - blockStart;
	let b = to - blockStart;
	let changed = true;
	while (changed) {
		changed = false;
		for (const s of spans) {
			const intersects = s.from < b && s.to > a;
			if (intersects && (s.from < a || s.to > b)) {
				a = Math.min(a, s.from);
				b = Math.max(b, s.to);
				changed = true;
			}
		}
	}
	const before = block.slice(a, b);
	const relFrom = from - blockStart - a;
	const relTo = to - blockStart - a;
	const after = before.slice(0, relFrom) + edit.replace + before.slice(relTo);
	const lead = a > 0 ? '… ' : '';
	const tail = b < block.length ? ' …' : '';
	return {
		before: `${lead}${before}${tail}`,
		after: `${lead}${after}${tail}`,
		widened: a !== from - blockStart || b !== to - blockStart,
	};
}

/**
 * Line to place the cursor on after jumping to `range`: the line just below the
 * range's last line (clamped to the last line), so the target itself is not selected.
 */
export function lineBelow(text: string, range: TextRange): number {
	const lastLine = text.split('\n').length - 1;
	const endLine = text.slice(0, Math.max(range.to - 1, range.from)).split('\n').length - 1;
	return Math.min(endLine + 1, lastLine);
}
