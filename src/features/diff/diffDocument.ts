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

import {
  type DiffRenderOptions,
  defaultDiffRenderOptions,
} from './blockDiff.js'
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
  /** "No visual text differences" (the text is the same, formatting/link/id is not). */
  readonly noVisualDifferences: string
  /** Short count suffix for the non-visual status, e.g. "3 changes". */
  readonly statusNonVisualSummary: string
  readonly statusNonVisualSummaryOne: string
  /** Count suffix for a TOC-only status. */
  readonly statusNavigationSummary: string
  readonly statusNavigationSummaryOne: string
  /** Tooltip of the TOC navigation badge. */
  readonly navigationChanged: string
  readonly error: string
  readonly old: string
  readonly new: string
  readonly swap: string
  /** Non-visual badge tooltips. */
  readonly nonVisualFormatting: string
  readonly nonVisualLink: string
  readonly nonVisualId: string
  /** Tooltip of the left-margin icon of a changed block or media element. */
  readonly blockChanged: string
  readonly mediaChanged: string
  /** Header warning when the two previews use different document shells. */
  readonly shellDiffers: string
  /** Status tooltip: added/removed/changed/non-visual detail. */
  readonly statusSummary: string
  readonly statusNonVisual: string
  readonly statusJump: string
  /** Collapsed deleted block. */
  readonly collapseExpand: string
  readonly collapseCollapse: string
  readonly collapseLabel: string
  readonly collapseLabelWithExcerpt: string
  /** Gap labels. */
  readonly gapAddedBlocks: string
  readonly gapAddedTable: string
  readonly gapAddedLines: string
  readonly gapRemovedBlocks: string
  readonly gapRemovedTable: string
  readonly gapRemovedLines: string
  readonly gapChangedBlocks: string
  readonly gapChangedTable: string
  readonly gapChangedLines: string
  readonly gapAddedBlock: string
  readonly gapAddedTableRow: string
  readonly gapAddedLine: string
  readonly gapRemovedBlock: string
  readonly gapRemovedTableRow: string
  readonly gapRemovedLine: string
  readonly gapChangedBlock: string
  readonly gapChangedTableRow: string
  readonly gapChangedLine: string
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
  /** Full path of each side, shown on hover. */
  readonly leftTitleTooltip?: string
  readonly rightTitleTooltip?: string
  readonly strings: DiffDocumentStrings
  readonly lineMap: readonly DiffLineMapEntry[]
  readonly leftLineCount: number
  readonly rightLineCount: number
  /** Fraction of the scrollable range to restore after load (0..1). */
  readonly ratio?: number
  /** Top source line of each pane at the last scroll, for an exact restore. */
  readonly leftLine?: number
  readonly rightLine?: number
  /** Collapse keys of deleted blocks the reader expanded. */
  readonly expanded?: readonly string[]
  readonly version: number
  readonly stats: DiffStats
  /** Presentation options; clients should pass the same object as `renderDiff`. */
  readonly options?: DiffRenderOptions
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
  // The generated table of contents is navigation, not content: it is compared
  // (a TOC-only change is still reported in the status) but it must not take a
  // column away from the rendered text in either pane.
  removeGeneratedToc(left.root)
  removeGeneratedToc(right.root)
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
  // The combined document can only have one `<body>`, and the shell classes
  // (`book`/`article`, `toc2`, `toc-left`, the preview style) drive rules that
  // apply to both panes. They come from the left document; when the two shells
  // differ, the right pane is rendered in a shell it does not own. Scoping the
  // shell rules per pane is not possible without rewriting the preview
  // stylesheets, so the header warns instead of silently misrendering.
  const shellDiffers = previewShellsDiffer(left, right)
  const trailingHtml = serializeMergedTrailing(left, right)

  const totalChanges =
    options.stats.changes + (options.stats.navigationChanges ?? 0)
  const statusText =
    totalChanges === 0 ? escapeHtml(options.strings.noDifferences) : ''
  const statusClass =
    totalChanges === 0 ? 'diff-status diff-status-clean' : 'diff-status'

  const renderOptions = options.options ?? defaultDiffRenderOptions
  const settings = escapeAttribute(
    JSON.stringify({
      align: renderOptions.align,
      showStats: renderOptions.showStats,
      lineMap: options.lineMap,
      leftLineCount: options.leftLineCount,
      rightLineCount: options.rightLineCount,
      ratio: options.ratio,
      leftLine: options.leftLine,
      rightLine: options.rightLine,
      expanded: options.expanded ?? [],
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
  const shellWarning = shellDiffers
    ? `<div id="diff-shell-warning" class="diff-shell-warning" role="img" title="${escapeAttribute(options.strings.shellDiffers)}" aria-label="${escapeAttribute(options.strings.shellDiffers)}">!</div>`
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
      <span id="diff-left-title" class="diff-title"${titleAttribute(options.leftTitleTooltip)}>${escapeHtml(options.leftTitle)}</span>
    </div>
    <div id="diff-status" class="${statusClass}">${statusText}</div>
    <div id="diff-legend" class="diff-legend" aria-hidden="true">
      <span class="diff-legend-item diff-legend-add">+</span>
      <span class="diff-legend-item diff-legend-del">−</span>
      <span class="diff-legend-item diff-legend-change">~</span>
      <span class="diff-legend-item diff-legend-moved">↕</span>
    </div>
    ${shellWarning}
    <button id="diff-swap" class="diff-swap" type="button" title="${escapeHtml(options.strings.swap)}" aria-label="${escapeHtml(options.strings.swap)}">
      <span class="diff-swap-icon" aria-hidden="true">⇄</span><span class="diff-swap-label">${escapeHtml(options.strings.swap)}</span>
    </button>
    <div class="diff-pane-title diff-pane-title-right">
      <span class="diff-badge diff-badge-new">${escapeHtml(options.strings.new)}</span>
      <span id="diff-right-title" class="diff-title"${titleAttribute(options.rightTitleTooltip)}>${escapeHtml(options.rightTitle)}</span>
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

/**
 * Removes the generated `#toc` element from a preview root. The TOC already
 * took part in `renderDiff` (which reports a TOC-only change), but the
 * comparison panes are narrow: a pinned TOC would reserve 15–20em of width and
 * make the content wrap earlier than in a standalone preview.
 */
function removeGeneratedToc(root: Element): void {
  const visit = (element: Element): void => {
    for (let index = element.childNodes.length - 1; index >= 0; index--) {
      const child = element.childNodes[index]
      if (!isElement(child)) {
        continue
      }
      if (getAttribute(child, 'id') === 'toc') {
        element.childNodes.splice(index, 1)
        continue
      }
      visit(child)
    }
  }
  visit(root)
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

interface PreviewShell {
  readonly classes: string
  readonly fingerprint: string | undefined
  readonly style: string | undefined
}

/**
 * The document-driven shell of a preview: the `<body>` classes and preview
 * style, plus the `data-shell` fingerprint the converter computes over them and
 * the stylesheets it loads.
 */
function readShell(preview: ParsedPreview): PreviewShell {
  const body = preview.body
  return {
    classes: normalizeShellClasses(
      body ? (getAttribute(body, 'class') ?? '') : '',
    ),
    fingerprint: body ? getAttribute(body, 'data-shell') : undefined,
    style: body ? getAttribute(body, 'data-preview-style') : undefined,
  }
}

function normalizeShellClasses(value: string): string {
  return value
    .split(/\s+/)
    .filter((name) => name !== '' && !/^data-h-[0-9a-z]+$/.test(name))
    .sort()
    .join(' ')
}

/**
 * Whether the two documents were rendered with different shells. The `data-shell`
 * fingerprint covers the body classes, the loaded stylesheets, the docinfo and
 * the math/diagram bootstrap, so it is the most reliable signal when the two
 * previews come from the converter. The body classes and the preview style are
 * the fallback for synthetic HTML.
 */
function previewShellsDiffer(
  left: ParsedPreview,
  right: ParsedPreview,
): boolean {
  const leftShell = readShell(left)
  const rightShell = readShell(right)
  if (
    leftShell.fingerprint !== undefined &&
    rightShell.fingerprint !== undefined
  ) {
    return leftShell.fingerprint !== rightShell.fingerprint
  }
  return (
    leftShell.classes !== rightShell.classes ||
    leftShell.style !== rightShell.style
  )
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
const LINK_ELEMENTS = new Set(['a', 'area'])

/**
 * Resolves the relative URL attributes of a subtree against the document's own
 * base, so the right pane loads its resources from the right place even though
 * the combined document keeps the left `<base>`.
 *
 * Link targets (`<a href>`, `<area href>`) are left untouched: the diff client
 * intercepts the click and sends the original href to the host, which resolves
 * it against the source document of the pane. Resolving it here would turn it
 * into a `vscode-webview-resource:` URI that the host cannot map back to a
 * file.
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
      if (
        attr.name.toLowerCase() === 'href' &&
        LINK_ELEMENTS.has(element.tagName)
      ) {
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

function titleAttribute(value: string | undefined): string {
  return value !== undefined && value !== ''
    ? ` title="${escapeAttribute(value)}"`
    : ''
}
