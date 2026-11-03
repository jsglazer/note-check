/**
 * Editor highlight for the finding under the pointer in the review panel.
 *
 * This is the only module that touches Obsidian's undocumented `editor.cm`
 * (the CodeMirror 6 EditorView behind a MarkdownView), so an API change is a
 * one-file fix. Targeted against Obsidian 1.14.4 (@codemirror/view 6.43.13).
 */
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { Editor } from 'obsidian';
import type { TextRange } from './core/types';

const setHighlight = StateEffect.define<TextRange | null>();

function lineDecorations(view: { state: EditorView['state'] }, range: TextRange): DecorationSet {
	const doc = view.state.doc;
	const from = Math.min(Math.max(range.from, 0), doc.length);
	const to = Math.min(Math.max(range.to, from), doc.length);
	const first = doc.lineAt(from).number;
	const last = doc.lineAt(Math.max(to - 1, from)).number;
	const builder = new RangeSetBuilder<Decoration>();
	for (let n = first; n <= last; n++) {
		const cls = ['note-check-hl'];
		if (n === first) cls.push('note-check-hl-first');
		if (n === last) cls.push('note-check-hl-last');
		builder.add(doc.line(n).from, doc.line(n).from, Decoration.line({ class: cls.join(' ') }));
	}
	return builder.finish();
}

const highlightField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		let next = deco.map(tr.changes);
		for (const e of tr.effects) {
			if (e.is(setHighlight)) next = e.value ? lineDecorations(tr, e.value) : Decoration.none;
		}
		return next;
	},
	provide: (f) => EditorView.decorations.from(f),
});

/** Register once via plugin.registerEditorExtension. */
export const reviewHighlightExtension: Extension = highlightField;

function viewOf(editor: Editor): EditorView | null {
	const cm = (editor as unknown as { cm?: unknown }).cm;
	return cm instanceof EditorView ? cm : null;
}

/** Highlight the lines covering `range` in this editor, or clear with null. */
export function setReviewHighlight(editor: Editor, range: TextRange | null): void {
	const view = viewOf(editor);
	if (!view) return;
	view.dispatch({ effects: setHighlight.of(range) });
}
