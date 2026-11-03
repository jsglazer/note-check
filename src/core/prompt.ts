import type { Finding, ReviewMode } from './types';

/**
 * Built-in copy of the check-inventory review rules, used when the shared rules
 * note is missing. The vault note (default `Classes/Note Review Rules.md`) wins.
 */
export const DEFAULT_RULES = `# Note Review Rules

You check a study note (statistics, econometrics, math) for technical errors.

## What to report
Report technical errors: wrong math, formulas, derivations, notation, definitions, signs, subscripts, units, statistical/econometric claims, and statements that would mislead on an exam. Also report wording that is genuinely ambiguous or wrong. Do not report style preferences.

## Severity
- High: wrong math or claim; would mislead.
- Med: incomplete, ambiguous, or a notation inconsistency.
- Low: small wording issue that is not a simple typo.

## Lines to ignore
- Skip any line whose text starts with \`JE: \` (after any leading whitespace, list marker, or callout \`>\`). These are the user's own notes: do not report them and do not edit them.
- If the note has a heading containing DO NOT EDIT, never propose edits at or below it.
- Never propose edits to the YAML frontmatter.

## Typos
Clear single-word misspellings and double spaces inside prose are typos. Report them in the typos list, never as findings. Do not treat added punctuation, rewording, or math changes as typos.

## LaTeX conventions for suggestions
- Use \\dfrac, never \\frac.
- Never wrap single characters in \\text{}: write $E(x)$, not $\\text{E}(x)$.
- Use \\mid for conditioning bars, never a bare |, e.g. $E(u \\mid x_1, x_2)$.
- When a suggested equation carries an ID number, use this template (number in the right cell):
  > [!formula|plain]
  > | | |
  > |---|---|
  > | $x^2$ | 1.23 |
`;

/** Fixed output protocol appended after the rules. Not user-editable. */
export const OUTPUT_PROTOCOL = `# Output protocol (fixed)

Return only JSON matching the provided schema.

- findings: one entry per technical problem, in the order they appear in the note.
  - id: short unique id such as "f1".
  - heading: the heading path of the section, e.g. "MR-A > Assumptions" (empty string if none).
  - quote: a short verbatim excerpt copied character-for-character from the note that appears exactly once in it. Add surrounding words if needed to make it unique.
  - problem: what is wrong (Markdown; math in $...$).
  - suggestion: the fix (Markdown; math in $...$).
  - edits: find/replace pairs that implement the suggestion. Each find must be copied verbatim from the note, must appear exactly once, and must not overlap another edit. Use an empty list when the fix cannot be expressed as a text replacement.
- typos: one entry per typo, with a verbatim quote and the edit that fixes it.
- pass: true only when the findings list is empty.

Never rewrite the whole note. Never include text from JE: lines, the frontmatter, or below a DO NOT EDIT heading in any find string.`;

export function buildSystemPrompt(rules: string): string {
	const body = rules.trim().length > 0 ? rules.trim() : DEFAULT_RULES.trim();
	return `${body}\n\n${OUTPUT_PROTOCOL}`;
}

export interface HandledItem {
	quote: string;
	status: 'ignored' | 'fixed';
}

/** User message for a review call: mode, already-handled items, then the note as data. */
export function buildReviewMessage(note: string, mode: ReviewMode, handled: HandledItem[]): string {
	const parts: string[] = [];
	parts.push(
		mode === 'recheck'
			? 'Mode: RECHECK. Report every remaining issue; the note passes if no High findings remain.'
			: 'Mode: CHECK. Report every issue; the note passes only if there are no findings.',
	);
	if (handled.length > 0) {
		parts.push(
			'The user has already handled these items. Do not report them again unless the quoted text now contains a new, different error:',
		);
		for (const h of handled) parts.push(`- (${h.status}) "${h.quote}"`);
	}
	parts.push('<note>');
	parts.push(note);
	parts.push('</note>');
	return parts.join('\n');
}

function findingContext(f: Finding): string {
	return [
		`Severity: ${f.severity}`,
		`Section: ${f.heading || '(none)'}`,
		`Quoted text: "${f.quote}"`,
		`Problem: ${f.problem}`,
		`Suggested fix: ${f.suggestion}`,
	].join('\n');
}

/** User message for an "Ask" follow-up (free-text Markdown answer). */
export function buildAskMessage(note: string, finding: Finding, question: string): string {
	return [
		"Answer the user's question about one finding from your review. Reply in concise Markdown with math in $...$. Do not return JSON.",
		'<finding>',
		findingContext(finding),
		'</finding>',
		'<question>',
		question,
		'</question>',
		'<note>',
		note,
		'</note>',
	].join('\n');
}

/** User message for "Apply my version": the model turns the user's instruction into edits. */
export function buildRevisionMessage(note: string, finding: Finding, instruction: string): string {
	return [
		'The user wants to fix one finding their own way. Turn their instruction into find/replace edits following the output protocol rules for edits. Put any caveat in "note" (empty string if none).',
		'<finding>',
		findingContext(finding),
		'</finding>',
		'<instruction>',
		instruction,
		'</instruction>',
		'<note>',
		note,
		'</note>',
	].join('\n');
}
