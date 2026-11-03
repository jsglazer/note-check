# note-check log

Post-build changes (no UpdateNNN.md file exists yet for this project).

## 2026-11-02 22:25 — v1.0.1: render edit previews as equations

**Prompt:** "the plugin is fantastic, thanks. one question: can you render the equations in red and green text?" (with a screenshot showing raw LaTeX in the red/green −/+ edit preview).

**Change:** the −/+ edit preview in each card was plain monospace text, so LaTeX like `$\hat\sigma^2$` showed raw. Both sides now go through Obsidian's Markdown renderer (equations, bold and italics display), keeping red for the removed text and green for the replacement. Each side has a coloured left bar and a −/+ marker, and hovering shows the raw text. Version 1.0.0 → 1.0.1. Lint clean, 35/35 tests pass, build OK. Deployed (files copied) to VaultSchar, but the plugin was not reloaded because a review with 7 open findings was in progress; it takes effect on the next plugin reload or Obsidian restart.

| # | Issue | Fix |
|---|---|---|
| 1 | Equations in the red/green edit preview showed as raw LaTeX | `renderEdits` in `src/view.ts` renders each side with `MarkdownRenderer`; CSS in `styles.css` keeps red/green (including MathJax, bold, italics), adds a coloured left bar and −/+ markers; raw text in the hover tooltip |

### Summary

Yes. The red/green box now renders as Markdown, so equations display properly and keep their red (removed) or green (replacement) colour. Each side also gets a coloured bar with −/+, and hovering a line shows the raw text it came from. This is version 1.0.1 (lint clean, 35 tests pass), pushed to GitHub, and its files are already copied into VaultSchar. I didn't reload the plugin because you have a review open on "6.0.1 Small vs large sample results" with 7 findings, and reloading clears in-progress reviews. When you're done with that note, either restart Obsidian or tell me and I'll reload it. Your next review will then show rendered equations.

## 2026-11-02 22:45 — v1.0.2: larger text, jump below target, note sync, equation previews, no scroll jump

**Prompt:**
- make text 25% larger
- when clicking linked text go to line BELOW actual target so that target line is not highlighted
- can you add a setting (default ON) to auto-scroll the note so it stays synced with the review panel
- some diff text still isn't rendering: (screenshot: red/green preview showing raw `$\log(\text{price}) = 12.32` and `$\widehat{\log(\text{price})} = 12.32`)
- when I click the Fix checkbox, the panel jumps up toward the top; the farther I go down the list, the more it jumps

**Changes:** Version 1.0.1 → 1.0.2. Lint clean, 43/43 tests pass (8 new), build OK. Deployed to VaultSchar and reloaded; I checked first that no review had open items (the three reviews in memory were already stamped). Running version confirmed as 1.0.2 with `autoScroll` true.

| # | Issue | Fix |
|---|---|---|
| 1 | Panel text too small | `.note-check` root is `font-size: 125%`; every inner size is now in `em` relative to it (buttons, select, textarea and checkbox labels included), so everything scales together |
| 2 | Clicking a quote selected and highlighted the target text | `jumpTo` puts the cursor at the start of the line below the target (new pure `lineBelow` in `src/core/preview.ts`, clamped at the last line) and still centres the target in view |
| 3 | No way to keep the note aligned with the panel | New setting **Keep note in sync with panel** (default on). Scrolling the panel scrolls the note to the finding at the top of the panel; cursor and focus stay put, and the synced card gets an accent border. Cards carry `data-quote`; the scroll handler is debounced (150 ms) and registered with `registerDomEvent` |
| 4 | Some previews still showed raw LaTeX: the edit's `find` text cut into the middle of an equation, leaving an unpaired `$` | New pure `previewEdit` widens the preview, within its line, to every math span it cuts into (adding … where it is trimmed), then applies the replacement inside that widened text. If it still can't be balanced (`mathBalanced`), it falls back to raw monospace instead of half-rendered output. Tests cover the exact screenshot case, multiple cut equations, escaped `\$`, and edits that can't be found |
| 5 | Ticking a checkbox made the panel jump up, more the further down you were | Ticking no longer re-renders the panel; it only updates the **Apply selected (n)** count. Full re-renders (Ignore, Apply, editor edits) now keep the scroll position by holding the panel's previous height until the async Markdown/MathJax rendering finishes, then restoring `scrollTop` |
