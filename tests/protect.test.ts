import { describe, expect, it } from 'vitest';
import { planEdits, planJeLine } from '../src/core/edits';
import { frontmatterRange, isJeLine, protectedRanges, toJeLine } from '../src/core/protect';

const NOTE = [
	'---',
	'ClaudeCheck: 2026-01-01 00:00:00',
	'---',
	'# Topic',
	'- JE: my own note with beta',
	'> - JE: callout note',
	'1. JE: numbered note',
	'A claim about alpha.',
	'## DO NOT EDIT',
	'frozen gamma text',
].join('\n');

describe('protected regions', () => {
	it('detects frontmatter including both fences', () => {
		const fm = frontmatterRange(NOTE);
		expect(fm).not.toBeNull();
		if (fm) expect(NOTE.slice(fm.from, fm.to)).toBe('---\nClaudeCheck: 2026-01-01 00:00:00\n---\n');
		expect(frontmatterRange('# no frontmatter\n---\n')).toBeNull();
	});

	it('recognises JE: lines with list, number and callout prefixes', () => {
		expect(isJeLine('JE: plain')).toBe(true);
		expect(isJeLine('  - JE: list')).toBe(true);
		expect(isJeLine('> - JE: callout list')).toBe(true);
		expect(isJeLine('> > JE: nested callout')).toBe(true);
		expect(isJeLine('12) JE: numbered')).toBe(true);
		expect(isJeLine('- not JE: here')).toBe(false);
		expect(isJeLine('JEX: nope')).toBe(false);
	});

	it('protects everything from a DO NOT EDIT heading to the end', () => {
		const ranges = protectedRanges(NOTE);
		const last = ranges[ranges.length - 1];
		expect(NOTE.slice(last.from, last.to)).toBe('## DO NOT EDIT\nfrozen gamma text');
	});

	it('rejects edits into frontmatter, JE: lines and the DO NOT EDIT region', () => {
		const plan = planEdits(NOTE, [
			{ id: 'fm', edits: [{ find: 'ClaudeCheck: 2026', replace: 'x' }] },
			{ id: 'je', edits: [{ find: 'my own note', replace: 'x' }] },
			{ id: 'co', edits: [{ find: 'callout note', replace: 'x' }] },
			{ id: 'num', edits: [{ find: 'numbered note', replace: 'x' }] },
			{ id: 'dne', edits: [{ find: 'frozen gamma', replace: 'x' }] },
			{ id: 'ok', edits: [{ find: 'about alpha', replace: 'about $\\alpha$' }] },
		]);
		expect(plan.appliedGroups).toEqual(['ok']);
		expect(plan.rejected.map((r) => r.groupId)).toEqual(['fm', 'je', 'co', 'num', 'dne']);
		for (const r of plan.rejected) expect(r.reason).toMatch(/protected/);
	});
});

describe('Make JE: line', () => {
	it('inserts JE: after list and callout prefixes, idempotently', () => {
		expect(toJeLine('- a claim')).toBe('- JE: a claim');
		expect(toJeLine('> 2. a claim')).toBe('> 2. JE: a claim');
		expect(toJeLine('plain')).toBe('JE: plain');
		expect(toJeLine('- JE: done')).toBe('- JE: done');
	});

	it('plans a JE: conversion for the line holding the quote', () => {
		const r = planJeLine(NOTE, 'about alpha');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.edit.replace).toBe('JE: A claim about alpha.');
	});

	it('refuses lines that are protected or already JE:', () => {
		expect(planJeLine(NOTE, 'frozen gamma').ok).toBe(false);
		expect(planJeLine(NOTE, 'my own note').ok).toBe(false);
		expect(planJeLine(NOTE, 'missing text').ok).toBe(false);
	});

	it('handles a quote at the very start of the text', () => {
		const r = planJeLine('first line\nsecond', 'first');
		expect(r.ok && r.edit.replace).toBe('JE: first line');
	});
});
