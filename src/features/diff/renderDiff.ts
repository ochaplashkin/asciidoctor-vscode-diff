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

import { diffBlocks, maxDataLine } from './blockDiff.js'
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
} from './htmlTree.js'

export function renderDiff(
  leftHtml: string,
  rightHtml: string,
): DiffRenderResult {
  const leftDoc = parse(leftHtml)
  const rightDoc = parse(rightHtml)
  const leftRoot = findPreviewRoot(leftDoc)
  const rightRoot = findPreviewRoot(rightDoc)

  const leftLineCount = maxDataLine(leftRoot) ?? 1
  const rightLineCount = maxDataLine(rightRoot) ?? 1

  const { stats, lineMap } = diffBlocks(leftRoot, rightRoot)

  return {
    leftHtml: serialize(leftDoc),
    rightHtml: serialize(rightDoc),
    lineMap: normalizeLineMap(lineMap),
    leftLineCount,
    rightLineCount,
    stats,
  }
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
