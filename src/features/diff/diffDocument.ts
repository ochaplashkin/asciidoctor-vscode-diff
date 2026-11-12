/**
 * Assembles the side-by-side diff document.
 *
 * Both previews are rendered into the *same* webview document (the active
 * frame), one per scrollable pane, instead of into nested iframes. This is what
 * makes them reuse the exact preview rendering environment: the preview's
 * stylesheets, MathJax, Mermaid, PlantUML, images and custom styles are loaded
 * natively by the webview, and VS Code applies its theme to the document, so
 * nothing has to be copied or inlined.
 *
 * The two previews are not necessarily generated with the same features (for
 * example only the right one may add a formula, a diagram or a custom style), so
 * the document merges the two heads and the two sets of trailing scripts instead
 * of reusing the left one only. Relative resource URLs are resolved against each
 * document's own `<base>`, because the combined document can only have one
 * `<base>`.
 *
 * The preview client (`dist/index.js`) is removed: it expects a single
 * `#preview-root` and window scrolling, which this document does not have.
 *
 * This module is vscode-free.
 */

import type { DiffLineMapEntry, DiffStats } from './diffTypes.js'
import {
  type ChildNode,
  type Document,
  type Element,
  getAttribute,
  isElement,
  parse,
  serialize,
  serializeOuter,
  setAttribute,
} from './htmlTree.js'
import { findFirstElementByTag, findPreviewRoot } from './renderDiff.js'

export interface DiffDocumentStrings {
  readonly rendering: string
  readonly noDifferences: string
  readonly error: string
  readonly old: string
  readonly new: string
  readonly swap: string
}

export interface DiffDocumentOptions {
  /** Left preview HTML, with the diff markers already applied. */
  readonly leftHtml: string
  /** Right preview HTML, with the diff markers already applied. */
  readonly rightHtml: string
  readonly diffScriptUri: string
  readonly diffCssUri: string
  /** The `adoc-diff-*` highlight rules (`media/diff-content.css`). */
  readonly diffContentCss: string
  readonly leftTitle: string
  readonly rightTitle: string
  readonly strings: DiffDocumentStrings
  readonly lineMap: readonly DiffLineMapEntry[]
  readonly leftLineCount: number
  readonly rightLineCount: number
  /** Fraction of the scrollable range to restore after load (0..1). */
  readonly ratio?: number
  readonly version: number
  readonly stats: DiffStats
}

interface ParsedPreview {
  readonly doc: Document
  readonly root: Element
  readonly head: Element | undefined
  readonly body: Element | undefined
  readonly baseHref: string | undefined
  readonly nonce: string | undefined
}

export function buildDiffDocument(options: DiffDocumentOptions): string {
  const left = parsePreview(options.leftHtml)
  const right = parsePreview(options.rightHtml)

  // The right side's relative URLs must resolve against its own document, not
  // the left one (the combined document only keeps the left `<base>`).
  resolveRelativeUrls(left.root, left.baseHref)
  resolveRelativeUrls(right.root, right.baseHref)
  // Allow the scripts that come from the right document in the left CSP.
  allowNonceInCsp(left.head, right.nonce)

  const headHtml = serializeMergedHead(left, right)
  const htmlElement = findFirstElementByTag(left.doc, 'html')
  const htmlStyle = htmlElement ? getAttribute(htmlElement, 'style') : undefined
  const htmlStyleAttribute =
    htmlStyle !== undefined && htmlStyle !== ''
      ? ` style="${escapeAttribute(htmlStyle)}"`
      : ''
  const bodyClasses =
    (left.body ? getAttribute(left.body, 'class') : undefined) ?? ''
  const previewStyle = left.body
    ? getAttribute(left.body, 'data-preview-style')
    : undefined
  const trailingHtml = serializeMergedTrailing(left, right)

  const totalChanges =
    options.stats.addedBlocks +
    options.stats.removedBlocks +
    options.stats.changedBlocks +
    options.stats.changedTables
  const statusText =
    totalChanges === 0 ? escapeHtml(options.strings.noDifferences) : ''
  const statusClass =
    totalChanges === 0 ? 'diff-status diff-status-clean' : 'diff-status'

  const settings = escapeAttribute(
    JSON.stringify({
      lineMap: options.lineMap,
      leftLineCount: options.leftLineCount,
      rightLineCount: options.rightLineCount,
      ratio: options.ratio,
      strings: options.strings,
      stats: options.stats,
      version: options.version,
    }),
  )

  const bodyClass = escapeAttribute(
    [bodyClasses, 'diff-body'].filter(Boolean).join(' '),
  )
  const previewStyleAttribute =
    previewStyle !== undefined
      ? ` data-preview-style="${escapeAttribute(previewStyle)}"`
      : ''

  return `<!DOCTYPE html>
<html${htmlStyleAttribute}>
<head>
<meta charset="UTF-8">
${headHtml}
<link rel="stylesheet" type="text/css" href="${escapeAttribute(options.diffCssUri)}">
<style>${options.diffContentCss}</style>
<meta id="vscode-asciidoc-diff-data" data-settings="${settings}">
</head>
<body class="${bodyClass}"${previewStyleAttribute}>
<div id="diff-root">
  <header id="diff-header">
    <div class="diff-pane-title">
      <span class="diff-badge diff-badge-old">${escapeHtml(options.strings.old)}</span>
      <span id="diff-left-title" class="diff-title">${escapeHtml(options.leftTitle)}</span>
    </div>
    <div id="diff-status" class="${statusClass}">${statusText}</div>
    <button id="diff-swap" class="diff-swap" type="button" title="${escapeHtml(options.strings.swap)}" aria-label="${escapeHtml(options.strings.swap)}">
      <span class="diff-swap-icon" aria-hidden="true">⇄</span><span class="diff-swap-label">${escapeHtml(options.strings.swap)}</span>
    </button>
    <div class="diff-pane-title diff-pane-title-right">
      <span class="diff-badge diff-badge-new">${escapeHtml(options.strings.new)}</span>
      <span id="diff-right-title" class="diff-title">${escapeHtml(options.rightTitle)}</span>
    </div>
  </header>
  <main id="diff-panes">
    <div id="diff-left" class="diff-pane">${serializeOuter(left.root)}</div>
    <div id="diff-right" class="diff-pane">${serializeOuter(right.root)}</div>
  </main>
</div>
${trailingHtml}
<script src="${escapeAttribute(options.diffScriptUri)}"></script>
</body>
</html>`
}

function parsePreview(html: string): ParsedPreview {
  const doc = parse(html)
  return {
    doc,
    root: findPreviewRoot(doc),
    head: findFirstElementByTag(doc, 'head'),
    body: findFirstElementByTag(doc, 'body'),
    baseHref: readBaseHref(doc),
    nonce: extractNonce(html),
  }
}

function readBaseHref(doc: Document): string | undefined {
  const base = findFirstElementByTag(doc, 'base')
  const href = base ? getAttribute(base, 'href') : undefined
  return href === '' ? undefined : href
}

function extractNonce(html: string): string | undefined {
  return /nonce="([^"]+)"/i.exec(html)?.[1]
}

/**
 * Merges the right document's head into the left one. The left head is kept as
 * is (so its CSP, data attributes and `<base>` are preserved) and the right's
 * elements are appended unless they are document-level metadata or already
 * present (an identical stylesheet, script or inline block).
 */
function serializeMergedHead(
  left: ParsedPreview,
  right: ParsedPreview,
): string {
  const parts: string[] = []
  const keys = new Set<string>()
  if (left.head) {
    for (const node of left.head.childNodes) {
      parts.push(serializeOuter(node))
      const key = dedupeKey(node)
      if (key !== undefined) {
        keys.add(key)
      }
    }
  }
  if (right.head) {
    for (const node of right.head.childNodes) {
      const key = dedupeKey(node)
      if (key === undefined || keys.has(key)) {
        continue
      }
      keys.add(key)
      parts.push(serializeOuter(node))
    }
  }
  return parts.join('')
}

/**
 * Merges the scripts the converter appends after `#preview-root` (MathJax,
 * Mermaid, PlantUML, docinfo). The right document may have features the left one
 * does not (for example MathJax, added only when the document has `:stem:`), so
 * its scripts are appended too, unless already present.
 */
function serializeMergedTrailing(
  left: ParsedPreview,
  right: ParsedPreview,
): string {
  const parts: string[] = []
  const keys = new Set<string>()
  if (left.body) {
    for (const node of left.body.childNodes) {
      if (node === left.root || isPreviewClientScript(node)) {
        continue
      }
      const key = dedupeKey(node)
      if (key !== undefined) {
        if (keys.has(key)) {
          continue
        }
        keys.add(key)
      }
      parts.push(serializeOuter(node))
    }
  }
  if (right.body) {
    for (const node of right.body.childNodes) {
      if (node === right.root || isPreviewClientScript(node)) {
        continue
      }
      const key = dedupeKey(node)
      if (key === undefined || keys.has(key)) {
        continue
      }
      keys.add(key)
      parts.push(serializeOuter(node))
    }
  }
  return parts.join('')
}

function isPreviewClientScript(node: ChildNode): boolean {
  if (!isElement(node) || node.tagName !== 'script') {
    return false
  }
  const src = getAttribute(node, 'src') ?? ''
  return /dist\/index\.js(?:[?#]|$)/i.test(src)
}

function dedupeKey(node: ChildNode): string | undefined {
  if (!isElement(node)) {
    return undefined
  }
  const tag = node.tagName
  if (tag === 'meta' || tag === 'base' || tag === 'title') {
    return undefined
  }
  if (tag === 'script') {
    const src = getAttribute(node, 'src')
    if (src !== undefined && src !== '') {
      // The MathJax loader is the only way to get MathJax in; keeping a single
      // one avoids loading it twice when both documents have `:stem:`.
      return /mathjax/i.test(src)
        ? 'script:mathjax-loader'
        : `script-src:${src}`
    }
    const text = serializeOuter(node)
    if (/MathJax\s*=\s*\{/.test(text)) {
      return 'script:mathjax-config'
    }
    return `script:${normalize(text)}`
  }
  if (tag === 'link') {
    return `link:${getAttribute(node, 'href') ?? ''}`
  }
  return `${tag}:${normalize(serializeOuter(node))}`
}

function normalize(html: string): string {
  return html
    .replace(/nonce="[^"]*"/gi, 'nonce=""')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Adds `'nonce-<nonce>'` to the `script-src` of the right document to the left
 * CSP, so the scripts merged from the right document are allowed to run.
 */
function allowNonceInCsp(
  head: Element | undefined,
  nonce: string | undefined,
): void {
  if (!head || nonce === undefined) {
    return
  }
  for (const node of head.childNodes) {
    if (!isElement(node) || node.tagName !== 'meta') {
      continue
    }
    if (
      (getAttribute(node, 'http-equiv') ?? '').toLowerCase() !==
      'content-security-policy'
    ) {
      continue
    }
    const content = getAttribute(node, 'content') ?? ''
    if (content === '' || content.includes(`'nonce-${nonce}'`)) {
      return
    }
    if (!/script-src/i.test(content)) {
      return
    }
    setAttribute(
      node,
      'content',
      content.replace(
        /(script-src[^;]*)/i,
        (directive) => `${directive} 'nonce-${nonce}'`,
      ),
    )
    return
  }
}

const URL_ATTRIBUTES = new Set(['src', 'href', 'data', 'poster'])

/**
 * Resolves the relative URL attributes of a subtree against the document's own
 * base, so the right pane loads its resources from the right place even though
 * the combined document keeps the left `<base>`.
 */
function resolveRelativeUrls(
  root: Element,
  baseHref: string | undefined,
): void {
  if (baseHref === undefined) {
    return
  }
  const visit = (element: Element): void => {
    for (const attr of element.attrs) {
      if (!URL_ATTRIBUTES.has(attr.name.toLowerCase())) {
        continue
      }
      if (isRelativeUrl(attr.value)) {
        attr.value = joinUrl(attr.value, baseHref)
      }
    }
    for (const child of element.childNodes) {
      if (isElement(child)) {
        visit(child)
      }
    }
  }
  visit(root)
}

function isRelativeUrl(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') {
    return false
  }
  // Absolute URL (scheme), protocol-relative, root-relative or a fragment.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return false
  }
  return !trimmed.startsWith('#') && !trimmed.startsWith('/')
}

function joinUrl(value: string, baseHref: string): string {
  try {
    return new URL(value, baseHref).href
  } catch {
    return value
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}
