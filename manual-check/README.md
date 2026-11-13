# Manual diff harness

Local-only helpers for pre-release manual testing. They are **not** part of the
extension package and are not run by `npm t`.

From the repository root:

```bash
npm run build-test
npm run build-preview

# 32 real AsciiDoc pairs, converted with the preview converter, rendered in
# Chromium; writes report.json, html/ and screens/.
node manual-check/run.mjs

# Interactive checks (12 hunks, showStats, align=false, non-visual, table row,
# collapsed deletion, link, restore, busy, TOC-only status).
node manual-check/interactions.mjs

# Runs the real preview scripts (highlight.js, Mermaid, PlantUML) through a
# local HTTP route; needs Google Chrome (Playwright channel 'chrome').
node manual-check/real-render.mjs
```

Set `SCENARIO=<name>` for a single scenario in `run.mjs`, for example:

```bash
SCENARIO=sections-reordered node manual-check/run.mjs
```
