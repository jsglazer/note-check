import {
	Component,
	debounce,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	Notice,
	TFile,
	type Editor,
	type WorkspaceLeaf,
} from 'obsidian';
import { callClaude } from './claude';
import { setReviewHighlight } from './cm-highlight';
import { locateQuote } from './core/anchor';
import { planEdits, planJeLine, type EditGroup, type ResolvedEdit } from './core/edits';
import { lineBelow, mathBalanced, previewEdit } from './core/preview';
import {
	buildAskMessage,
	buildReviewMessage,
	buildRevisionMessage,
	buildSystemPrompt,
	DEFAULT_RULES,
	type HandledItem,
} from './core/prompt';
import {
	countOpen,
	fingerprint,
	formatStamp,
	passes,
	sortByPosition,
	type ItemStatus,
} from './core/review-state';
import { parseReview, parseRevision, REVIEW_SCHEMA, REVISION_SCHEMA } from './core/schema';
import type { Finding, ProposedEdit, ReviewMode, ReviewResult, Typo } from './core/types';
import type NoteCheckPlugin from './main';

export const VIEW_TYPE_NOTE_CHECK = 'note-check-view';

interface ThreadEntry {
	role: 'user' | 'claude';
	text: string;
}

interface ItemState {
	status: ItemStatus;
	checked: boolean;
	/** Edits from "Apply my version", replacing the model's original edits. */
	customEdits: ProposedEdit[] | null;
	message: string | null;
	thread: ThreadEntry[];
	draft: string;
	busy: boolean;
}

/** Review state for one note, kept for the session so the pane survives note switches. */
export interface NoteReview {
	path: string;
	mode: ReviewMode;
	result: ReviewResult | null;
	items: Map<string, ItemState>;
	error: string | null;
	busy: boolean;
	usage: string[];
	usedDefaultRules: boolean;
	stamped: string | null;
}

function newItem(checked: boolean): ItemState {
	return {
		status: 'open',
		checked,
		customEdits: null,
		message: null,
		thread: [],
		draft: '',
		busy: false,
	};
}

export class NoteCheckView extends ItemView {
	private path: string | null = null;
	private renderScope: Component | null = null;
	private readonly rerenderSoon = debounce(() => this.render(), 800, true);
	/** Scroll-sync of the note to the card at the top of the panel. */
	private readonly syncSoon = debounce(() => this.syncEditorToPanel(), 150, true);
	/** Inner wrapper rebuilt on each render (contentEl is the scroll container). */
	private body: HTMLElement | null = null;
	private renderedPath: string | null = null;
	private applyBtn: HTMLButtonElement | null = null;
	private lastSynced: string | null = null;
	/** Quote of the card under the pointer, highlighted in the note. */
	private highlighted: string | null = null;
	/** Live note text captured at render time, used for previews and anchors. */
	private liveText: string | null = null;
	/** Markdown render promises from the current render, awaited to restore scroll. */
	private pending: Promise<void>[] = [];

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: NoteCheckPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_NOTE_CHECK;
	}

	getDisplayText(): string {
		return 'Note check';
	}

	getIcon(): string {
		return 'book-open-check';
	}

	async onOpen(): Promise<void> {
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.followActive()));
		this.registerEvent(
			this.app.workspace.on('editor-change', (_editor, info) => {
				if (info.file?.path === this.path) this.rerenderSoon();
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				const review = this.plugin.reviews.get(oldPath);
				if (review) {
					this.plugin.reviews.delete(oldPath);
					review.path = file.path;
					this.plugin.reviews.set(file.path, review);
				}
				if (this.path === oldPath) this.path = file.path;
				this.render();
			}),
		);
		// Pointer leaving the panel clears the yellow highlight in the note.
		this.registerDomEvent(this.contentEl, 'mouseleave', () => this.highlight(null));
		this.registerDomEvent(this.contentEl, 'scroll', () => {
			if (this.plugin.settings.autoScroll) this.syncSoon();
		});
		this.followActive();
	}

	async onClose(): Promise<void> {
		this.rerenderSoon.cancel();
		this.syncSoon.cancel();
		this.highlight(null);
		if (this.renderScope) this.removeChild(this.renderScope);
		this.renderScope = null;
	}

	/** Track the active Markdown note; ignore focus moving into side panes. */
	private followActive(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const path = view?.file?.path ?? null;
		if (path && path !== this.path) {
			this.highlight(null); // clear the box in the note we are leaving
			this.path = path;
			this.render();
		} else if (!this.path) {
			this.render();
		}
	}

	/** Called by the command: review the given note now. */
	async startReview(path: string): Promise<void> {
		this.path = path;
		const existing = this.plugin.reviews.get(path);
		await this.runReview(existing?.result ? 'recheck' : 'check');
	}

	// ---- note access -------------------------------------------------------

	private file(): TFile | null {
		if (!this.path) return null;
		const f = this.app.vault.getAbstractFileByPath(this.path);
		return f instanceof TFile ? f : null;
	}

	private markdownView(): MarkdownView | null {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const v = leaf.view;
			if (v instanceof MarkdownView && v.file?.path === this.path) return v;
		}
		return null;
	}

	private editor(): Editor | null {
		return this.markdownView()?.editor ?? null;
	}

	/** Live editor text when the note is open, else the file on disk. */
	private async noteText(): Promise<string | null> {
		const ed = this.editor();
		if (ed) return ed.getValue();
		const f = this.file();
		return f ? this.app.vault.read(f) : null;
	}

	private async rulesText(review: NoteReview): Promise<string> {
		const f = this.app.vault.getAbstractFileByPath(this.plugin.settings.rulesPath);
		if (f instanceof TFile) {
			review.usedDefaultRules = false;
			return this.app.vault.cachedRead(f);
		}
		review.usedDefaultRules = true;
		return DEFAULT_RULES;
	}

	private apiKey(): string | null {
		const id = this.plugin.settings.apiKeySecret;
		if (!id) return null;
		return this.app.secretStorage.getSecret(id);
	}

	private review(): NoteReview | null {
		return this.path ? (this.plugin.reviews.get(this.path) ?? null) : null;
	}

	private ensureReview(path: string): NoteReview {
		let r = this.plugin.reviews.get(path);
		if (!r) {
			r = {
				path,
				mode: 'check',
				result: null,
				items: new Map(),
				error: null,
				busy: false,
				usage: [],
				usedDefaultRules: false,
				stamped: null,
			};
			this.plugin.reviews.set(path, r);
		}
		return r;
	}

	// ---- actions -----------------------------------------------------------

	private handledItems(review: NoteReview): HandledItem[] {
		const out: HandledItem[] = [];
		const seen = new Set<string>();
		const add = (quote: string, status: HandledItem['status']): void => {
			const fp = fingerprint(quote);
			if (seen.has(fp)) return;
			seen.add(fp);
			out.push({ quote, status });
		};
		const result = review.result;
		if (result) {
			for (const item of [...result.findings, ...result.typos]) {
				const st = review.items.get(item.id)?.status;
				if (st === 'ignored') add(item.quote, 'ignored');
				else if (st === 'applied') add(item.quote, 'fixed');
			}
		}
		for (const fp of this.plugin.settings.ignored[review.path] ?? []) add(fp, 'ignored');
		return out;
	}

	async runReview(mode: ReviewMode): Promise<void> {
		if (!this.path) return;
		const review = this.ensureReview(this.path);
		if (review.busy) return;
		const key = this.apiKey();
		if (!key) {
			review.error = 'No API key found. Set the Anthropic API key secret in the plugin settings.';
			this.render();
			return;
		}
		const text = await this.noteText();
		if (text === null) {
			review.error = 'The note could not be read.';
			this.render();
			return;
		}
		review.mode = mode;
		review.busy = true;
		review.error = null;
		this.render();
		try {
			const rules = await this.rulesText(review);
			const res = await callClaude({
				apiKey: key,
				model: this.plugin.settings.model,
				effort: this.plugin.settings.effort,
				system: buildSystemPrompt(rules),
				user: buildReviewMessage(text, mode, this.handledItems(review)),
				schema: REVIEW_SCHEMA,
			});
			review.usage.push(`Review: ${res.usage}`);
			const parsed = parseReview(res.text);
			if (!parsed.ok) throw new Error(`Claude's answer could not be read: ${parsed.error}`);
			const ignored = new Set(this.plugin.settings.ignored[review.path] ?? []);
			review.result = parsed.value;
			review.items = new Map();
			review.stamped = null;
			for (const f of parsed.value.findings) {
				const item = newItem(false);
				if (ignored.has(fingerprint(f.quote))) item.status = 'ignored';
				review.items.set(f.id, item);
			}
			for (const t of parsed.value.typos) review.items.set(t.id, newItem(true));
		} catch (e) {
			review.error = e instanceof Error ? e.message : String(e);
		} finally {
			review.busy = false;
		}
		this.render();
		await this.maybeAutoStamp(review);
	}

	private groupFor(item: Finding | Typo, state: ItemState): EditGroup {
		return { id: item.id, edits: state.customEdits ?? item.edits };
	}

	private applyToEditor(editor: Editor, edits: ResolvedEdit[]): void {
		if (edits.length === 0) return;
		editor.transaction({
			changes: edits.map((e) => ({
				from: editor.offsetToPos(e.range.from),
				to: editor.offsetToPos(e.range.to),
				text: e.replace,
			})),
		});
	}

	async applySelected(): Promise<void> {
		const review = this.review();
		if (!review?.result) return;
		const editor = this.editor();
		if (!editor) {
			new Notice('Open the note in an editor to apply fixes.');
			return;
		}
		const groups: EditGroup[] = [];
		for (const item of [...review.result.typos, ...review.result.findings]) {
			const st = review.items.get(item.id);
			if (st && st.status === 'open' && st.checked) groups.push(this.groupFor(item, st));
		}
		if (groups.length === 0) {
			new Notice('Nothing is ticked.');
			return;
		}
		const plan = planEdits(editor.getValue(), groups);
		this.applyToEditor(editor, plan.edits);
		for (const id of plan.appliedGroups) {
			const st = review.items.get(id);
			if (st) {
				st.status = 'applied';
				st.checked = false;
				st.message = null;
			}
		}
		for (const r of plan.rejected) {
			const st = review.items.get(r.groupId);
			if (st) {
				st.checked = false;
				st.message = `Not applied: ${r.reason}`;
			}
		}
		new Notice(
			`Applied ${plan.appliedGroups.length} fix${plan.appliedGroups.length === 1 ? '' : 'es'}` +
				(plan.rejected.length ? `, ${plan.rejected.length} not applied` : '') +
				'.',
		);
		this.render();
		if (this.plugin.settings.autoRecheck && plan.appliedGroups.length > 0) {
			await this.runReview('recheck');
		} else {
			await this.maybeAutoStamp(review);
		}
	}

	private async ignore(item: Finding | Typo): Promise<void> {
		const review = this.review();
		const st = review?.items.get(item.id);
		if (!review || !st) return;
		st.status = 'ignored';
		st.checked = false;
		const list = this.plugin.settings.ignored[review.path] ?? [];
		const fp = fingerprint(item.quote);
		if (!list.includes(fp)) list.push(fp);
		this.plugin.settings.ignored[review.path] = list;
		await this.plugin.saveSettings();
		this.render();
		await this.maybeAutoStamp(review);
	}

	private async makeJeLine(item: Finding): Promise<void> {
		const editor = this.editor();
		const st = this.review()?.items.get(item.id);
		if (!editor || !st) {
			new Notice('Open the note in an editor first.');
			return;
		}
		const plan = planJeLine(editor.getValue(), item.quote);
		if (!plan.ok) {
			st.message = plan.reason;
			this.render();
			return;
		}
		this.applyToEditor(editor, [plan.edit]);
		await this.ignore(item);
	}

	private async ask(item: Finding, kind: 'ask' | 'revise'): Promise<void> {
		const review = this.review();
		const st = review?.items.get(item.id);
		if (!review || !st || st.busy) return;
		const draft = st.draft.trim();
		if (!draft) {
			new Notice(kind === 'ask' ? 'Type a question first.' : 'Describe your change first.');
			return;
		}
		const key = this.apiKey();
		const text = await this.noteText();
		if (!key || text === null) {
			st.message = key ? 'The note could not be read.' : 'No API key found.';
			this.render();
			return;
		}
		st.busy = true;
		st.message = null;
		st.thread.push({ role: 'user', text: draft });
		st.draft = '';
		this.render();
		try {
			const rules = await this.rulesText(review);
			const res = await callClaude({
				apiKey: key,
				model: this.plugin.settings.model,
				effort: this.plugin.settings.effort,
				system: buildSystemPrompt(rules),
				user:
					kind === 'ask'
						? buildAskMessage(text, item, draft)
						: buildRevisionMessage(text, item, draft),
				schema: kind === 'ask' ? null : REVISION_SCHEMA,
			});
			review.usage.push(`${kind === 'ask' ? 'Ask' : 'Revise'}: ${res.usage}`);
			if (kind === 'ask') {
				st.thread.push({ role: 'claude', text: res.text });
			} else {
				const parsed = parseRevision(res.text);
				if (!parsed.ok) throw new Error(`Claude's answer could not be read: ${parsed.error}`);
				st.customEdits = parsed.value.edits;
				st.checked = parsed.value.edits.length > 0;
				const summary = parsed.value.edits.length
					? 'Proposed edits for your version are shown above and ticked. Press **Apply selected** to apply them.'
					: 'No edit could be made from that instruction.';
				st.thread.push({
					role: 'claude',
					text: [summary, parsed.value.note].filter(Boolean).join('\n\n'),
				});
			}
		} catch (e) {
			st.message = e instanceof Error ? e.message : String(e);
		} finally {
			st.busy = false;
		}
		this.render();
	}

	private canStamp(review: NoteReview): boolean {
		if (!review.result || review.busy) return false;
		const status = (id: string): ItemStatus => review.items.get(id)?.status ?? 'open';
		return passes(review.mode, countOpen(review.result.findings, review.result.typos, status));
	}

	private async maybeAutoStamp(review: NoteReview): Promise<void> {
		if (this.plugin.settings.autoStamp && !review.stamped && this.canStamp(review))
			await this.stamp(review);
	}

	private async stamp(review: NoteReview): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(review.path);
		if (!(f instanceof TFile)) return;
		// Flush unsaved editor changes so the frontmatter write can't race them.
		const mv = this.markdownView();
		if (mv) await mv.save();
		const value = formatStamp(new Date());
		await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
			fm.ClaudeCheck = value;
		});
		review.stamped = value;
		new Notice(`ClaudeCheck stamped: ${value}`);
		this.render();
	}

	private jumpTo(quote: string): void {
		const mv = this.markdownView();
		if (!mv) {
			new Notice('Open the note in an editor to jump to the text.');
			return;
		}
		const loc = locateQuote(mv.editor.getValue(), quote);
		if (loc.status !== 'unique') {
			new Notice(
				loc.status === 'none'
					? 'That text is no longer in the note.'
					: 'That text appears more than once.',
			);
			return;
		}
		this.app.workspace.setActiveLeaf(mv.leaf, { focus: true });
		const from = mv.editor.offsetToPos(loc.range.from);
		const to = mv.editor.offsetToPos(loc.range.to);
		// Cursor goes on the line below the target so the target itself isn't selected or highlighted.
		mv.editor.setCursor({ line: lineBelow(mv.editor.getValue(), loc.range), ch: 0 });
		mv.editor.scrollIntoView({ from, to }, true);
	}

	/** Draw (or clear) the yellow box over the lines a card is about. */
	private highlight(quote: string | null): void {
		if (quote === this.highlighted) return;
		this.highlighted = quote;
		const editor = this.editor();
		if (!editor) return;
		if (quote === null) {
			setReviewHighlight(editor, null);
			return;
		}
		const loc = locateQuote(editor.getValue(), quote);
		setReviewHighlight(editor, loc.status === 'unique' ? loc.range : null);
	}

	/** Hover (desktop) or tap/focus (mobile) on a card highlights its lines in the note. */
	private wireHighlight(card: HTMLElement, quote: string): void {
		card.addEventListener('mouseenter', () => this.highlight(quote));
		card.addEventListener('focusin', () => this.highlight(quote));
		card.addEventListener('pointerdown', () => this.highlight(quote));
	}

	/** Scroll the note to the card at the top of the panel (no cursor or focus change). */
	private syncEditorToPanel(): void {
		if (!this.plugin.settings.autoScroll || !this.body) return;
		const mv = this.markdownView();
		if (!mv) return;
		const top = this.contentEl.getBoundingClientRect().top;
		const cards = Array.from(
			this.body.querySelectorAll<HTMLElement>('.note-check-card[data-quote]'),
		);
		const target = cards.find((c) => c.getBoundingClientRect().bottom > top + 48);
		const quote = target?.getAttribute('data-quote');
		if (!target || !quote || quote === this.lastSynced) return;
		this.lastSynced = quote;
		for (const c of cards) c.toggleClass('is-synced', c === target);
		const loc = locateQuote(mv.editor.getValue(), quote);
		if (loc.status !== 'unique') return;
		const from = mv.editor.offsetToPos(loc.range.from);
		const to = mv.editor.offsetToPos(loc.range.to);
		mv.editor.scrollIntoView({ from, to }, true);
	}

	// ---- rendering ---------------------------------------------------------

	private md(el: HTMLElement, markdown: string): void {
		if (!this.renderScope) return;
		this.pending.push(
			MarkdownRenderer.render(this.app, markdown, el, this.path ?? '', this.renderScope),
		);
	}

	render(): void {
		if (this.renderScope) this.removeChild(this.renderScope);
		this.renderScope = this.addChild(new Component());
		const scroller = this.contentEl;
		const samePath = this.renderedPath === this.path;
		const prevTop = samePath ? scroller.scrollTop : 0;
		const prevHeight = samePath ? (this.body?.offsetHeight ?? 0) : 0;
		if (!samePath) this.lastSynced = null;
		this.renderedPath = this.path;
		this.pending = [];
		this.applyBtn = null;
		scroller.empty();
		scroller.addClass('note-check-scroller');
		const root = scroller.createDiv({ cls: 'note-check' });
		this.body = root;
		// Hold the old height until the async Markdown has rendered, so the scroll position survives.
		if (prevHeight > 0) root.setCssProps({ '--note-check-hold-height': `${prevHeight}px` });
		this.build(root);
		// Drop the highlight if its card is gone (applied, ignored, or a new review).
		const quotes = Array.from(root.querySelectorAll('.note-check-card[data-quote]')).map((c) =>
			c.getAttribute('data-quote'),
		);
		if (this.highlighted !== null && !quotes.includes(this.highlighted)) this.highlight(null);
		scroller.scrollTop = prevTop;
		const pending = this.pending;
		void Promise.allSettled(pending).then(() => {
			if (this.body !== root) return;
			scroller.scrollTop = prevTop;
			root.setCssProps({ '--note-check-hold-height': '0px' });
		});
	}

	private build(root: HTMLElement): void {
		if (!this.path) {
			root.createDiv({
				cls: 'note-check-empty',
				text: 'Open a note, then run "Review current note".',
			});
			return;
		}
		const review = this.review();
		const name = this.path.split('/').pop() ?? this.path;

		const header = root.createDiv({ cls: 'note-check-header' });
		header.createDiv({ cls: 'note-check-title', text: name.replace(/\.md$/, '') });
		const controls = header.createDiv({ cls: 'note-check-controls' });
		const modeSel = controls.createEl('select', { cls: 'dropdown' });
		modeSel.createEl('option', { value: 'check', text: 'Check' });
		modeSel.createEl('option', { value: 'recheck', text: 'Recheck' });
		modeSel.value = review?.mode ?? (review?.result ? 'recheck' : 'check');
		const runBtn = controls.createEl('button', {
			cls: 'mod-cta',
			text: review?.busy ? 'Reviewing…' : review?.result ? 'Run again' : 'Review',
		});
		runBtn.disabled = review?.busy ?? false;
		runBtn.addEventListener('click', () => void this.runReview(modeSel.value as ReviewMode));

		if (!review) {
			root.createDiv({ cls: 'note-check-empty', text: 'Not reviewed yet in this session.' });
			return;
		}
		if (review.busy)
			root.createDiv({ cls: 'note-check-status', text: 'Claude is reviewing the note…' });
		if (review.error) root.createDiv({ cls: 'note-check-error', text: review.error });
		if (review.usedDefaultRules) {
			root.createDiv({
				cls: 'note-check-status',
				text: `Rules note "${this.plugin.settings.rulesPath}" not found; built-in rules were used.`,
			});
		}
		const result = review.result;
		if (!result) return;

		const status = (id: string): ItemStatus => review.items.get(id)?.status ?? 'open';
		const open = countOpen(result.findings, result.typos, status);
		const summary = root.createDiv({ cls: 'note-check-summary' });
		summary.createSpan({ cls: 'note-check-badge sev-high', text: `${open.high} high` });
		summary.createSpan({ cls: 'note-check-badge sev-med', text: `${open.med} med` });
		summary.createSpan({ cls: 'note-check-badge sev-low', text: `${open.low} low` });
		summary.createSpan({ cls: 'note-check-badge sev-typo', text: `${open.typos} typos` });

		const pass = this.canStamp(review);
		const stampRow = root.createDiv({ cls: 'note-check-stamp' });
		if (review.stamped) {
			stampRow.setText(`Stamped ClaudeCheck: ${review.stamped}`);
		} else if (pass) {
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- ClaudeCheck and JE: are literal names used in the notes
			const b = stampRow.createEl('button', { cls: 'mod-cta', text: 'Stamp ClaudeCheck' });
			b.addEventListener('click', () => void this.stamp(review));
		} else {
			stampRow.setText(
				review.mode === 'recheck'
					? 'Not stamped: High findings remain.'
					: 'Not stamped: items remain open.',
			);
		}

		const text = this.editor()?.getValue() ?? null;
		this.liveText = text;
		const position = (quote: string): number | null => {
			if (text === null) return null;
			const loc = locateQuote(text, quote);
			return loc.status === 'unique' ? loc.range.from : null;
		};
		const anchorNote = (quote: string): string | null => {
			if (text === null) return null;
			const loc = locateQuote(text, quote);
			if (loc.status === 'none') return 'changed — recheck';
			if (loc.status === 'multiple') return 'ambiguous';
			return null;
		};

		const openTypos = sortByPosition(
			result.typos.filter((t) => status(t.id) === 'open'),
			(t) => position(t.quote),
		);
		if (openTypos.length) {
			const sec = root.createDiv({ cls: 'note-check-section' });
			sec.createEl('h4', { text: 'Typos' });
			for (const t of openTypos) this.renderTypo(sec, t, review, anchorNote(t.quote));
		}

		const openFindings = sortByPosition(
			result.findings.filter((f) => status(f.id) === 'open'),
			(f) => position(f.quote),
		);
		const sec = root.createDiv({ cls: 'note-check-section' });
		sec.createEl('h4', { text: openFindings.length ? 'Findings' : 'No open findings' });
		for (const f of openFindings) this.renderFinding(sec, f, review, anchorNote(f.quote));

		const handled = [...result.findings, ...result.typos].filter((x) => status(x.id) !== 'open');
		if (handled.length) {
			const det = root.createEl('details', { cls: 'note-check-handled' });
			det.createEl('summary', { text: `Handled (${handled.length})` });
			for (const h of handled) {
				const row = det.createDiv({ cls: 'note-check-handled-row' });
				row.createSpan({ cls: 'note-check-tag', text: status(h.id) });
				row.createSpan({ text: ` ${h.quote}` });
			}
		}

		const footer = root.createDiv({ cls: 'note-check-footer' });
		const apply = footer.createEl('button', { cls: 'mod-cta' });
		this.applyBtn = apply;
		this.updateApplyButton();
		apply.addEventListener('click', () => void this.applySelected());
		if (review.usage.length) {
			const u = footer.createEl('details', { cls: 'note-check-usage' });
			u.createEl('summary', { text: `Token use: ${review.usage[review.usage.length - 1]}` });
			for (const line of review.usage) u.createDiv({ text: line });
		}
	}

	/** Update the Apply button's count without a full re-render (keeps scroll position). */
	private updateApplyButton(): void {
		const review = this.review();
		const btn = this.applyBtn;
		if (!btn || !review?.result) return;
		const ticked = [...review.result.findings, ...review.result.typos].filter((x) => {
			const st = review.items.get(x.id);
			return st?.status === 'open' && st.checked;
		}).length;
		btn.setText(`Apply selected (${ticked})`);
		btn.disabled = ticked === 0 || review.busy;
	}

	private renderEdits(parent: HTMLElement, edits: ProposedEdit[]): void {
		if (!edits.length) return;
		const box = parent.createDiv({ cls: 'note-check-edits' });
		// Render both sides as Markdown so LaTeX displays as equations. Fragments that cut into an
		// equation are widened to the whole equation using the live note; the raw text is the tooltip.
		for (const e of edits) {
			const preview = this.liveText !== null ? previewEdit(this.liveText, e) : null;
			const before = preview?.before ?? e.find;
			const after = preview?.after ?? e.replace;
			const renderable = mathBalanced(before) && mathBalanced(after);
			const del = box.createDiv({ cls: 'note-check-del', attr: { title: e.find } });
			const ins = box.createDiv({ cls: 'note-check-ins', attr: { title: e.replace } });
			if (renderable) {
				this.md(del, before);
				this.md(ins, after);
			} else {
				del.addClass('is-raw');
				ins.addClass('is-raw');
				del.setText(before);
				ins.setText(after);
			}
		}
	}

	private renderCheckbox(
		parent: HTMLElement,
		label: string,
		state: ItemState,
		enabled: boolean,
	): void {
		const row = parent.createEl('label', { cls: 'note-check-tick' });
		const cb = row.createEl('input', { type: 'checkbox' });
		cb.checked = state.checked;
		cb.disabled = !enabled;
		row.appendText(` ${label}`);
		cb.addEventListener('change', () => {
			state.checked = cb.checked;
			this.updateApplyButton();
		});
	}

	private renderTypo(
		parent: HTMLElement,
		t: Typo,
		review: NoteReview,
		anchor: string | null,
	): void {
		const st = review.items.get(t.id);
		if (!st) return;
		const card = parent.createDiv({
			cls: 'note-check-card note-check-typo',
			attr: { 'data-quote': t.quote },
		});
		this.wireHighlight(card, t.quote);
		const head = card.createDiv({ cls: 'note-check-card-head' });
		this.renderCheckbox(head, '', st, t.edits.length > 0);
		const q = head.createEl('a', { cls: 'note-check-quote', text: t.quote });
		q.addEventListener('click', () => this.jumpTo(t.quote));
		if (anchor) head.createSpan({ cls: 'note-check-tag', text: anchor });
		this.renderEdits(card, t.edits);
		if (st.message) card.createDiv({ cls: 'note-check-error', text: st.message });
	}

	private renderFinding(
		parent: HTMLElement,
		f: Finding,
		review: NoteReview,
		anchor: string | null,
	): void {
		const st = review.items.get(f.id);
		if (!st) return;
		const card = parent.createDiv({ cls: 'note-check-card', attr: { 'data-quote': f.quote } });
		this.wireHighlight(card, f.quote);
		const head = card.createDiv({ cls: 'note-check-card-head' });
		head.createSpan({ cls: `note-check-badge sev-${f.severity.toLowerCase()}`, text: f.severity });
		if (f.heading) head.createSpan({ cls: 'note-check-heading', text: f.heading });
		if (anchor) head.createSpan({ cls: 'note-check-tag', text: anchor });

		const q = card.createEl('a', { cls: 'note-check-quote', text: f.quote });
		q.addEventListener('click', () => this.jumpTo(f.quote));

		this.md(card.createDiv({ cls: 'note-check-problem' }), `**Problem:** ${f.problem}`);
		this.md(card.createDiv({ cls: 'note-check-suggestion' }), `**Suggestion:** ${f.suggestion}`);
		const edits = st.customEdits ?? f.edits;
		this.renderEdits(card, edits);

		const actions = card.createDiv({ cls: 'note-check-actions' });
		this.renderCheckbox(
			actions,
			st.customEdits ? 'Apply my version' : 'Fix with recommendation',
			st,
			edits.length > 0 && !st.busy,
		);
		const ignoreBtn = actions.createEl('button', { text: 'Ignore' });
		ignoreBtn.addEventListener('click', () => void this.ignore(f));
		// eslint-disable-next-line obsidianmd/ui/sentence-case -- ClaudeCheck and JE: are literal names used in the notes
		const jeBtn = actions.createEl('button', { text: 'Make JE: line' });
		jeBtn.addEventListener('click', () => void this.makeJeLine(f));

		for (const entry of st.thread) {
			const bubble = card.createDiv({ cls: `note-check-msg note-check-msg-${entry.role}` });
			if (entry.role === 'claude') this.md(bubble, entry.text);
			else bubble.setText(entry.text);
		}

		const input = card.createEl('textarea', {
			cls: 'note-check-input',
			attr: { placeholder: 'Your change, or a question…', rows: '2' },
		});
		input.value = st.draft;
		input.disabled = st.busy;
		input.addEventListener('input', () => {
			st.draft = input.value;
		});
		const row = card.createDiv({ cls: 'note-check-actions' });
		const askBtn = row.createEl('button', { text: st.busy ? 'Working…' : 'Ask' });
		askBtn.disabled = st.busy;
		askBtn.addEventListener('click', () => void this.ask(f, 'ask'));
		const reviseBtn = row.createEl('button', { text: 'Apply my version' });
		reviseBtn.disabled = st.busy;
		reviseBtn.addEventListener('click', () => void this.ask(f, 'revise'));

		if (st.message) card.createDiv({ cls: 'note-check-error', text: st.message });
	}
}
