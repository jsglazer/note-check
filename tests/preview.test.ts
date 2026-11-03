import { describe, expect, it } from 'vitest';
import { lineBelow, mathBalanced, mathSpans, previewEdit } from '../src/core/preview';

describe('mathSpans', () => {
	it('finds inline and display spans and skips escaped dollars', () => {
		const s = 'a $x$ b $$y$$ costs \\$5 $z';
		expect(mathSpans(s).map((r) => s.slice(r.from, r.to))).toEqual(['$x$', '$$y$$']);
	});
});

describe('mathBalanced', () => {
	it('detects unpaired dollars', () => {
		expect(mathBalanced('$a$ and $b$')).toBe(true);
		expect(mathBalanced('$\\log(\\text{price}) = 12.32')).toBe(false);
		expect(mathBalanced('price \\$5')).toBe(true);
	});
});

describe('previewEdit', () => {
	it('widens a fragment that cuts into an equation to the whole equation', () => {
		const note = 'Intro\nThe fit is $\\log(\\text{price}) = 12.32$ on average.\nEnd';
		const p = previewEdit(note, {
			find: '$\\log(\\text{price}) = 12.32',
			replace: '$\\widehat{\\log(\\text{price})} = 12.32',
		});
		expect(p).toEqual({
			before: '… $\\log(\\text{price}) = 12.32$ …',
			after: '… $\\widehat{\\log(\\text{price})} = 12.32$ …',
			widened: true,
		});
		if (p) {
			expect(mathBalanced(p.before)).toBe(true);
			expect(mathBalanced(p.after)).toBe(true);
		}
	});

	it('leaves a fragment that does not cut math unchanged', () => {
		const p = previewEdit('one $x$ two three', { find: 'two', replace: '2' });
		expect(p).toEqual({ before: '… two …', after: '… 2 …', widened: false });
	});

	it('widens across several cut equations', () => {
		const note = 'A $a+b$ and $c+d$ end';
		const p = previewEdit(note, { find: 'b$ and $c', replace: 'B$ and $C' });
		expect(p?.before).toBe('… $a+b$ and $c+d$ …');
		expect(p?.after).toBe('… $a+B$ and $C+d$ …');
	});

	it('returns null when the edit text is missing or ambiguous', () => {
		expect(previewEdit('abc', { find: 'zzz', replace: 'y' })).toBeNull();
		expect(previewEdit('a a', { find: 'a', replace: 'b' })).toBeNull();
	});
});

describe('lineBelow', () => {
	const text = 'l0\nl1 target\nl2\nl3';
	it('returns the line after the target line', () => {
		const from = text.indexOf('target');
		expect(lineBelow(text, { from, to: from + 6 })).toBe(2);
	});
	it('handles a target ending exactly at a newline and clamps at the last line', () => {
		expect(lineBelow(text, { from: 3, to: 13 })).toBe(2);
		const from = text.indexOf('l3');
		expect(lineBelow(text, { from, to: from + 2 })).toBe(3);
	});
});
