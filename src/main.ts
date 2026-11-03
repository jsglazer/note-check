import { MarkdownView, Notice, Plugin, type WorkspaceLeaf } from 'obsidian';
import { reviewHighlightExtension } from './cm-highlight';
import { DEFAULT_SETTINGS, NoteCheckSettingTab, type NoteCheckSettings } from './settings';
import { NoteCheckView, VIEW_TYPE_NOTE_CHECK, type NoteReview } from './view';

export default class NoteCheckPlugin extends Plugin {
	settings: NoteCheckSettings = { ...DEFAULT_SETTINGS, ignored: {} };
	/** Review state per note path, kept for the session. */
	readonly reviews = new Map<string, NoteReview>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.registerEditorExtension(reviewHighlightExtension);
		this.registerView(VIEW_TYPE_NOTE_CHECK, (leaf) => new NoteCheckView(leaf, this));
		this.addRibbonIcon(
			'book-open-check',
			'Review current note',
			() => void this.reviewActiveNote(),
		);
		this.addCommand({
			id: 'review-current-note',
			name: 'Review current note',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
				if (!file) return false;
				if (!checking) void this.reviewActiveNote();
				return true;
			},
		});
		this.addCommand({
			id: 'open-review-pane',
			name: 'Open review pane',
			callback: () => void this.revealView(),
		});
		this.addSettingTab(new NoteCheckSettingTab(this.app, this));
	}

	onunload(): void {
		this.reviews.clear();
	}

	private async revealView(): Promise<NoteCheckView | null> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_NOTE_CHECK)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return null;
			await leaf.setViewState({ type: VIEW_TYPE_NOTE_CHECK, active: true });
		}
		await workspace.revealLeaf(leaf);
		return leaf.view instanceof NoteCheckView ? leaf.view : null;
	}

	private async reviewActiveNote(): Promise<void> {
		const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		if (!file) {
			new Notice('Open a Markdown note first.');
			return;
		}
		const view = await this.revealView();
		if (view) await view.startReview(file.path);
	}

	async loadSettings(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as Partial<NoteCheckSettings>;
		this.settings = { ...DEFAULT_SETTINGS, ...data, ignored: { ...(data.ignored ?? {}) } };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
