# Manual diff harness

Local-only helpers for pre-release manual testing. They are **not** part of the
extension package and are not run by `npm t`.

From the repository root:

```bash
npm run build-test
npm run build-preview

# 111 real AsciiDoc pairs, converted with the preview converter, rendered in
# Chromium; writes report.json, html/ and screens/. The table-row scenarios
# cover rows added at the end/top/middle, a header row added or removed,
# simultaneous additions and removals (including a taller removed row), a row
# inserted before a footer, nested tables, column additions/removals in top-level
# and nested tables, simultaneous row and column additions/removals, and
# hierarchical lists (children, grandchildren, dedent, mixed levels, lists in
# table cells), long pretty and minified JSON objects (key/value/structure
# changes), ordinary text blocks (word/sentence/punctuation/formatting changes,
# paragraph add/split), whole sections (add/remove at the top/middle/end, nested
# sections, rename, duplicate titles, reorder, TOC), their swapped variants, and
# the editor style's zebra striping on both inserted and removed rows.
node manual-check/run.mjs

# Interactive checks (12 hunks, showStats, align=false, non-visual, table row,
# collapsed deletion, link, restore, busy, TOC-only status).
node manual-check/interactions.mjs

# Runs the real preview scripts (highlight.js, Mermaid, PlantUML) through a
# local HTTP route; needs Google Chrome (Playwright channel 'chrome'). Includes
# PlantUML source changes (label/message, comment-only, whitespace-only,
# add/remove, syntax error) and fails if the engine or the pane alignment breaks.
node manual-check/real-render.mjs
```

Set `SCENARIO=<name>` for a single scenario in `run.mjs`, for example:

```bash
SCENARIO=sections-reordered node manual-check/run.mjs
```
