# Note Check

An Obsidian plugin that reviews a study note for technical errors with Claude and shows the results in a right-sidebar pane, on desktop and iOS.

## What it does

- **Review current note** (command or ribbon icon) sends the note and your review rules to Claude and lists findings by severity (High / Med / Low), plus a separate group of typo fixes.
- Findings render as Markdown, so equations and callouts display properly.
- Each finding is tied to the exact text it quotes, not a line number. Click the quote to jump to it in the editor. If you change that text, the card is marked "changed — recheck".
- Tick **Fix with recommendation** (typos are pre-ticked), then **Apply selected**. The plugin applies the edits itself in one undoable change. Claude never rewrites the file.
- Edits are refused if they would touch the frontmatter, a `JE: ` line, or anything below a `DO NOT EDIT` heading, or if their target text is missing or appears more than once.
- Per finding: **Ignore**, **Make JE: line**, **Ask** (a question, answered in the card), and **Apply my version** (Claude turns your instruction into edits for you to approve).
- **Check** mode passes when nothing is left open; **Recheck** mode passes when no High findings remain. Then **Stamp ClaudeCheck** writes `ClaudeCheck: YYYY-MM-DD HH:MM:SS` to the frontmatter.

## Settings

- **Anthropic API key**: stored in Obsidian's keychain (SecretStorage). Only the secret's name is saved in the plugin's `data.json`.
- **Model**: Claude Opus 5.5 by default; Sonnet 5.5, Fable 5.1 or Haiku 5.5 can be selected.
- **Effort**: thinking effort (default High).
- **Rules note**: vault path of the review rules (default `Classes/Note Review Rules.md`); built-in rules are used if it is missing.
- **Recheck after applying** and **Stamp automatically**: both off by default.

## Development

```bash
npm install
npm test        # Vitest, headless core tests
npm run lint
npm run build   # typecheck + esbuild → main.js
```

Pure logic (quote anchoring, protected regions, edit planning, response parsing, prompts, pass rule, fetch adapter) lives in `src/core/` and imports nothing from `obsidian` or the Anthropic SDK. All network calls go through Obsidian's `requestUrl`.

## License

MIT
