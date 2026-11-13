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
}

function previewDoc(body: string, options: PreviewOptions = {}): string {
  const base = options.base ?? 'https://host/docs/index.adoc'
  const nonce = options.nonce ?? 'abc'
  const bodyClasses = options.bodyClasses ?? 'vscode-body article'
  return `<!DOCTYPE html><html style="--asciidoc-font-size: 16px;"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' https:; style-src 'unsafe-inline'"><base href="${base}"><link rel="stylesheet" href="/ext/media/asciidoctor-editor.css">${options.head ?? ''}<script src="/ext/dist/pre.js" nonce="${nonce}"></script></head><body class="${bodyClasses}" data-preview-style="vscode"><div id="preview-root">${body}</div><script async src="/ext/dist/index.js" nonce="${nonce}"></script><script>window.__asciidocRenderMermaid = function () {};</script>${options.trailing ?? ''}</body></html>`
}

const strings = {
  rendering: 'Rendering…',
  noDifferences: 'No differences',
  error: 'Unable to render the diff',
  old: 'old',
  new: 'new',
  swap: 'Swap',
}

function build(
  leftBody: string,
  rightBody: string,
  leftOptions: PreviewOptions = {},
  rightOptions: PreviewOptions = {},
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
