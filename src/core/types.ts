/** Shared data shapes for the pure review core. No obsidian / SDK imports. */

export type Severity = 'High' | 'Med' | 'Low';

export type ReviewMode = 'check' | 'recheck';

/** One find/replace proposal from the model. Applied only after validation. */
export interface ProposedEdit {
	find: string;
	replace: string;
}

/** A technical finding returned by the model. */
export interface Finding {
	id: string;
	severity: Severity;
	heading: string;
	quote: string;
	problem: string;
	suggestion: string;
	edits: ProposedEdit[];
}

/** A minor typo fix returned by the model (shown pre-ticked, never auto-applied). */
export interface Typo {
	id: string;
	quote: string;
	edits: ProposedEdit[];
}

/** Parsed and schema-checked model response for a review call. */
export interface ReviewResult {
	findings: Finding[];
	typos: Typo[];
	pass: boolean;
}

/** Parsed and schema-checked model response for an "Apply my version" call. */
export interface RevisionResult {
	edits: ProposedEdit[];
	note: string;
}

/** Half-open character range [from, to) in the note text. */
export interface TextRange {
	from: number;
	to: number;
}

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: string };
