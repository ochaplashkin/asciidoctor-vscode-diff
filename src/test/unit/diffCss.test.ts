import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { describe, test } from 'node:test'

/**
 * The kernel and the client both rely on CSS rules that turn a marker class
 * into something visible. A class without a rule is the "change exists but
 * cannot be seen" bug: these tests guard the stylesheet, not the DOM.
 */
const contentCss = readFileSync(
  path.join(process.cwd(), 'media', 'diff-content.css'),
  'utf8',
)
const layoutCss = readFileSync(
  path.join(process.cwd(), 'media', 'diff.css'),
  'utf8',
)

describe('diff stylesheets', () => {
  test('a changed block is marked with a left icon, not a colored strip', () => {
    assert.match(
      contentCss,
      /\[data-adoc-diff-icon\]::before\s*\{[^}]*content:\s*"~"/s,
    )
    assert.match(
      contentCss,
      /\[data-adoc-diff-icon\]::before\s*\{[^}]*left:\s*-20px/s,
    )
    assert.doesNotMatch(contentCss, /\.adoc-diff-block-changed::before/)
    assert.doesNotMatch(
      contentCss,
      /\.adoc-diff-block-changed\s*\{[^}]*box-shadow:\s*inset/s,
    )
  })

  test('the icon is only used where no word or code line marker exists', () => {
    // The kernel decides this per block; the stylesheet must not draw the icon
    // for every changed block, or it would compete with the word markers.
    assert.doesNotMatch(contentCss, /\.adoc-diff-block-changed::before/)
    assert.doesNotMatch(contentCss, /\.adoc-diff-media-changed::before/)
  })

  test('a changed media element uses the icon on its stable container', () => {
    assert.match(
      contentCss,
      /\[data-adoc-diff-icon\]::before[\s\S]*?content:\s*"~"/s,
    )
    assert.doesNotMatch(
      contentCss,
      /\.adoc-diff-media-changed\s*\{[^}]*outline:/s,
    )
  })

  test('a moved block has a visible strip', () => {
    assert.match(
      contentCss,
      /\.adoc-diff-moved\s*\{[^}]*box-shadow:\s*inset 2px 0 0/s,
    )
  })

  test('a different document shell is reported in the header', () => {
    assert.match(layoutCss, /\.diff-shell-warning\s*\{[^}]*cursor:\s*help/s)
  })

  test('a non-visual change has an icon that carries the tooltip', () => {
    assert.match(
      contentCss,
      /\[data-adoc-diff-nonvisual\]::after\s*\{[^}]*content:\s*"!"/s,
    )
  })

  test('a gap is drawn as a pane overlay, not on a preview pseudo-element', () => {
    assert.match(
      layoutCss,
      /\.adoc-diff-gap-overlay\s*\{[^}]*background:\s*var\(--adoc-diff-gap-tint/s,
    )
    assert.match(
      layoutCss,
      /\.adoc-diff-gap-overlay\s*\{[^}]*pointer-events:\s*none/s,
    )
    assert.doesNotMatch(contentCss, /\.adoc-diff-gap-top::before/)
    assert.doesNotMatch(contentCss, /\.adoc-diff-gap-bottom::after/)
  })

  test('a collapsed deletion renders its line count and excerpt', () => {
    assert.match(
      contentCss,
      /\.adoc-diff-collapsed:not\(\.adoc-diff-expanded\)::before\s*\{[^}]*content:\s*"− "\s*attr\(data-adoc-diff-collapse-label\)/s,
    )
  })

  test('the generated table of contents is not rendered or reserved', () => {
    // The TOC is removed from the diff document, so no pane padding and no
    // TOC badge remain in the stylesheets.
    assert.doesNotMatch(layoutCss, /diff-pane-with-toc/)
    assert.doesNotMatch(contentCss, /adoc-diff-navigation-changed/)
  })

  test('the status keeps its summary while busy and shows a pulse', () => {
    assert.match(layoutCss, /\.diff-status-busy::before\s*\{[^}]*animation:/s)
    assert.match(layoutCss, /\.diff-status-busy\s*\{[^}]*opacity:/s)
  })

  test('added and removed content keeps green/red while empty gaps are gray', () => {
    // The content on the side that has it keeps the familiar diff colors.
    assert.match(
      contentCss,
      /\.adoc-diff-block-ins\s*\{[^}]*--vscode-diffEditor-insertedLineBackground/s,
    )
    assert.match(
      contentCss,
      /\.adoc-diff-block-del\s*\{[^}]*--vscode-diffEditor-removedLineBackground/s,
    )
    // The space reserved on the other side is neutral, not a second copy of
    // the green/red highlight.
    assert.match(
      contentCss,
      /--adoc-diff-gap-neutral-tint:\s*rgba\(128, 128, 128,/,
    )
    assert.match(
      contentCss,
      /\.adoc-diff-gap-ins,\s*\.adoc-diff-gap-del\s*\{[^}]*--adoc-diff-gap-tint:\s*var\(--adoc-diff-gap-neutral-tint\)/s,
    )
    assert.match(
      contentCss,
      /\.adoc-diff-code-line-gap\s*\{[^}]*background:\s*var\(--adoc-diff-gap-neutral-tint\)/s,
    )
  })

  test('added and removed blocks are not distinguished by color alone', () => {
    assert.match(
      contentCss,
      /\.adoc-diff-block-del\s*\{[^}]*background-image:\s*repeating-linear-gradient/s,
    )
    assert.match(
      contentCss,
      /\.adoc-diff-block-ins\s*\{[^}]*background-image:\s*repeating-linear-gradient/s,
    )
  })
})
