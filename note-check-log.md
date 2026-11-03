# note-check log

Post-build changes (no UpdateNNN.md file exists yet for this project).

## 2026-11-02 22:25 — v1.0.1: render edit previews as equations

**Prompt:** "the plugin is fantastic, thanks. one question: can you render the equations in red and green text?" (with a screenshot showing raw LaTeX in the red/green −/+ edit preview).

**Change:** the −/+ edit preview in each card was plain monospace text, so LaTeX like `$\hat\sigma^2$` showed raw. Both sides now go through Obsidian's Markdown renderer (equations, bold and italics display), keeping red for the removed text and green for the replacement. Each side has a coloured left bar and a −/+ marker, and hovering shows the raw text. Version 1.0.0 → 1.0.1. Lint clean, 35/35 tests pass, build OK. Deployed (files copied) to VaultSchar, but the plugin was not reloaded because a review with 7 open findings was in progress; it takes effect on the next plugin reload or Obsidian restart.

| # | Issue | Fix |
|---|---|---|
| 1 | Equations in the red/green edit preview showed as raw LaTeX | `renderEdits` in `src/view.ts` renders each side with `MarkdownRenderer`; CSS in `styles.css` keeps red/green (including MathJax, bold, italics), adds a coloured left bar and −/+ markers; raw text in the hover tooltip |
