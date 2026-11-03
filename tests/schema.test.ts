import { describe, expect, it } from 'vitest';
import { parseReview, parseRevision } from '../src/core/schema';

const valid = {
	findings: [
		{
			id: 'f1',
			severity: 'High',
			heading: 'MR-A > Assumptions',
			quote: 'Cov(x,u) != 0',
			problem: 'Wrong sign.',
			suggestion: 'Use $\\text{Cov}(x,u) = 0$.',
			edits: [{ find: 'Cov(x,u) != 0', replace: '$\\text{Cov}(x,u) = 0$' }],
		},
	],
	typos: [{ id: 't1', quote: 'varience', edits: [{ find: 'varience', replace: 'variance' }] }],
	pass: false,
};

describe('parseReview', () => {
	it('accepts a valid response', () => {
		const r = parseReview(JSON.stringify(valid));
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value.findings[0].severity).toBe('High');
			expect(r.value.typos[0].edits[0].replace).toBe('variance');
		}
	});

	it('rejects malformed JSON', () => {
		expect(parseReview('{"findings": [')).toEqual({
			ok: false,
			error: 'Response was not valid JSON.',
		});
	});

	it('rejects schema violations without returning partial data', () => {
		const badSeverity = { ...valid, findings: [{ ...valid.findings[0], severity: 'Critical' }] };
		const r1 = parseReview(JSON.stringify(badSeverity));
		expect(r1.ok).toBe(false);
		const missingEdits = { ...valid, typos: [{ id: 't1', quote: 'x' }] };
		expect(parseReview(JSON.stringify(missingEdits)).ok).toBe(false);
		expect(parseReview(JSON.stringify({ findings: [], typos: [] })).ok).toBe(false);
		expect(parseReview('[]').ok).toBe(false);
	});

	it('makes duplicate ids unique across findings and typos', () => {
		const dup = { ...valid, typos: [{ ...valid.typos[0], id: 'f1' }] };
		const r = parseReview(JSON.stringify(dup));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.typos[0].id).not.toBe(r.value.findings[0].id);
	});
});

describe('parseRevision', () => {
	it('accepts valid and rejects invalid revisions', () => {
		expect(parseRevision('{"edits":[{"find":"a","replace":"b"}],"note":""}').ok).toBe(true);
		expect(parseRevision('{"edits":"a","note":""}').ok).toBe(false);
		expect(parseRevision('nope').ok).toBe(false);
	});
});
