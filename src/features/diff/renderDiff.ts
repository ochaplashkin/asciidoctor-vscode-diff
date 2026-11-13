/**
 * Renders the diff of two preview documents.
 *
 * Parses both full preview HTML documents, diffs the contents of their
 * `#preview-root`, and returns the two full documents with the `adoc-diff-*`
 * markers injected, plus the source-line map. The documents keep their original
 * shell (CSP, styles, MathJax / Mermaid / PlantUML bootstrap); only
 * `#preview-root` is mutated.
 *
 * The caller (`buildDiffDocument`) assembles the final side-by-side document from
 * these two. This module, and every module it imports, is vscode-free.
 */

import {
  type DiffRenderOptions,
  defaultDiffRenderOptions,
  diffBlocks,
  maxDataLine,
} from './blockDiff.js'
import { normalizeLineMap } from './diffLineMap.js'
import type {
  DiffLineMapEntry,
  DiffRenderResult,
  DiffStats,
} from './diffTypes.js'
import {
  type Document,
  type Element,
  getAttribute,
  isElement,
  type ParentNode,
  parse,
  serialize,
  setAttribute,
} from './htmlTree.js'

export function renderDiff(
  leftHtml: string,
  rightHtml: string,
  options: DiffRenderOptions = defaultDiffRenderOptions,
): DiffRenderResult {
  const leftDoc = parse(leftHtml)
  const rightDoc = parse(rightHtml)
  // The raw `src`/`poster` values are webview URIs of the two documents and
  // differ even for the same image. Store a document-relative identity so the
  // normalized signature can detect a changed image, video or embed.
  annotateMediaKeys(leftDoc)
  annotateMediaKeys(rightDoc)
  // Link targets are ignored by the visual signature (they encode document
  // identity), but a changed `href` is a real, non-visual difference. Store a
  // document-relative identity so it can be compared across documents.
  annotateLinkKeys(leftDoc)
  annotateLinkKeys(rightDoc)
  const leftRoot = findPreviewRoot(leftDoc)
  const rightRoot = findPreviewRoot(rightDoc)

  const leftLineCount = maxDataLine(leftRoot) ?? 1
  const rightLineCount = maxDataLine(rightRoot) ?? 1

  const { stats, lineMap } = diffBlocks(leftRoot, rightRoot, options)

  return {
    leftHtml: serialize(leftDoc),
    rightHtml: serialize(rightDoc),
    lineMap: normalizeLineMap(lineMap),
    leftLineCount,
    rightLineCount,
    stats,
  }
}

const MEDIA_TAGS = new Set([
  'img',
  'video',
  'audio',
  'iframe',
  'object',
  'source',
])

/**
 * Adds `data-adoc-diff-key` to media elements: a stable, document-relative
 * identity of the resource they point to. The normalized signature includes it
 * (see `normalizeHtml.isIgnoredAttribute`), so two otherwise identical image
 * blocks with different files are detected as changed instead of being skipped
 * as "unchanged".
 */
function annotateMediaKeys(doc: Document): void {
  const base = findFirstElementByTag(doc, 'base')
  const baseHref = base ? getAttribute(base, 'href') : undefined
  visitElements(doc, (element) => {
    if (!MEDIA_TAGS.has(element.tagName)) {
      return
    }
    const values = [
      getAttribute(element, 'src'),
      getAttribute(element, 'poster'),
      getAttribute(element, 'data'),
    ].filter((value): value is string => value !== undefined && value !== '')
    if (values.length === 0) {
      return
    }
    const key = values
      .map((value) => normalizeMediaUri(value, baseHref))
      .join('|')
    setAttribute(element, 'data-adoc-diff-key', key)
  })
}

function visitElements(
  node: ParentNode,
  visit: (element: Element) => void,
): void {
  for (const child of node.childNodes) {
    if (!isElement(child)) {
      continue
    }
    visit(child)
    visitElements(child, visit)
  }
}

const LINK_TAGS = new Set(['a', 'area'])

/**
 * Adds `data-adoc-diff-link-key` to links: a stable, document-relative identity
 * of the target they point to. `href` itself is ignored by the visual signature
 * (it encodes the document path), so this key is what lets the non-visual pass
 * report "the link text is the same but it now points somewhere else".
 *
 * Fragment-only links (`#section`) keep their raw value: they must not be
 * resolved against the document base, and a changed fragment is a real change.
 */
function annotateLinkKeys(doc: Document): void {
  const base = findFirstElementByTag(doc, 'base')
  const baseHref = base ? getAttribute(base, 'href') : undefined
  visitElements(doc, (element) => {
    if (!LINK_TAGS.has(element.tagName)) {
      return
    }
    const href = getAttribute(element, 'href')
    if (href === undefined || href === '') {
      return
    }
    setAttribute(
      element,
      'data-adoc-diff-link-key',
      href.startsWith('#') ? href : normalizeMediaUri(href, baseHref),
    )
  })
}

function normalizeMediaUri(
  value: string,
  baseHref: string | undefined,
): string {
  if (value.startsWith('data:')) {
    // Data URIs (Mermaid/PlantUML) embed the diagram source and can be huge;
    // a stable hash is enough to compare identities and keeps the signature
    // (and therefore the serialized DOM) small.
    return `data:${hashString(value)}`
  }
  const trimmed = value.replace(/^\.\//, '')
  if (!baseHref) {
    return trimmed
  }
  try {
    const resolved = new URL(trimmed, baseHref).href
    const base = new URL(baseHref)
    const directory = base.href.slice(0, base.href.lastIndexOf('/') + 1)
    return resolved.startsWith(directory)
      ? resolved.slice(directory.length)
      : resolved
  } catch {
    return trimmed
  }
}

function hashString(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

export function findPreviewRoot(doc: Document): Element {
  const byId = findElementById(doc, 'preview-root')
  if (byId) {
    return byId
  }
  const body = findFirstElementByTag(doc, 'body')
  if (body) {
    return body
  }
  const html = findFirstElementByTag(doc, 'html')
  if (html) {
    return html
  }
  throw new Error('Unable to find a preview root in the rendered HTML')
}

export function findFirstElementByTag(
  node: ParentNode,
  tag: string,
): Element | undefined {
  for (const child of node.childNodes) {
    if (isElement(child)) {
      if (child.tagName === tag) {
        return child
      }
      const nested = findFirstElementByTag(child, tag)
      if (nested) {
        return nested
      }
    }
  }
  return undefined
}

export function findElementById(
  node: ParentNode,
  id: string,
): Element | undefined {
  for (const child of node.childNodes) {
    if (isElement(child)) {
      if (getAttribute(child, 'id') === id) {
        return child
      }
      const nested = findElementById(child, id)
      if (nested) {
        return nested
      }
    }
  }
  return undefined
}

// Re-export the types the caller needs without importing them directly.
export type { DiffLineMapEntry, DiffStats }
