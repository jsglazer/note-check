import { App, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import type NoteCheckPlugin from './main';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface NoteCheckSettings {
	/** Name of the secret in Obsidian's SecretStorage that holds the API key (never the key itself). */
	apiKeySecret: string;
	model: string;
	effort: Effort;
	rulesPath: string;
	autoRecheck: boolean;
	autoStamp: boolean;
	/** Scroll the note to follow the card at the top of the review panel. */
	autoScroll: boolean;
	/** Ignored-finding fingerprints per note path. */
	ignored: Record<string, string[]>;
}

export const DEFAULT_SETTINGS: NoteCheckSettings = {
	apiKeySecret: 'anthropic-api-key',
	model: 'claude-opus-5-5',
	effort: 'high',
	rulesPath: 'Classes/Note Review Rules.md',
	autoRecheck: false,
	autoStamp: false,
	autoScroll: true,
	ignored: {},
};

const MODELS: Record<string, string> = {
	'claude-opus-5-5': 'Claude Opus 5.5 (default)',
	'claude-sonnet-5-5': 'Claude Sonnet 5.5',
	'claude-fable-5-1': 'Claude Fable 5.1',
	'claude-haiku-5-5': 'Claude Haiku 5.5',
};

const EFFORTS: Record<Effort, string> = {
	low: 'Low',
	medium: 'Medium',
	high: 'High (default)',
	xhigh: 'Extra high',
	max: 'Max',
};

export class NoteCheckSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: NoteCheckPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;

		new Setting(containerEl)
			.setName('Anthropic API key')
			.setDesc(
				"Pick or create a secret in Obsidian's keychain. Only the secret's name is saved in the plugin settings; the key itself never is.",
			)
			.addComponent((el) =>
				new SecretComponent(this.app, el).setValue(s.apiKeySecret).onChange(async (value) => {
					s.apiKeySecret = value ?? '';
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Model')
			.setDesc('Claude model used for reviews and follow-up questions.')
			.addDropdown((d) => {
				for (const [id, label] of Object.entries(MODELS)) d.addOption(id, label);
				if (!(s.model in MODELS)) d.addOption(s.model, s.model);
				d.setValue(s.model).onChange(async (value) => {
					s.model = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Effort')
			.setDesc('How hard the model thinks. Higher is more thorough, slower and costs more.')
			.addDropdown((d) => {
				for (const [id, label] of Object.entries(EFFORTS)) d.addOption(id, label);
				d.setValue(s.effort).onChange(async (value) => {
					s.effort = value as Effort;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Rules note')
			.setDesc(
				'Vault path of the note that holds the review rules. Built-in rules are used if it is missing.',
			)
			.addText((t) =>
				t
					.setPlaceholder(DEFAULT_SETTINGS.rulesPath)
					.setValue(s.rulesPath)
					.onChange(async (value) => {
						s.rulesPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Keep note in sync with panel')
			.setDesc(
				'As you scroll the review panel, scroll the note to the finding at the top of the panel.',
			)
			.addToggle((t) =>
				t.setValue(s.autoScroll).onChange(async (value) => {
					s.autoScroll = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Recheck after applying')
			.setDesc('Run a recheck automatically after applying selected fixes.')
			.addToggle((t) =>
				t.setValue(s.autoRecheck).onChange(async (value) => {
					s.autoRecheck = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Stamp automatically')
			.setDesc(
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- ClaudeCheck is the literal frontmatter field name
				'Write the ClaudeCheck timestamp as soon as the note passes, without pressing the stamp button.',
			)
			.addToggle((t) =>
				t.setValue(s.autoStamp).onChange(async (value) => {
					s.autoStamp = value;
					await this.plugin.saveSettings();
				}),
			);
	}
}
