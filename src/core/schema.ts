import type {
	Finding,
	ParseOutcome,
	ProposedEdit,
	ReviewResult,
	RevisionResult,
	Severity,
	Typo,
} from './types';

const EDIT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['find', 'replace'],
	properties: {
		find: { type: 'string' },
		replace: { type: 'string' },
	},
} as const;

/** JSON schema sent as output_config.format for a review call. */
export const REVIEW_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['findings', 'typos', 'pass'],
	properties: {
		findings: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['id', 'severity', 'heading', 'quote', 'problem', 'suggestion', 'edits'],
				properties: {
					id: { type: 'string' },
					severity: { type: 'string', enum: ['High', 'Med', 'Low'] },
					heading: { type: 'string' },
					quote: { type: 'string' },
					problem: { type: 'string' },
					suggestion: { type: 'string' },
					edits: { type: 'array', items: EDIT_SCHEMA },
				},
			},
		},
		typos: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['id', 'quote', 'edits'],
				properties: {
					id: { type: 'string' },
					quote: { type: 'string' },
					edits: { type: 'array', items: EDIT_SCHEMA },
				},
			},
		},
		pass: { type: 'boolean' },
	},
} as const;

/** JSON schema sent as output_config.format for an "Apply my version" call. */
export const REVISION_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['edits', 'note'],
	properties: {
		edits: { type: 'array', items: EDIT_SCHEMA },
		note: { type: 'string' },
	},
} as const;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(o: Obj, key: string, where: string): string {
	const v = o[key];
	if (typeof v !== 'string') throw new Error(`${where}.${key} must be a string`);
	return v;
}

function edits(o: Obj, where: string): ProposedEdit[] {
	const v = o.edits;
	if (!Array.isArray(v)) throw new Error(`${where}.edits must be an array`);
	return v.map((e, i) => {
		if (!isObj(e)) throw new Error(`${where}.edits[${i}] must be an object`);
		return {
			find: str(e, 'find', `${where}.edits[${i}]`),
			replace: str(e, 'replace', `${where}.edits[${i}]`),
		};
	});
}

const SEVERITIES: readonly Severity[] = ['High', 'Med', 'Low'];

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		throw new Error('Response was not valid JSON.');
	}
}

/** Parse and schema-check a review response. Never returns a partial result. */
export function parseReview(raw: string): ParseOutcome<ReviewResult> {
	try {
		const data = parseJson(raw);
		if (!isObj(data)) throw new Error('Response must be a JSON object.');
		if (!Array.isArray(data.findings)) throw new Error('findings must be an array');
		if (!Array.isArray(data.typos)) throw new Error('typos must be an array');
		if (typeof data.pass !== 'boolean') throw new Error('pass must be a boolean');
		const seen = new Set<string>();
		const uniqueId = (id: string, fallback: string): string => {
			let out = id.trim() || fallback;
			while (seen.has(out)) out = `${out}'`;
			seen.add(out);
			return out;
		};
		const findings: Finding[] = data.findings.map((f, i) => {
			const where = `findings[${i}]`;
			if (!isObj(f)) throw new Error(`${where} must be an object`);
			const severity = str(f, 'severity', where);
			if (!SEVERITIES.includes(severity as Severity)) {
				throw new Error(`${where}.severity must be High, Med or Low`);
			}
			return {
				id: uniqueId(str(f, 'id', where), `f${i + 1}`),
				severity: severity as Severity,
				heading: str(f, 'heading', where),
				quote: str(f, 'quote', where),
				problem: str(f, 'problem', where),
				suggestion: str(f, 'suggestion', where),
				edits: edits(f, where),
			};
		});
		const typos: Typo[] = data.typos.map((t, i) => {
			const where = `typos[${i}]`;
			if (!isObj(t)) throw new Error(`${where} must be an object`);
			return {
				id: uniqueId(str(t, 'id', where), `t${i + 1}`),
				quote: str(t, 'quote', where),
				edits: edits(t, where),
			};
		});
		return { ok: true, value: { findings, typos, pass: data.pass } };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/** Parse and schema-check an "Apply my version" response. */
export function parseRevision(raw: string): ParseOutcome<RevisionResult> {
	try {
		const data = parseJson(raw);
		if (!isObj(data)) throw new Error('Response must be a JSON object.');
		return {
			ok: true,
			value: { edits: edits(data, 'revision'), note: str(data, 'note', 'revision') },
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}
