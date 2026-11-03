import type { Finding, ReviewMode, Typo } from './types';

export type ItemStatus = 'open' | 'applied' | 'ignored';

/** Outstanding work after a review, used by the pass rule. */
export interface OpenCounts {
	high: number;
	med: number;
	low: number;
	typos: number;
}

/**
 * Pass rule ported from check-inventory:
 * - check: nothing open (no findings and no typos)
 * - recheck: no open High findings
 */
export function passes(mode: ReviewMode, open: OpenCounts): boolean {
	if (mode === 'recheck') return open.high === 0;
	return open.high + open.med + open.low + open.typos === 0;
}

export function countOpen(
	findings: Finding[],
	typos: Typo[],
	status: (id: string) => ItemStatus,
): OpenCounts {
	const counts: OpenCounts = { high: 0, med: 0, low: 0, typos: 0 };
	for (const f of findings) {
		if (status(f.id) !== 'open') continue;
		if (f.severity === 'High') counts.high++;
		else if (f.severity === 'Med') counts.med++;
		else counts.low++;
	}
	for (const t of typos) if (status(t.id) === 'open') counts.typos++;
	return counts;
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

/** `YYYY-MM-DD HH:MM:SS` in local time, from an injected clock value. */
export function formatStamp(d: Date): string {
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
		`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
	);
}

/** Stable fingerprint for "ignore" memory: the whitespace-normalised quote. */
export function fingerprint(quote: string): string {
	return quote.replace(/\s+/g, ' ').trim();
}

/** Sort items by where their quote sits in the text; unanchored items go last. */
export function sortByPosition<T extends { id: string }>(
	items: T[],
	position: (item: T) => number | null,
): T[] {
	return [...items]
		.map((item, index) => ({ item, index, pos: position(item) }))
		.sort((a, b) => {
			if (a.pos === null && b.pos === null) return a.index - b.index;
			if (a.pos === null) return 1;
			if (b.pos === null) return -1;
			return a.pos - b.pos || a.index - b.index;
		})
		.map((x) => x.item);
}
