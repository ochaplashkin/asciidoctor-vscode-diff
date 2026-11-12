/**
 * Recursive block-level diff of two normalized DOM subtrees.
 *
 * The algorithm:
 *
 * 1. Align children (block elements) of a container with an LCS over their
 *    normalized subtree signatures. Children with identical signatures are
 *    unchanged and skipped; runs of removed/added children are paired by
 *    text similarity so a single changed word does not mark the whole block.
 * 2. Recurse into matched (changed) pairs.
 * 3. For leaf blocks (no block children), do a word-level diff of the visible
 *    text.
 * 4. Tables are handled specially: table-level, row-level, cell-level and
 *    word-level markers.
 *
 * The live DOM is mutated only by *adding* `adoc-diff-*` classes and
 * `<span>`-wrappers; text, tags and styles are never changed.
 */

import { diffArrays } from 'diff'
import type { DiffLineMapEntry } from './diffLineMap.js'
import {
  addClass,
  type ChildNode,
  collectText,
  type Element,
  getAttribute,
  getClasses,
  isElement,
  isText,
  type TextNode,
  type TextRange,
  walk,
  wrapNodeInSpan,
  wrapTextNodeRanges,
} from './htmlTree.js'
import { computeInlineDiff, type InlineRange } from './inlineDiff.js'
import { subtreeSignature, subtreesEqual } from './normalizeHtml.js'

export interface DiffStats {
  addedBlocks: number
  removedBlocks: number
  changedBlocks: number
  changedTables: number
}

export interface BlockDiffResult {
  readonly stats: DiffStats
  readonly lineMap: DiffLineMapEntry[]
}

interface DiffContext {
  readonly stats: DiffStats
  readonly lineMap: DiffLineMapEntry[]
}

interface Alignment {
  readonly left?: Element
  readonly right?: Element
  readonly unchanged?: boolean
}

const SIMILARITY_THRESHOLD = 0.25

// Tags that may contain other blocks. Everything else is inline content.
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'caption',
  'colgroup',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
])

const CELL_TAGS = new Set(['td', 'th'])

/**
 * Computes the diff of two preview roots, mutating them in place by adding
 * `adoc-diff-*` markers and collecting a source-line map for scroll sync.
 */
export function diffBlocks(
  leftRoot: Element,
  rightRoot: Element,
): BlockDiffResult {
  const stats: DiffStats = {
    addedBlocks: 0,
    removedBlocks: 0,
    changedBlocks: 0,
    changedTables: 0,
  }
  const ctx: DiffContext = { stats, lineMap: [] }
  if (subtreesEqual(leftRoot, rightRoot)) {
    collectLinePairs(leftRoot, rightRoot, ctx)
    return { stats, lineMap: ctx.lineMap }
  }
  diffElement(leftRoot, rightRoot, ctx)
  return { stats, lineMap: ctx.lineMap }
}

/**
 * The highest `data-line-N` anchor in a subtree, or `undefined` when there are
 * none. Used as the document's line count for proportional scroll mapping.
 */
export function maxDataLine(root: Element): number | undefined {
  let max: number | undefined
  walk(root, (node) => {
    if (isElement(node)) {
      const line = dataLineOf(node)
      if (line !== undefined && (max === undefined || line > max)) {
        max = line
      }
    }
  })
  return max
}

function dataLineOf(el: Element): number | undefined {
  for (const cls of getClasses(el)) {
    const match = /^data-line-(\d+)$/.exec(cls)
    if (match) {
      return Number(match[1])
    }
  }
  const attr = getAttribute(el, 'data-line')
  if (attr !== undefined) {
    const line = Number(attr)
    if (Number.isFinite(line)) {
      return line
    }
  }
  return undefined
}

function recordLinePair(left: Element, right: Element, ctx: DiffContext): void {
  const leftLine = dataLineOf(left)
  const rightLine = dataLineOf(right)
  if (leftLine !== undefined && rightLine !== undefined) {
    ctx.lineMap.push({ leftLine, rightLine })
  }
}

function collectLinePairs(
  left: Element,
  right: Element,
  ctx: DiffContext,
): void {
  recordLinePair(left, right, ctx)
  const leftBlocks = blockChildren(left)
  const rightBlocks = blockChildren(right)
  const count = Math.min(leftBlocks.length, rightBlocks.length)
  for (let i = 0; i < count; i++) {
    collectLinePairs(leftBlocks[i], rightBlocks[i], ctx)
  }
}

function blockChildren(el: Element): Element[] {
  const out: Element[] = []
  for (const child of el.childNodes) {
    if (isElement(child) && BLOCK_TAGS.has(child.tagName)) {
      out.push(child)
    }
  }
  return out
}

function collectInlineTextNodes(root: Element): TextNode[] {
  const out: TextNode[] = []
  const visit = (node: ChildNode): void => {
    if (isText(node)) {
      out.push(node)
      return
    }
    if (!isElement(node)) {
      return
    }
    if (node.tagName === 'script' || node.tagName === 'style') {
      return
    }
    if (node !== root && BLOCK_TAGS.has(node.tagName)) {
      return
    }
    for (const child of node.childNodes) {
      visit(child)
    }
  }
  visit(root)
  return out
}

function hasInlineContent(el: Element): boolean {
  return el.childNodes.some((child) => {
    if (isText(child)) {
      return child.value.trim().length > 0
    }
    if (
      isElement(child) &&
      child.tagName !== 'script' &&
      child.tagName !== 'style'
    ) {
      return !BLOCK_TAGS.has(child.tagName)
    }
    return false
  })
}

function markWhole(node: ChildNode, side: 'left' | 'right'): void {
  const className =
    side === 'left' ? 'adoc-diff-block-del' : 'adoc-diff-block-ins'
  if (isElement(node)) {
    addClass(node, className)
  } else if (isText(node)) {
    wrapNodeInSpan(node, className)
  }
}

function markCell(node: Element, side: 'left' | 'right'): void {
  addClass(node, side === 'left' ? 'adoc-diff-cell-del' : 'adoc-diff-cell-ins')
}

function elementText(el: Element): string {
  return collectText(el).replace(/\s+/g, ' ')
}

function textSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1
  }
  const leftWords = new Set(left.toLowerCase().split(/\s+/).filter(Boolean))
  const rightWords = new Set(right.toLowerCase().split(/\s+/).filter(Boolean))
  if (leftWords.size === 0 && rightWords.size === 0) {
    return 1
  }
  if (leftWords.size === 0 || rightWords.size === 0) {
    return 0
  }
  let common = 0
  for (const word of leftWords) {
    if (rightWords.has(word)) {
      common++
    }
  }
  return (2 * common) / (leftWords.size + rightWords.size)
}

function pairSimilar(removed: Element[], added: Element[]): Alignment[] {
  const out: Alignment[] = []
  const used = new Array(added.length).fill(false)
  for (const leftEl of removed) {
    const leftText = elementText(leftEl)
    let best = -1
    let bestScore = 0
    for (let j = 0; j < added.length; j++) {
      if (used[j] || added[j].tagName !== leftEl.tagName) {
        continue
      }
      const score = textSimilarity(leftText, elementText(added[j]))
      if (score > bestScore) {
        bestScore = score
        best = j
      }
    }
    if (best >= 0 && (bestScore >= SIMILARITY_THRESHOLD || bestScore === 1)) {
      used[best] = true
      out.push({ left: leftEl, right: added[best] })
    } else {
      out.push({ left: leftEl })
    }
  }
  for (let j = 0; j < added.length; j++) {
    if (!used[j]) {
      out.push({ right: added[j] })
    }
  }
  return out
}

function pairReplacements(pairs: Alignment[]): Alignment[] {
  const out: Alignment[] = []
  let i = 0
  while (i < pairs.length) {
    if (pairs[i].unchanged) {
      out.push(pairs[i])
      i++
      continue
    }
    const removed: Element[] = []
    const added: Element[] = []
    while (i < pairs.length && !pairs[i].unchanged) {
      const item = pairs[i]
      if (item.left) {
        removed.push(item.left)
      }
      if (item.right) {
        added.push(item.right)
      }
      i++
    }
    out.push(...pairSimilar(removed, added))
  }
  return out
}

function alignElements(left: Element[], right: Element[]): Alignment[] {
  const changes = diffArrays(
    left.map(subtreeSignature),
    right.map(subtreeSignature),
  )
  const pairs: Alignment[] = []
  let leftIndex = 0
  let rightIndex = 0
  for (const change of changes) {
    if (change.removed && !change.added) {
      for (let k = 0; k < change.count; k++) {
        pairs.push({ left: left[leftIndex + k] })
      }
      leftIndex += change.count
    } else if (change.added && !change.removed) {
      for (let k = 0; k < change.count; k++) {
        pairs.push({ right: right[rightIndex + k] })
      }
      rightIndex += change.count
    } else {
      for (let k = 0; k < change.count; k++) {
        pairs.push({
          left: left[leftIndex + k],
          right: right[rightIndex + k],
          unchanged: true,
        })
      }
      leftIndex += change.count
      rightIndex += change.count
    }
  }
  return pairReplacements(pairs)
}

function wrapRanges(
  nodes: TextNode[],
  ranges: readonly InlineRange[],
  className: string,
): void {
  let base = 0
  for (const node of nodes) {
    const length = node.value.length
    const local: TextRange[] = []
    for (const range of ranges) {
      if (range.end <= base) {
        continue
      }
      if (range.start >= base + length) {
        break
      }
      const start = Math.max(0, range.start - base)
      const end = Math.min(length, range.end - base)
      if (end > start) {
        local.push({ start, end })
      }
    }
    if (local.length > 0) {
      wrapTextNodeRanges(node, local, className)
    }
    base += length
  }
}

function diffInlineTextNodes(
  left: Element,
  right: Element,
  ctx: DiffContext,
): boolean {
  const leftNodes = collectInlineTextNodes(left)
  const rightNodes = collectInlineTextNodes(right)
  const leftText = leftNodes.map((node) => node.value).join('')
  const rightText = rightNodes.map((node) => node.value).join('')
  const result = computeInlineDiff(leftText, rightText)
  if (!result) {
    // Too large to diff token by token: mark the whole blocks as changed.
    addClass(left, 'adoc-diff-block-del')
    addClass(right, 'adoc-diff-block-ins')
    ctx.stats.changedBlocks++
    return true
  }
  if (result.left.length === 0 && result.right.length === 0) {
    return false
  }
  wrapRanges(leftNodes, result.left, 'adoc-diff-word adoc-diff-word-del')
  wrapRanges(rightNodes, result.right, 'adoc-diff-word adoc-diff-word-ins')
  ctx.stats.changedBlocks++
  return true
}

function diffElement(left: Element, right: Element, ctx: DiffContext): boolean {
  if (left.tagName !== right.tagName) {
    markWhole(left, 'left')
    markWhole(right, 'right')
    ctx.stats.removedBlocks++
    ctx.stats.addedBlocks++
    return true
  }
  if (left.tagName === 'table') {
    return diffTable(left, right, ctx)
  }
  recordLinePair(left, right, ctx)
  const leftBlocks = blockChildren(left)
  const rightBlocks = blockChildren(right)
  if (leftBlocks.length === 0 && rightBlocks.length === 0) {
    return diffInlineTextNodes(left, right, ctx)
  }
  let changed = alignBlockChildren(left, right, ctx)
  if (hasInlineContent(left) || hasInlineContent(right)) {
    if (diffInlineTextNodes(left, right, ctx)) {
      changed = true
    }
  }
  return changed
}

function alignBlockChildren(
  left: Element,
  right: Element,
  ctx: DiffContext,
): boolean {
  const leftBlocks = blockChildren(left)
  const rightBlocks = blockChildren(right)
  let changed = false
  for (const pair of alignElements(leftBlocks, rightBlocks)) {
    if (pair.left && pair.right) {
      if (pair.unchanged) {
        collectLinePairs(pair.left, pair.right, ctx)
      } else if (diffElement(pair.left, pair.right, ctx)) {
        changed = true
      }
    } else if (pair.left) {
      markWhole(pair.left, 'left')
      ctx.stats.removedBlocks++
      changed = true
    } else if (pair.right) {
      markWhole(pair.right, 'right')
      ctx.stats.addedBlocks++
      changed = true
    }
  }
  return changed
}

function diffTable(left: Element, right: Element, ctx: DiffContext): boolean {
  addClass(left, 'adoc-diff-table-del')
  addClass(right, 'adoc-diff-table-ins')
  ctx.stats.changedTables++

  diffCaption(left, right, ctx)

  const leftRows = rowsOf(left)
  const rightRows = rowsOf(right)
  for (const pair of alignElements(leftRows, rightRows)) {
    if (pair.left && pair.right) {
      if (!pair.unchanged) {
        diffRow(pair.left, pair.right, ctx)
      }
    } else if (pair.left) {
      addClass(pair.left, 'adoc-diff-row-del')
      ctx.stats.removedBlocks++
    } else if (pair.right) {
      addClass(pair.right, 'adoc-diff-row-ins')
      ctx.stats.addedBlocks++
    }
  }
  return true
}

function diffRow(left: Element, right: Element, ctx: DiffContext): boolean {
  const leftCells = cellsOf(left)
  const rightCells = cellsOf(right)
  let changed = false
  const count = Math.max(leftCells.length, rightCells.length)
  for (let i = 0; i < count; i++) {
    const leftCell = leftCells[i]
    const rightCell = rightCells[i]
    if (leftCell && rightCell) {
      if (diffElement(leftCell, rightCell, ctx)) {
        markCell(leftCell, 'left')
        markCell(rightCell, 'right')
        changed = true
      }
    } else if (leftCell) {
      markCell(leftCell, 'left')
      ctx.stats.removedBlocks++
      changed = true
    } else if (rightCell) {
      markCell(rightCell, 'right')
      ctx.stats.addedBlocks++
      changed = true
    }
  }
  return changed
}

function diffCaption(left: Element, right: Element, ctx: DiffContext): void {
  const leftCaption = firstChildTag(left, 'caption')
  const rightCaption = firstChildTag(right, 'caption')
  if (leftCaption && rightCaption) {
    diffElement(leftCaption, rightCaption, ctx)
  } else if (leftCaption) {
    markWhole(leftCaption, 'left')
    ctx.stats.removedBlocks++
  } else if (rightCaption) {
    markWhole(rightCaption, 'right')
    ctx.stats.addedBlocks++
  }
}

function rowsOf(table: Element): Element[] {
  const rows: Element[] = []
  for (const section of table.childNodes) {
    if (!isElement(section)) {
      continue
    }
    if (section.tagName === 'tr') {
      rows.push(section)
      continue
    }
    if (
      section.tagName === 'thead' ||
      section.tagName === 'tbody' ||
      section.tagName === 'tfoot'
    ) {
      for (const row of section.childNodes) {
        if (isElement(row) && row.tagName === 'tr') {
          rows.push(row)
        }
      }
    }
  }
  return rows
}

function cellsOf(row: Element): Element[] {
  const cells: Element[] = []
  for (const child of row.childNodes) {
    if (isElement(child) && CELL_TAGS.has(child.tagName)) {
      cells.push(child)
    }
  }
  return cells
}

function firstChildTag(el: Element, tag: string): Element | undefined {
  for (const child of el.childNodes) {
    if (isElement(child) && child.tagName === tag) {
      return child
    }
  }
  return undefined
}
