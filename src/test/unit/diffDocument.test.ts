import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildDiffDocument,
  type DiffDocumentOptions,
} from '../../features/diff/diffDocument.js'
import { renderDiff } from '../../features/diff/renderDiff.js'

interface PreviewOptions {
  base?: string
  nonce?: string
  head?: string
  trailing?: string
  bodyClasses?: string
  /** `data-shell` fingerprint of the preview, when the fixture has one. */
  shell?: string
}

function previewDoc(body: string, options: PreviewOptions = {}): string {
  const base = options.base ?? 'https://host/docs/index.adoc'
  const nonce = options.nonce ?? 'abc'
  const bodyClasses = options.bodyClasses ?? 'vscode-body article'
  const shell =
    options.shell !== undefined ? ` data-shell="${options.shell}"` : ''
  return `<!DOCTYPE html><html style="--asciidoc-font-size: 16px;"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' https:; style-src 'unsafe-inline'"><base href="${base}"><link rel="stylesheet" href="/ext/media/asciidoctor-editor.css">${options.head ?? ''}<script src="/ext/dist/pre.js" nonce="${nonce}"></script></head><body class="${bodyClasses}"${shell} data-preview-style="vscode"><div id="preview-root">${body}</div><script async src="/ext/dist/index.js" nonce="${nonce}"></script><script>window.__asciidocRenderMermaid = function () {};</script>${options.trailing ?? ''}</body></html>`
}

const strings = {
  rendering: 'Rendering…',
  noDifferences: 'No differences',
  noVisualDifferences: 'No visual text differences',
  statusNonVisualSummary: '{0} changes',
  statusNonVisualSummaryOne: '1 change',
  statusNavigationSummary: '{0} navigation changes',
  statusNavigationSummaryOne: '1 navigation change',
  navigationChanged: 'Table of contents changed',
  error: 'Unable to render the diff',
  old: 'old',
  new: 'new',
  swap: 'Swap',
  nonVisualFormatting: 'Formatting was changed here',
  nonVisualLink: 'Link target was changed here',
  nonVisualId: 'Anchor id was changed here',
  blockChanged: 'Changed block',
  mediaChanged: 'Changed image or diagram',
  shellDiffers:
    'The documents use different preview shells; some styles may not match.',
  statusSummary: '{0} change regions · +{1} added blocks · −{2} removed blocks',
  statusNonVisual: '{0} formatting / {1} link / {2} id changes',
  statusJump: 'Click for the next change, Shift+click for the previous',
  collapseExpand: 'Click to expand deleted block',
  collapseCollapse: 'Click to collapse deleted block',
  collapseLabel: '{0} lines',
  collapseLabelWithExcerpt: '{0} lines · {1}',
  gapAddedBlocks: '{0} added blocks',
  gapAddedTable: '{0} added table rows',
  gapAddedLines: '{0} added lines',
  gapRemovedBlocks: '{0} removed blocks',
  gapRemovedTable: '{0} removed table rows',
  gapRemovedLines: '{0} removed lines',
  gapChangedBlocks: '{0} changed blocks',
  gapChangedTable: '{0} changed table rows',
  gapChangedLines: '{0} changed lines',
  gapAddedBlock: '1 added block',
  gapAddedTableRow: '1 added table row',
  gapAddedLine: '1 added line',
  gapRemovedBlock: '1 removed block',
  gapRemovedTableRow: '1 removed table row',
  gapRemovedLine: '1 removed line',
  gapChangedBlock: '1 changed block',
  gapChangedTableRow: '1 changed table row',
  gapChangedLine: '1 changed line',
}

function build(
  leftBody: string,
  rightBody: string,
  leftOptions: PreviewOptions = {},
  rightOptions: PreviewOptions = {},
  documentOptions: Partial<DiffDocumentOptions> = {},
): string {
  const result = renderDiff(
    previewDoc(leftBody, leftOptions),
    previewDoc(rightBody, rightOptions),
  )
  const options: DiffDocumentOptions = {
    leftHtml: result.leftHtml,
    rightHtml: result.rightHtml,
    diffScriptUri: '/ext/dist/diff.js',
    diffCssUri: '/ext/media/diff.css',
    diffContentCss: '.adoc-diff-word{}',
    leftTitle: 'old.adoc',
    rightTitle: 'new.adoc',
    strings,
    lineMap: result.lineMap,
    leftLineCount: result.leftLineCount,
    rightLineCount: result.rightLineCount,
    version: 1,
    stats: result.stats,
    ...documentOptions,
  }
  return buildDiffDocument(options)
}

function pane(html: string, side: 'left' | 'right'): string {
  const startMarker = `<div id="diff-${side}" class="diff-pane">`
  const start = html.indexOf(startMarker)
  if (start < 0) {
    return ''
  }
  const endMarker =
    side === 'left' ? '<div id="diff-right" class="diff-pane">' : '</main>'
  const end = html.indexOf(endMarker, start + startMarker.length)
  return html.slice(start + startMarker.length, end < 0 ? undefined : end)
}

describe('buildDiffDocument', () => {
  test('puts both previews into their own panes', () => {
    const html = build(
      '<p class="data-line-1">Hello world</p>',
      '<p class="data-line-1">Hello AsciiDoc</p>',
    )
    assert.match(html, /<div id="diff-left" class="diff-pane">/)
    assert.match(html, /<div id="diff-right" class="diff-pane">/)
    assert.equal((html.match(/id="preview-root"/g) ?? []).length, 2)
    assert.match(html, /adoc-diff-word adoc-diff-word-del/)
    assert.match(html, /adoc-diff-word adoc-diff-word-ins/)
  })

  test('keeps the preview head and trailing scripts', () => {
    const html = build(
      '<p class="data-line-1">A</p>',
      '<p class="data-line-1">B</p>',
    )
    assert.match(html, /\/ext\/media\/asciidoctor-editor\.css/)
    assert.match(html, /__asciidocRenderMermaid/)
    assert.match(html, /Content-Security-Policy/)
  })

  test('drops the single-preview client script', () => {
    const html = build(
      '<p class="data-line-1">A</p>',
      '<p class="data-line-1">B</p>',
    )
    assert.doesNotMatch(html, /dist\/index\.js/)
  })

  test('adds the diff stylesheet, content rules and client script', () => {
    const html = build(
      '<p class="data-line-1">A</p>',
      '<p class="data-line-1">B</p>',
    )
    assert.match(html, /href="\/ext\/media\/diff\.css"/)
    assert.match(html, /\.adoc-diff-word\{\}/)
    assert.match(html, /src="\/ext\/dist\/diff\.js"/)
  })

  test('carries the body classes, the theme style and the settings', () => {
    const html = build(
      '<p class="data-line-1">A</p>',
      '<p class="data-line-1">B</p>',
    )
    assert.match(html, /<html style="--asciidoc-font-size: 16px;">/)
    assert.match(html, /<body class="vscode-body article diff-body"/)
    assert.match(html, /data-preview-style="vscode"/)
    assert.match(html, /id="vscode-asciidoc-diff-data"/)
    assert.match(html, /diff-left-title/)
  })

  test('adds a swap button to the header', () => {
    const html = build(
      '<p class="data-line-1">A</p>',
      '<p class="data-line-1">B</p>',
    )
    assert.match(html, /id="diff-swap"/)
    assert.match(html, /⇄/)
    assert.match(html, /Swap/)
  })

  test('warns when the two previews use different document shells', () => {
    const html = build(
      '<p class="data-line-1">A</p>',
      '<p class="data-line-1">B</p>',
      { bodyClasses: 'vscode-body book toc2 toc-left' },
      { bodyClasses: 'vscode-body article' },
    )
    assert.match(html, /id="diff-shell-warning"/)
    assert.match(html, /different preview shells/)
    // The left shell still drives the combined body: one `<body>` only.
    assert.match(html, /<body class="vscode-body book toc2 toc-left diff-body"/)
  })

  test('does not warn when both previews share the same shell', () => {
    const html = build(
      '<p class="data-line-1">A</p>',
      '<p class="data-line-1">B</p>',
      { bodyClasses: 'vscode-body book toc2' },
      { bodyClasses: 'vscode-body book toc2' },
    )
    assert.doesNotMatch(html, /id="diff-shell-warning"/)
  })

  test('compares shells by fingerprint and ignores content hashes', () => {
    const html = build(
      '<p class="data-line-1">A</p>',
      '<p class="data-line-1">B</p>',
      { shell: 'shell-a', bodyClasses: 'vscode-body article data-h-abc123' },
      { shell: 'shell-a', bodyClasses: 'vscode-body article data-h-def456' },
    )
    assert.doesNotMatch(html, /id="diff-shell-warning"/)

    const different = build(
      '<p class="data-line-1">A</p>',
      '<p class="data-line-1">B</p>',
      { shell: 'shell-a' },
      { shell: 'shell-b' },
    )
    assert.match(different, /id="diff-shell-warning"/)
  })

  test('reports a clean status when there are no differences', () => {
    const same = '<p class="data-line-1">Same</p>'
    const html = build(same, same)
    assert.match(html, /diff-status diff-status-clean/)
    assert.match(html, /No differences/)
  })

  test('adds the right document trailing scripts and allows their nonce', () => {
    const html = build(
      '<p>A</p>',
      '<p>B</p>',
      { nonce: 'leftnonce' },
      {
        nonce: 'rightnonce',
        trailing:
          '<script nonce="rightnonce">window.MathJax = {}</script><script src="/ext/media/mathjax/mathjax.js" nonce="rightnonce"></script>',
      },
    )
    assert.match(html, /window\.MathJax = \{\}/)
    assert.match(html, /mathjax\.js/)
    assert.match(html, /'nonce-rightnonce'/)
  })

  test('does not duplicate identical trailing scripts', () => {
    const mathjax =
      '<script nonce="abc">window.MathJax = {}</script><script src="/ext/media/mathjax/mathjax.js" nonce="abc"></script>'
    const html = build(
      '<p>A</p>',
      '<p>B</p>',
      { trailing: mathjax },
      { trailing: mathjax },
    )
    assert.equal((html.match(/window\.MathJax = \{\}/g) ?? []).length, 1)
    assert.equal((html.match(/mathjax\.js/g) ?? []).length, 1)
  })

  test('resolves each pane relative URLs against its own base', () => {
    const html = build(
      '<img src="pic.png"><p>A</p>',
      '<img src="pic.png"><p>B</p>',
      { base: 'https://host/docs-a/index.adoc' },
      { base: 'https://host/docs-b/index.adoc' },
    )
    assert.match(pane(html, 'left'), /src="https:\/\/host\/docs-a\/pic\.png"/)
    assert.match(pane(html, 'right'), /src="https:\/\/host\/docs-b\/pic\.png"/)
  })

  test('keeps a relative link target for the host to resolve', () => {
    const html = build(
      '<p><a href="guide.adoc#intro">Guide</a><img src="pic.png"></p>',
      '<p>B</p>',
      { base: 'https://host/docs-a/index.adoc' },
    )
    // The image is resolved against the pane's base...
    assert.match(pane(html, 'left'), /src="https:\/\/host\/docs-a\/pic\.png"/)
    // ...but the link target stays relative: the host resolves it against the
    // clicked pane's source document.
    assert.match(pane(html, 'left'), /href="guide\.adoc#intro"/)
  })

  test('keeps absolute and fragment URLs untouched', () => {
    const html = build(
      '<img src="https://cdn.example.com/a.png"><a href="#section">x</a><p>A</p>',
      '<p>B</p>',
    )
    assert.match(
      pane(html, 'left'),
      /src="https:\/\/cdn\.example\.com\/a\.png"/,
    )
    assert.match(pane(html, 'left'), /href="#section"/)
  })
})

describe('buildDiffDocument status and state', () => {
  test('does not claim "No differences" when only formatting changed', () => {
    const html = build(
      '<p class="data-line-1"><strong>same text</strong></p>',
      '<p class="data-line-1"><em>same text</em></p>',
    )
    assert.doesNotMatch(html, /diff-status diff-status-clean/)
    assert.doesNotMatch(html, />No differences</)
    // The client turns this into "No visual differences" with the detail in the
    // tooltip; the document must not pre-render the misleading clean status.
    assert.match(html, /id="diff-status" class="diff-status"/)
  })

  test('does not claim "No differences" when only the TOC changed', () => {
    const withToc = (entry: string) =>
      `<div id="header"><h1>Manual</h1><div id="toc" class="toc2"><div id="toctitle">Table of Contents</div><ul><li><a href="#_one">${entry}</a></li></ul></div></div><div id="content"><p>A</p></div>`
    const html = build(withToc('Old heading'), withToc('New heading'))
    assert.doesNotMatch(html, /diff-status diff-status-clean/)
    assert.doesNotMatch(html, />No differences</)
    const settings = decodeSettings(html)
    assert.equal(settings.stats.changes, 0)
    assert.equal(settings.stats.navigationChanges, 1)
    // The TOC is compared, but it is not rendered: it would reserve a pinned
    // column in each pane. The status still reports the navigation change.
    assert.doesNotMatch(html, /id="toc"/)
    assert.doesNotMatch(html, /data-adoc-diff-navigation/)
  })

  test('puts the hunk count and the restore state into the settings', () => {
    const html = build(
      '<p class="data-line-1">A</p><p class="data-line-2">old</p>',
      '<p class="data-line-1">A</p><p class="data-line-2">new</p>',
      {},
      {},
      {
        leftLine: 2,
        rightLine: 2,
        expanded: ['12:abc'],
      },
    )
    const settings = decodeSettings(html)
    assert.equal(settings.stats.changes, 1)
    assert.equal(settings.leftLine, 2)
    assert.equal(settings.rightLine, 2)
    assert.deepEqual(settings.expanded, ['12:abc'])
    assert.equal(
      settings.strings.noVisualDifferences,
      'No visual text differences',
    )
    assert.equal(settings.strings.gapAddedLines, '{0} added lines')
  })

  test('shows the full path of each side in a tooltip when the basenames collide', () => {
    const html = build(
      '<p>A</p>',
      '<p>B</p>',
      {},
      {},
      {
        leftTitle: 'v1/index.adoc',
        rightTitle: 'v2/index.adoc',
        leftTitleTooltip: '/workspace/v1/index.adoc',
        rightTitleTooltip: '/workspace/v2/index.adoc',
      },
    )
    assert.match(
      html,
      /id="diff-left-title"[^>]*title="\/workspace\/v1\/index\.adoc"/,
    )
    assert.match(
      html,
      /id="diff-right-title"[^>]*title="\/workspace\/v2\/index\.adoc"/,
    )
    assert.match(html, />v1\/index\.adoc</)
    assert.match(html, />v2\/index\.adoc</)
  })
})

interface DocumentSettings {
  stats: {
    changes: number
    visualChanges: number
    nonVisualChanges: number
    navigationChanges: number
  }
  leftLine?: number
  rightLine?: number
  expanded: string[]
  strings: Record<string, string>
}

function decodeSettings(html: string): DocumentSettings {
  const match = /id="vscode-asciidoc-diff-data" data-settings="([^"]*)"/.exec(
    html,
  )
  assert.ok(match)
  const decoded = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
  return JSON.parse(decoded) as DocumentSettings
}
