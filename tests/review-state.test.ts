import { describe, expect, it } from 'vitest';
import {
	buildReviewMessage,
	buildSystemPrompt,
	DEFAULT_RULES,
	OUTPUT_PROTOCOL,
} from '../src/core/prompt';
import {
	countOpen,
	fingerprint,
	formatStamp,
	passes,
	sortByPosition,
} from '../src/core/review-state';
import type { Finding } from '../src/core/types';

const f = (id: string, severity: Finding['severity']): Finding => ({
	id,
	severity,
	heading: '',
	quote: id,
	problem: '',
	suggestion: '',
	edits: [],
});

describe('pass rule', () => {
	it('check mode passes only when nothing is open', () => {
		expect(passes('check', { high: 0, med: 0, low: 0, typos: 0 })).toBe(true);
		expect(passes('check', { high: 0, med: 0, low: 1, typos: 0 })).toBe(false);
		expect(passes('check', { high: 0, med: 0, low: 0, typos: 1 })).toBe(false);
	});

	it('recheck mode passes when no High findings are open', () => {
		expect(passes('recheck', { high: 0, med: 2, low: 3, typos: 1 })).toBe(true);
		expect(passes('recheck', { high: 1, med: 0, low: 0, typos: 0 })).toBe(false);
	});

	it('counts only open items', () => {
		const findings = [f('a', 'High'), f('b', 'Med'), f('c', 'High')];
		const counts = countOpen(findings, [], (id) => (id === 'a' ? 'applied' : 'open'));
		expect(counts).toEqual({ high: 1, med: 1, low: 0, typos: 0 });
	});
});

describe('stamp and fingerprint', () => {
	it('formats the stamp from a fixed clock', () => {
		expect(formatStamp(new Date(2026, 10, 2, 9, 5, 7))).toBe('2026-11-02 09:05:07');
	});

	it('fingerprints quotes by normalised whitespace', () => {
		expect(fingerprint('  a\n  b\tc ')).toBe('a b c');
	});
});

describe('ordering', () => {
	it('sorts by position and puts unanchored items last, keeping input order for ties', () => {
		const items = [{ id: 'x' }, { id: 'y' }, { id: 'z' }, { id: 'w' }];
		const pos: Record<string, number | null> = { x: 30, y: null, z: 10, w: null };
		expect(sortByPosition(items, (i) => pos[i.id]).map((i) => i.id)).toEqual(['z', 'x', 'y', 'w']);
	});
});

describe('prompts', () => {
	it('falls back to built-in rules and always appends the output protocol', () => {
		expect(buildSystemPrompt('  ')).toBe(`${DEFAULT_RULES.trim()}\n\n${OUTPUT_PROTOCOL}`);
		expect(buildSystemPrompt('My rules')).toBe(`My rules\n\n${OUTPUT_PROTOCOL}`);
	});

	it('lists handled items and wraps the note as data', () => {
		const msg = buildReviewMessage('NOTE BODY', 'recheck', [{ quote: 'q1', status: 'ignored' }]);
		expect(msg).toContain('Mode: RECHECK');
		expect(msg).toContain('- (ignored) "q1"');
		expect(msg.endsWith('<note>\nNOTE BODY\n</note>')).toBe(true);
	});
});
