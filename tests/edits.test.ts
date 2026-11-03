import { describe, expect, it } from 'vitest';
import { applyPlan, planEdits } from '../src/core/edits';

describe('planEdits / applyPlan', () => {
	const text = 'one two three four five';

	it('applies non-overlapping edits in descending offset order', () => {
		const plan = planEdits(text, [
			{ id: 'a', edits: [{ find: 'two', replace: '2' }] },
			{ id: 'b', edits: [{ find: 'four', replace: 'FOUR' }] },
		]);
		expect(plan.rejected).toEqual([]);
		expect(plan.edits.map((e) => e.range.from)).toEqual([14, 4]);
		expect(applyPlan(text, plan.edits)).toBe('one 2 three FOUR five');
	});

	it('rejects a group that overlaps an earlier accepted group', () => {
		const plan = planEdits(text, [
			{ id: 'a', edits: [{ find: 'two three', replace: 'x' }] },
			{ id: 'b', edits: [{ find: 'three four', replace: 'y' }] },
		]);
		expect(plan.appliedGroups).toEqual(['a']);
		expect(plan.rejected).toEqual([
			{ groupId: 'b', reason: 'Edit overlaps another selected edit.' },
		]);
		expect(applyPlan(text, plan.edits)).toBe('one x four five');
	});

	it('rejects a whole group when one of its edits fails', () => {
		const plan = planEdits(text, [
			{
				id: 'a',
				edits: [
					{ find: 'one', replace: '1' },
					{ find: 'missing', replace: 'z' },
				],
			},
		]);
		expect(plan.edits).toEqual([]);
		expect(plan.rejected[0].reason).toMatch(/not found/);
	});

	it('rejects ambiguous and empty groups', () => {
		const plan = planEdits('a a', [
			{ id: 'amb', edits: [{ find: 'a', replace: 'b' }] },
			{ id: 'empty', edits: [] },
		]);
		expect(plan.rejected.map((r) => r.groupId)).toEqual(['amb', 'empty']);
	});

	it('rejects overlapping edits inside the same group', () => {
		const plan = planEdits(text, [
			{
				id: 'a',
				edits: [
					{ find: 'two three', replace: 'x' },
					{ find: 'three', replace: 'y' },
				],
			},
		]);
		expect(plan.rejected[0].reason).toMatch(/overlaps/);
	});
});
