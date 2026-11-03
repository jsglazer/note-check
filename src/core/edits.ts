import { locateQuote } from './anchor';
import { isJeLine, isProtected, overlaps, protectedRanges, toJeLine } from './protect';
import type { ProposedEdit, TextRange } from './types';

/** A group of edits that must apply together (one finding or typo). */
export interface EditGroup {
	id: string;
	edits: ProposedEdit[];
}

/** A validated edit with concrete offsets in the text it was planned against. */
export interface ResolvedEdit {
	groupId: string;
	range: TextRange;
	replace: string;
}

export interface Rejection {
	groupId: string;
	reason: string;
}

export interface EditPlan {
	/** Sorted by descending `range.from`, ready to apply without offset drift. */
	edits: ResolvedEdit[];
	appliedGroups: string[];
	rejected: Rejection[];
}

/**
 * Validate every group against the current text. A group is rejected as a whole
 * if any of its edits is unmatched, ambiguous, touches a protected region, or
 * overlaps an edit already accepted from an earlier group.
 */
export function planEdits(text: string, groups: EditGroup[]): EditPlan {
	const guard = protectedRanges(text);
	const accepted: ResolvedEdit[] = [];
	const appliedGroups: string[] = [];
	const rejected: Rejection[] = [];

	for (const group of groups) {
		if (group.edits.length === 0) {
			rejected.push({ groupId: group.id, reason: 'No edit was proposed.' });
			continue;
		}
		const resolved: ResolvedEdit[] = [];
		let reason: string | null = null;
		for (const edit of group.edits) {
			const loc = locateQuote(text, edit.find);
			if (loc.status === 'none') {
				reason = `Text not found: "${edit.find}"`;
				break;
			}
			if (loc.status === 'multiple') {
				reason = `Text appears ${loc.count} times: "${edit.find}"`;
				break;
			}
			if (isProtected(loc.range, guard)) {
				reason = 'Edit touches a protected region (frontmatter, JE: line, or below DO NOT EDIT).';
				break;
			}
			const clash =
				resolved.some((r) => overlaps(loc.range, r.range) || overlaps(r.range, loc.range)) ||
				accepted.some((r) => overlaps(loc.range, r.range) || overlaps(r.range, loc.range));
			if (clash) {
				reason = 'Edit overlaps another selected edit.';
				break;
			}
			resolved.push({ groupId: group.id, range: loc.range, replace: edit.replace });
		}
		if (reason) {
			rejected.push({ groupId: group.id, reason });
		} else {
			accepted.push(...resolved);
			appliedGroups.push(group.id);
		}
	}

	accepted.sort((a, b) => b.range.from - a.range.from);
	return { edits: accepted, appliedGroups, rejected };
}

/** Apply resolved edits (descending order) to text. Pure. */
export function applyPlan(text: string, edits: ResolvedEdit[]): string {
	let out = text;
	const ordered = [...edits].sort((a, b) => b.range.from - a.range.from);
	for (const e of ordered) {
		out = out.slice(0, e.range.from) + e.replace + out.slice(e.range.to);
	}
	return out;
}

/**
 * Plan "Make JE: line": find the line holding `quote` (first line of the quote if
 * it spans several) and turn it into a `JE: ` line. Refuses frontmatter, the
 * DO NOT EDIT region, lines that are already JE: lines, and ambiguous quotes.
 */
export function planJeLine(
	text: string,
	quote: string,
): { ok: true; edit: ResolvedEdit } | { ok: false; reason: string } {
	const loc = locateQuote(text, quote);
	if (loc.status === 'none')
		return { ok: false, reason: 'The quoted text is no longer in the note.' };
	if (loc.status === 'multiple')
		return { ok: false, reason: `The quoted text appears ${loc.count} times.` };
	const lineStart = loc.range.from === 0 ? 0 : text.lastIndexOf('\n', loc.range.from - 1) + 1;
	const nl = text.indexOf('\n', loc.range.from);
	const lineEnd = nl === -1 ? text.length : nl;
	const range = { from: lineStart, to: lineEnd };
	const line = text.slice(lineStart, lineEnd);
	if (isJeLine(line)) return { ok: false, reason: 'That line is already a JE: line.' };
	if (isProtected(range, protectedRanges(text))) {
		return { ok: false, reason: 'That line is protected (frontmatter or below DO NOT EDIT).' };
	}
	return { ok: true, edit: { groupId: 'je', range, replace: toJeLine(line) } };
}
