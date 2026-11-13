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
  appendChild,
  type ChildNode,
  collectText,
  createElement,
  createTextNode,
  type Element,
  getAttribute,
  getClasses,
  hasClass,
  isElement,
  isText,
  removeAttribute,
  setAttribute,
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
  changedCells: number
}

export type DiffDeletedBlocksMode = 'collapse' | 'expand'
export type DiffCodeBlocksMode = 'line' | 'block'

export interface DiffRenderOptions {
  readonly align: boolean
  readonly deletedBlocks: DiffDeletedBlocksMode
  readonly codeBlocks: DiffCodeBlocksMode
  readonly collapseLines: number
  readonly showStats: boolean
}

export const defaultDiffRenderOptions: DiffRenderOptions = {
  align: true,
  deletedBlocks: 'collapse',
  codeBlocks: 'line',
  collapseLines: 5,
  showStats: true,
}

export interface BlockDiffResult {
  readonly stats: DiffStats
  readonly lineMap: DiffLineMapEntry[]
}

interface DiffContext {
  readonly stats: DiffStats
  readonly lineMap: DiffLineMapEntry[]
  readonly options: DiffRenderOptions
  nextAnchor: number
  nextCollapse: number
  nextTable: number
}

interface Alignment {
  readonly left?: Element
  readonly right?: Element
  readonly unchanged?: boolean
}

const SIMILARITY_THRESHOLD = 0.25

/**
 * A short replacement (a table cell, a term, a heading, a one-line paragraph)
 * is paired positionally even when the two strings share no word: `2` -> `3`
 * and `one` -> `second` are replacements, not a removal plus an addition.
 * Longer unrelated blocks stay as a clean add/remove pair instead of producing
 * a wall of red/green words.
 */
const SHORT_TEXT_LIMIT = 120

/**
 * Asciidoctor's HTML5 converter marks real data tables with `tableblock`.
 * Layout tables (the ones inside `div.admonitionblock`) do not have it, so a
 * tag-only check must not send admonitions through the table diff.
 */
function isDataTable(el: Element): boolean {
  return el.tagName === 'table' && getClasses(el).includes('tableblock')
}

/**
 * Verbatim content: whitespace is meaningful, so it must not be collapsed by
 * the normalized signature and must not be diffed token by token when only the
 * indentation changed.
 */
function isVerbatim(el: Element): boolean {
  return el.tagName === 'pre'
}

const MEDIA_NODE_TAGS = new Set([
  'img',
  'video',
  'audio',
  'iframe',
  'object',
  'source',
])

/**
 * Identity of the media elements in a subtree. Such a change has no word to
 * wrap, so the containing block is marked as changed instead. Only media
 * attributes are included: a text change in a paragraph that also contains an
 * unchanged image must not mark the paragraph as "modified media".
 */
function mediaSignature(el: Element): string {
  const parts: string[] = []
  walk(el, (node) => {
    if (!isElement(node) || !MEDIA_NODE_TAGS.has(node.tagName)) {
      return
    }
    parts.push(
      [
        node.tagName,
        getAttribute(node, 'data-adoc-diff-key') ?? '',
        getAttribute(node, 'alt') ?? '',
        getAttribute(node, 'title') ?? '',
        getAttribute(node, 'width') ?? '',
        getAttribute(node, 'height') ?? '',
      ].join(':'),
    )
  })
  return parts.join('|')
}

function hasMediaDescendant(el: Element): boolean {
  return mediaSignature(el) !== ''
}

function markChanged(el: Element): void {
  addClass(el, 'adoc-diff-block-changed')
}

function markCellChanged(el: Element): void {
  addClass(el, 'adoc-diff-cell-changed')
}

function isInsideCell(el: Element): boolean {
  let node = el.parentNode as ChildNode | null
  while (node) {
    if (isElement(node) && CELL_TAGS.has(node.tagName)) {
      return true
    }
    node = node.parentNode as ChildNode | null
  }
  return false
}

function attributeOf(el: Element, name: string): string {
  return getAttribute(el, name) ?? ''
}

function cellAttributesDiffer(left: Element, right: Element): boolean {
  return (
    attributeOf(left, 'colspan') !== attributeOf(right, 'colspan') ||
    attributeOf(left, 'rowspan') !== attributeOf(right, 'rowspan')
  )
}

function columnWidths(table: Element): string[] {
  const widths: string[] = []
  for (const child of table.childNodes) {
    if (!isElement(child) || child.tagName !== 'colgroup') {
      continue
    }
    for (const col of child.childNodes) {
      if (isElement(col) && col.tagName === 'col') {
        widths.push(getAttribute(col, 'width') ?? '')
      }
    }
  }
  return widths
}

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
  options: DiffRenderOptions = defaultDiffRenderOptions,
): BlockDiffResult {
  const stats: DiffStats = {
    addedBlocks: 0,
    removedBlocks: 0,
    changedBlocks: 0,
    changedTables: 0,
    changedCells: 0,
  }
  const ctx: DiffContext = {
    stats,
    lineMap: [],
    options,
    nextAnchor: 0,
    nextCollapse: 0,
    nextTable: 0,
  }
  if (subtreesEqual(leftRoot, rightRoot)) {
    collectLinePairs(leftRoot, rightRoot, ctx)
    return { stats, lineMap: ctx.lineMap }
  }
  diffElement(leftRoot, rightRoot, ctx)
  if (ctx.options.align && hasChanges(stats)) {
    // The root itself and the two boundaries are measurement anchors: they let
    // the client align the leading and trailing blocks of the whole document.
    // They are only added when something changed, so an identical document
    // keeps the "no diff markers" property.
    setAttribute(leftRoot, 'data-adoc-diff-anchor', 'root')
    setAttribute(rightRoot, 'data-adoc-diff-anchor', 'root')
    addBoundaryAnchors(leftRoot)
    addBoundaryAnchors(rightRoot)
  }
  return { stats, lineMap: ctx.lineMap }
}

function hasChanges(stats: DiffStats): boolean {
  return (
    stats.addedBlocks > 0 ||
    stats.removedBlocks > 0 ||
    stats.changedBlocks > 0 ||
    stats.changedTables > 0 ||
    stats.changedCells > 0
  )
}

function addBoundaryAnchors(root: Element): void {
  const start = createElement('div', [
    { name: 'class', value: 'adoc-diff-boundary' },
    { name: 'data-adoc-diff-anchor', value: '__start' },
  ])
  start.parentNode = root
  root.childNodes.splice(0, 0, start)
  appendChild(
    root,
    createElement('div', [
      { name: 'class', value: 'adoc-diff-boundary' },
      { name: 'data-adoc-diff-anchor', value: '__end' },
    ]),
  )
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

/**
 * Visible text of an element, with block boundaries turned into spaces.
 *
 * `collectText()` concatenates the text nodes as they are; without whitespace
 * between two block elements that merges words ("A" + "X" + "B" -> "AXB") and
 * breaks the word-set similarity used to pair replacement runs.
 */
const elementTextCache = new WeakMap<Element, string>()

function elementText(el: Element): string {
  const cached = elementTextCache.get(el)
  if (cached !== undefined) {
    return cached
  }
  const parts: string[] = []
  const visit = (node: ChildNode): void => {
    if (isText(node)) {
      parts.push(node.value)
      return
    }
    if (!isElement(node)) {
      return
    }
    const block = node !== el && BLOCK_TAGS.has(node.tagName)
    if (block) {
      parts.push(' ')
    }
    for (const child of node.childNodes) {
      visit(child)
    }
    if (block) {
      parts.push(' ')
    }
  }
  visit(el)
  const text = parts.join('').replace(/\s+/g, ' ').trim()
  elementTextCache.set(el, text)
  return text
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
    out.push(...pairReplacementRun(removed, added))
  }
  return out
}

/**
 * Pairs a replacement run structurally first.
 *
 * The old implementation only paired blocks whose word sets were similar
 * enough (`SIMILARITY_THRESHOLD`), which made a short change such as `2` -> `3`
 * or `one` -> `second` look like a whole-block removal plus addition, and could
 * paint an entire container (`#content`, `.sectionbody`) red/green. Pairing the
 * first unused same-tag block in order keeps the recursion going: a matched
 * pair is diffed inside, so only the smallest changed unit is marked.
 *
 * Similarity remains as a fallback for the leftovers when the counts or tags in
 * the run do not line up positionally.
 */
function canPairPositionally(left: Element, right: Element): boolean {
  // Containers must be paired so their children can be aligned: pairing is the
  // only way to recurse and avoid painting the whole container.
  if (blockChildren(left).length > 0 || blockChildren(right).length > 0) {
    return true
  }
  if (isVerbatim(left) || isVerbatim(right)) {
    return true
  }
  if (hasMediaDescendant(left) || hasMediaDescendant(right)) {
    return true
  }
  return (
    elementText(left).length <= SHORT_TEXT_LIMIT &&
    elementText(right).length <= SHORT_TEXT_LIMIT
  )
}

function pairReplacementRun(removed: Element[], added: Element[]): Alignment[] {
  const out: Alignment[] = []
  const usedAdded = new Set<number>()
  const pairedLeft = new Set<Element>()

  for (const leftEl of removed) {
    const candidate = added.findIndex(
      (rightEl, index) =>
        !usedAdded.has(index) &&
        rightEl.tagName === leftEl.tagName &&
        canPairPositionally(leftEl, rightEl),
    )
    if (candidate < 0) {
      continue
    }
    usedAdded.add(candidate)
    pairedLeft.add(leftEl)
    out.push({ left: leftEl, right: added[candidate] })
  }

  const remainingLeft = removed.filter((el) => !pairedLeft.has(el))
  const remainingAdded = added.filter((_, index) => !usedAdded.has(index))
  out.push(...pairSimilar(remainingLeft, remainingAdded))
  return out
}

function alignElements(left: Element[], right: Element[]): Alignment[] {
  const changes = diffArrays(
    left.map((node) => subtreeSignature(node)),
    right.map((node) => subtreeSignature(node)),
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
  if (left.tagName === 'table' && isDataTable(left) && isDataTable(right)) {
    return diffTable(left, right, ctx)
  }
  recordLinePair(left, right, ctx)
  if (isVerbatim(left) || isVerbatim(right)) {
    return diffVerbatim(left, right, ctx)
  }
  const leftBlocks = blockChildren(left)
  const rightBlocks = blockChildren(right)
  if (leftBlocks.length === 0 && rightBlocks.length === 0) {
    const visualChange = needsVisualChangeMarker(left, right)
    const textChanged = diffInlineTextNodes(left, right, ctx)
    if (textChanged && !CELL_TAGS.has(left.tagName) && !isInsideCell(left)) {
      // Amber marker for a modified text block; the changed words keep their
      // red/green marks inside it.
      markChanged(left)
      markChanged(right)
    }
    if (visualChange) {
      if (CELL_TAGS.has(left.tagName) || CELL_TAGS.has(right.tagName)) {
        markCellChanged(left)
        markCellChanged(right)
      } else {
        markChanged(left)
        markChanged(right)
        if (!textChanged) {
          ctx.stats.changedBlocks++
        }
      }
      return true
    }
    return textChanged
  }
  let changed = alignBlockChildren(left, right, ctx)
  if (hasInlineContent(left) || hasInlineContent(right)) {
    if (diffInlineTextNodes(left, right, ctx)) {
      changed = true
    }
  }
  if (
    !changed &&
    CELL_TAGS.has(left.tagName) &&
    cellAttributesDiffer(left, right)
  ) {
    markCellChanged(left)
    markCellChanged(right)
    return true
  }
  return changed
}

/**
 * A visual change that has no word to wrap: a different image/video/embed, or
 * a cell whose `colspan`/`rowspan` changed. The normalized media key added by
 * `renderDiff` is what makes the media identity comparable; plain text changes
 * in the same paragraph do not trigger the marker.
 */
function needsVisualChangeMarker(left: Element, right: Element): boolean {
  if (CELL_TAGS.has(left.tagName) && cellAttributesDiffer(left, right)) {
    return true
  }
  return mediaSignature(left) !== mediaSignature(right)
}

/**
 * Verbatim blocks are content, not prose. A whitespace-only change (usually
 * indentation) is marked on the block instead of being silently ignored by the
 * whitespace-insensitive word diff. A real text change still gets word markers
 * until the line diff lands in v2.
 */
interface CodeLine {
  readonly nodes: readonly ChildNode[]
  readonly text: string
}

interface CodeOp {
  readonly kind: 'equal' | 'changed' | 'removed' | 'added'
  readonly left?: number
  readonly right?: number
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

const MAX_CODE_LINES = 2000

function cloneShallow(element: Element): Element {
  return createElement(
    element.tagName,
    element.attrs.map((attribute) => ({ ...attribute })),
  )
}

/**
 * Splits the rendered code into lines while keeping highlight.js markup.
 *
 * The preview's `<pre>` text contains `\n` in its text nodes; nested spans may
 * cross a line boundary. Each line is rebuilt with the currently open elements
 * closed at the end of the line and reopened at the start of the next one, so
 * every line is a balanced fragment and keeps its syntax colors.
 */
function splitCodeLines(root: Element): CodeLine[] {
  const lines: Element[] = []
  let current = createElement('div')
  let open: Array<{ source: Element; clone: Element }> = []

  const append = (node: ChildNode): void => {
    const parent = open.length > 0 ? open[open.length - 1].clone : current
    appendChild(parent, node)
  }

  const startLine = (): void => {
    lines.push(current)
    current = createElement('div')
    const previous = open
    open = []
    let parent = current
    for (const entry of previous) {
      const clone = cloneShallow(entry.source)
      appendChild(parent, clone)
      open.push({ source: entry.source, clone })
      parent = clone
    }
  }

  const emit = (node: ChildNode): void => {
    if (isText(node)) {
      const parts = node.value.replace(/\r\n?/g, '\n').split('\n')
      parts.forEach((part, index) => {
        if (index > 0) {
          startLine()
        }
        if (part !== '') {
          append(createTextNode(part))
        }
      })
      return
    }
    if (!isElement(node) || node.tagName === 'script') {
      return
    }
    const clone = cloneShallow(node)
    append(clone)
    if (VOID_TAGS.has(node.tagName)) {
      return
    }
    open.push({ source: node, clone })
    for (const child of node.childNodes) {
      emit(child)
    }
    open.pop()
  }

  for (const child of root.childNodes) {
    emit(child)
  }
  lines.push(current)
  return lines.map((line) => ({
    nodes: [...line.childNodes],
    text: collectText(line),
  }))
}

function pairCodeRuns(raw: readonly CodeOp[]): CodeOp[] {
  const out: CodeOp[] = []
  let index = 0
  while (index < raw.length) {
    const item = raw[index]
    if (item.kind === 'equal') {
      out.push(item)
      index++
      continue
    }
    const left: number[] = []
    const right: number[] = []
    while (index < raw.length && raw[index].kind !== 'equal') {
      if (raw[index].left !== undefined) {
        left.push(raw[index].left as number)
      }
      if (raw[index].right !== undefined) {
        right.push(raw[index].right as number)
      }
      index++
    }
    const count = Math.max(left.length, right.length)
    for (let i = 0; i < count; i++) {
      if (left[i] !== undefined && right[i] !== undefined) {
        out.push({ kind: 'changed', left: left[i], right: right[i] })
      } else if (left[i] !== undefined) {
        out.push({ kind: 'removed', left: left[i] })
      } else if (right[i] !== undefined) {
        out.push({ kind: 'added', right: right[i] })
      }
    }
  }
  return out
}

function alignCodeLines(
  leftTexts: readonly string[],
  rightTexts: readonly string[],
): CodeOp[] {
  const changes = diffArrays([...leftTexts], [...rightTexts]) ?? []
  const raw: CodeOp[] = []
  let leftIndex = 0
  let rightIndex = 0
  for (const change of changes) {
    if (change.removed && !change.added) {
      for (let k = 0; k < change.count; k++) {
        raw.push({ kind: 'removed', left: leftIndex + k })
      }
      leftIndex += change.count
    } else if (change.added && !change.removed) {
      for (let k = 0; k < change.count; k++) {
        raw.push({ kind: 'added', right: rightIndex + k })
      }
      rightIndex += change.count
    } else {
      for (let k = 0; k < change.count; k++) {
        raw.push({
          kind: 'equal',
          left: leftIndex + k,
          right: rightIndex + k,
        })
      }
      leftIndex += change.count
      rightIndex += change.count
    }
  }
  return pairCodeRuns(raw)
}

function codeRoot(pre: Element): Element {
  return firstChildTag(pre, 'code') ?? pre
}

function makeCodeLine(
  line: CodeLine,
  marker: string,
  number: number,
  kind?: 'add' | 'del' | 'changed',
): Element {
  const classes = ['adoc-diff-code-line']
  if (kind) {
    classes.push(`adoc-diff-code-line-${kind}`)
  }
  const span = createElement('span', [
    { name: 'class', value: classes.join(' ') },
    { name: 'data-marker', value: marker },
    { name: 'data-line-number', value: String(number) },
  ])
  for (const node of line.nodes) {
    node.parentNode = span
    span.childNodes.push(node)
  }
  if (span.childNodes.length === 0) {
    appendChild(span, createTextNode('\u00a0'))
  }
  return span
}

function makeCodeGapLine(kind: 'add' | 'del'): Element {
  const span = createElement('span', [
    {
      name: 'class',
      value: `adoc-diff-code-line adoc-diff-code-line-gap adoc-diff-code-line-${kind}`,
    },
    { name: 'data-marker', value: '' },
    { name: 'data-line-number', value: '' },
  ])
  appendChild(span, createTextNode('\u00a0'))
  return span
}

function applyCodeWordDiff(
  leftLine: Element,
  rightLine: Element,
  leftText: string,
  rightText: string,
): void {
  const result = computeInlineDiff(leftText, rightText)
  if (!result) {
    return
  }
  wrapRanges(
    collectInlineTextNodes(leftLine),
    result.left,
    'adoc-diff-word adoc-diff-word-del',
  )
  wrapRanges(
    collectInlineTextNodes(rightLine),
    result.right,
    'adoc-diff-word adoc-diff-word-ins',
  )
}

/**
 * Line-level diff of two rendered `<pre>` blocks. Returns `undefined` when the
 * block is too large and the caller should fall back to the word/block diff.
 */
function diffCodeLines(
  left: Element,
  right: Element,
  ctx: DiffContext,
): boolean | undefined {
  const leftRoot = codeRoot(left)
  const rightRoot = codeRoot(right)
  const leftLines = splitCodeLines(leftRoot)
  const rightLines = splitCodeLines(rightRoot)
  if (leftLines.length + rightLines.length > MAX_CODE_LINES) {
    return undefined
  }
  const ops = alignCodeLines(
    leftLines.map((line) => line.text),
    rightLines.map((line) => line.text),
  )
  if (ops.every((op) => op.kind === 'equal')) {
    // No text change, but the block may have changed otherwise (e.g. language
    // or an attribute): mark it as a modified block.
    markChanged(left)
    markChanged(right)
    ctx.stats.changedBlocks++
    return true
  }

  const leftOut: Element[] = []
  const rightOut: Element[] = []
  let leftNumber = 1
  let rightNumber = 1
  for (const op of ops) {
    if (op.kind === 'equal') {
      leftOut.push(makeCodeLine(leftLines[op.left as number], '', leftNumber++))
      rightOut.push(
        makeCodeLine(rightLines[op.right as number], '', rightNumber++),
      )
    } else if (op.kind === 'changed') {
      const leftLine = leftLines[op.left as number]
      const rightLine = rightLines[op.right as number]
      const leftElement = makeCodeLine(leftLine, '~', leftNumber++, 'changed')
      const rightElement = makeCodeLine(
        rightLine,
        '~',
        rightNumber++,
        'changed',
      )
      applyCodeWordDiff(
        leftElement,
        rightElement,
        leftLine.text,
        rightLine.text,
      )
      leftOut.push(leftElement)
      rightOut.push(rightElement)
    } else if (op.kind === 'removed') {
      leftOut.push(
        makeCodeLine(leftLines[op.left as number], '−', leftNumber++, 'del'),
      )
      rightOut.push(makeCodeGapLine('del'))
    } else {
      rightOut.push(
        makeCodeLine(rightLines[op.right as number], '+', rightNumber++, 'add'),
      )
      leftOut.push(makeCodeGapLine('add'))
    }
  }

  leftRoot.childNodes = leftOut
  rightRoot.childNodes = rightOut
  for (const line of leftOut) {
    line.parentNode = leftRoot
  }
  for (const line of rightOut) {
    line.parentNode = rightRoot
  }
  addClass(left, 'adoc-diff-code')
  addClass(right, 'adoc-diff-code')
  ctx.stats.changedBlocks++
  return true
}

function diffVerbatim(
  left: Element,
  right: Element,
  ctx: DiffContext,
): boolean {
  if (subtreesEqual(left, right)) {
    return false
  }
  if (ctx.options.codeBlocks === 'line') {
    const lineDiff = diffCodeLines(left, right, ctx)
    if (lineDiff !== undefined) {
      return lineDiff
    }
  }
  const leftText = collectText(left)
  const rightText = collectText(right)
  if (leftText.replace(/\s+/g, '') === rightText.replace(/\s+/g, '')) {
    markChanged(left)
    markChanged(right)
    ctx.stats.changedBlocks++
    return true
  }
  const changed = diffInlineTextNodes(left, right, ctx)
  if (!changed) {
    markChanged(left)
    markChanged(right)
    ctx.stats.changedBlocks++
  }
  return true
}

function assignAnchor(left: Element, right: Element, ctx: DiffContext): void {
  const id = `a${ctx.nextAnchor++}`
  setAttribute(left, 'data-adoc-diff-anchor', id)
  setAttribute(right, 'data-adoc-diff-anchor', id)
}

function dataLineSpan(el: Element): number {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  walk(el, (node) => {
    if (!isElement(node)) {
      return
    }
    const line = dataLineOf(node)
    if (line === undefined) {
      return
    }
    min = Math.min(min, line)
    max = Math.max(max, line)
  })
  return max >= min ? max - min + 1 : 0
}

function estimateBlockLines(el: Element): number {
  if (isDataTable(el)) {
    return rowsOf(el).length
  }
  const text = collectText(el).trim()
  if (text === '') {
    return dataLineSpan(el)
  }
  const textLines = isVerbatim(el)
    ? text.split('\n').length
    : Math.max(1, Math.ceil(text.length / 90))
  // A list or a section with many short items may have little text but many
  // source lines; the `data-line-*` span is a better estimate of its height.
  return Math.max(textLines, dataLineSpan(el))
}

function shouldCollapse(el: Element, options: DiffRenderOptions): boolean {
  if (options.deletedBlocks !== 'collapse') {
    return false
  }
  // Collapsing a table with a fixed height hides its borders/frame
  // unpredictably; keep deleted tables visible (with a gap on the other side).
  if (isDataTable(el)) {
    return false
  }
  return estimateBlockLines(el) > options.collapseLines
}

function collapseBlock(el: Element, ctx: DiffContext): void {
  addClass(el, 'adoc-diff-collapsed')
  setAttribute(el, 'data-adoc-diff-collapsed', `c${ctx.nextCollapse++}`)
  setAttribute(
    el,
    'data-adoc-diff-collapse-lines',
    String(estimateBlockLines(el)),
  )
}

function addGapMarker(el: Element, attribute: string, kind: string): void {
  const existing = getAttribute(el, attribute)
  if (existing === undefined) {
    setAttribute(el, attribute, kind)
  } else if (existing !== kind) {
    setAttribute(el, attribute, 'mixed')
  }
}

function markGap(
  side: 'left' | 'right',
  parent: Element,
  nextPaired: Alignment | undefined,
  previousPaired: Alignment | undefined,
  kind: string,
): void {
  const nextElement = side === 'left' ? nextPaired?.left : nextPaired?.right
  if (nextElement) {
    addGapMarker(nextElement, 'data-adoc-diff-gap', kind)
    return
  }
  const previousElement =
    side === 'left' ? previousPaired?.left : previousPaired?.right
  if (previousElement) {
    addGapMarker(previousElement, 'data-adoc-diff-gap-after', kind)
    return
  }
  addGapMarker(parent, 'data-adoc-diff-gap-after', kind)
}

/**
 * Handles a run of blocks that exist on one side only.
 *
 * - Short removed blocks stay visible (red) and the other side receives a gap.
 * - Long removed blocks are collapsed into a `−N` strip; they keep zero height,
 *   so the other side needs no gap. Expanding one is a client-side toggle and
 *   the residual alignment pass adds the needed space again.
 * - Added blocks always stay visible (green) and the old side receives a gap.
 */
function processUnmatchedRun(
  run: readonly Alignment[],
  nextPaired: Alignment | undefined,
  previousPaired: Alignment | undefined,
  leftParent: Element,
  rightParent: Element,
  ctx: DiffContext,
): boolean {
  const leftOnly: Element[] = []
  const rightOnly: Element[] = []
  for (const item of run) {
    if (item.left) {
      markWhole(item.left, 'left')
      ctx.stats.removedBlocks++
      leftOnly.push(item.left)
    } else if (item.right) {
      markWhole(item.right, 'right')
      ctx.stats.addedBlocks++
      rightOnly.push(item.right)
    }
  }

  const visibleLeft: Element[] = []
  for (const el of leftOnly) {
    if (ctx.options.align && shouldCollapse(el, ctx.options)) {
      collapseBlock(el, ctx)
    } else {
      visibleLeft.push(el)
    }
  }

  if (ctx.options.align && rightOnly.length > 0) {
    markGap('left', leftParent, nextPaired, previousPaired, 'ins')
  }
  if (ctx.options.align && visibleLeft.length > 0) {
    markGap('right', rightParent, nextPaired, previousPaired, 'del')
  }
  return leftOnly.length > 0 || rightOnly.length > 0
}

function alignBlockChildren(
  left: Element,
  right: Element,
  ctx: DiffContext,
): boolean {
  const pairs = alignElements(blockChildren(left), blockChildren(right))
  // Anchors are assigned before recursion so every matched block participates
  // in the client-side measurement, including unchanged blocks between two
  // changes.
  if (ctx.options.align) {
    for (const pair of pairs) {
      if (pair.left && pair.right) {
        assignAnchor(pair.left, pair.right, ctx)
      }
    }
  }

  let changed = false
  let previousPaired: Alignment | undefined
  let index = 0
  while (index < pairs.length) {
    const pair = pairs[index]
    if (pair.left && pair.right) {
      if (pair.unchanged) {
        collectLinePairs(pair.left, pair.right, ctx)
      } else if (diffElement(pair.left, pair.right, ctx)) {
        changed = true
      }
      previousPaired = pair
      index++
      continue
    }

    const runStart = index
    while (index < pairs.length && !(pairs[index].left && pairs[index].right)) {
      index++
    }
    const run = pairs.slice(runStart, index)
    if (
      processUnmatchedRun(run, pairs[index], previousPaired, left, right, ctx)
    ) {
      changed = true
    }
  }
  return changed
}

interface ColumnPair {
  readonly left?: number
  readonly right?: number
}

interface TableCellInfo {
  readonly element: Element
  readonly row: number
  readonly colStart: number
  readonly colEnd: number
  readonly rowEnd: number
}

interface TableModel {
  readonly rows: readonly Element[]
  readonly cells: readonly TableCellInfo[]
  readonly grid: (TableCellInfo | undefined)[][]
  readonly columns: number
}

function buildTableModel(table: Element): TableModel {
  const rows = rowsOf(table)
  const grid: (TableCellInfo | undefined)[][] = []
  const cells: TableCellInfo[] = []
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    grid[rowIndex] ??= []
    const row = rows[rowIndex]
    let column = 0
    for (const element of cellsOf(row)) {
      while (grid[rowIndex][column] !== undefined) {
        column++
      }
      const colspan = Math.max(1, Number(attributeOf(element, 'colspan') || 1))
      const rowspan = Math.max(1, Number(attributeOf(element, 'rowspan') || 1))
      const cell: TableCellInfo = {
        element,
        row: rowIndex,
        colStart: column,
        colEnd: column + colspan,
        rowEnd: Math.min(rows.length, rowIndex + rowspan),
      }
      for (let r = rowIndex; r < cell.rowEnd; r++) {
        grid[r] ??= []
        for (let c = column; c < cell.colEnd; c++) {
          grid[r][c] = cell
        }
      }
      cells.push(cell)
      column += colspan
    }
  }
  let columns = 0
  for (const row of grid) {
    columns = Math.max(columns, row.length)
  }
  for (const cell of cells) {
    columns = Math.max(columns, cell.colEnd)
  }
  return { rows, cells, grid, columns }
}

function columnSignature(model: TableModel, index: number): string {
  return model.grid
    .map((row) => {
      const cell = row[index]
      return cell ? elementText(cell.element) : ''
    })
    .join('\u0001')
}

function pairColumnRuns(raw: readonly ColumnPair[]): ColumnPair[] {
  const out: ColumnPair[] = []
  let index = 0
  while (index < raw.length) {
    const item = raw[index]
    if (item.left !== undefined && item.right !== undefined) {
      out.push(item)
      index++
      continue
    }
    const left: number[] = []
    const right: number[] = []
    while (
      index < raw.length &&
      !(raw[index].left !== undefined && raw[index].right !== undefined)
    ) {
      if (raw[index].left !== undefined) {
        left.push(raw[index].left as number)
      }
      if (raw[index].right !== undefined) {
        right.push(raw[index].right as number)
      }
      index++
    }
    const count = Math.max(left.length, right.length)
    for (let i = 0; i < count; i++) {
      out.push({ left: left[i], right: right[i] })
    }
  }
  return out
}

function alignColumnIndices(
  leftSignatures: readonly string[],
  rightSignatures: readonly string[],
): ColumnPair[] {
  const changes = diffArrays([...leftSignatures], [...rightSignatures]) ?? []
  const raw: ColumnPair[] = []
  let leftIndex = 0
  let rightIndex = 0
  for (const change of changes) {
    if (change.removed && !change.added) {
      for (let k = 0; k < change.count; k++) {
        raw.push({ left: leftIndex + k })
      }
      leftIndex += change.count
    } else if (change.added && !change.removed) {
      for (let k = 0; k < change.count; k++) {
        raw.push({ right: rightIndex + k })
      }
      rightIndex += change.count
    } else {
      for (let k = 0; k < change.count; k++) {
        raw.push({
          left: leftIndex + k,
          right: rightIndex + k,
        })
      }
      leftIndex += change.count
      rightIndex += change.count
    }
  }
  // A changed column is a replacement, not a removal plus an addition: pair
  // the one-sided entries of each run by order.
  return pairColumnRuns(raw)
}

function createColumnGapCell(row: Element, kind: string, colspan = 1): Element {
  const section = row.parentNode as ChildNode | null
  const tag =
    section && isElement(section) && section.tagName === 'thead' ? 'th' : 'td'
  return createElement(tag, [
    {
      name: 'class',
      value: `tableblock adoc-diff-col-gap adoc-diff-gap-${kind}`,
    },
    { name: 'colspan', value: String(colspan) },
    { name: 'aria-hidden', value: 'true' },
  ])
}

/**
 * Rebuilds one table so its cells follow the union column order. A column that
 * exists only on this side is marked as added/removed content; a column that
 * exists only on the other side becomes an empty gap cell here.
 */
function rebuildTableColumns(
  table: Element,
  model: TableModel,
  columns: readonly ColumnPair[],
  side: 'left' | 'right',
  otherWidths: readonly string[],
): boolean {
  const widths = columnWidths(table)
  let structural = columns.some(
    (column) => column.left === undefined || column.right === undefined,
  )

  for (let rowIndex = 0; rowIndex < model.rows.length; rowIndex++) {
    const entries = columns.map((column) => {
      const index = side === 'left' ? column.left : column.right
      return index === undefined ? undefined : model.grid[rowIndex]?.[index]
    })

    // A cell anchored in this row may span several union columns. Group its
    // mapped columns; a placeholder column inserted inside the span becomes a
    // part of the span (`colspan` grows) rather than a separate cell.
    const groups = new Map<Element, { first: number; last: number }>()
    for (let index = 0; index < columns.length; index++) {
      const cell = entries[index]
      if (!cell || cell.row !== rowIndex) {
        continue
      }
      const group = groups.get(cell.element) ?? {
        first: index,
        last: index,
      }
      group.first = Math.min(group.first, index)
      group.last = Math.max(group.last, index)
      groups.set(cell.element, group)
    }

    const output: Element[] = []
    let index = 0
    while (index < columns.length) {
      const cell = entries[index]
      if (cell && cell.row === rowIndex) {
        const group = groups.get(cell.element)
        if (group && group.first === index) {
          const span = group.last - group.first + 1
          if (span > 1) {
            setAttribute(cell.element, 'colspan', String(span))
          } else if (getAttribute(cell.element, 'colspan') !== undefined) {
            removeAttribute(cell.element, 'colspan')
          }
          for (let i = group.first; i <= group.last; i++) {
            if (
              columns[i].left === undefined ||
              columns[i].right === undefined
            ) {
              addClass(
                cell.element,
                side === 'left' ? 'adoc-diff-cell-del' : 'adoc-diff-cell-ins',
              )
            }
          }
          output.push(cell.element)
          index = group.last + 1
        } else {
          index++
        }
        continue
      }
      if (cell && cell.row !== rowIndex) {
        // Filled by a rowspan from an earlier row; the anchored cell is emitted
        // there, with its colspan already covering this position.
        index++
        continue
      }

      // A run of columns that neither this row nor a rowspan covers.
      let end = index
      while (end < columns.length) {
        const next = entries[end]
        if (next) {
          break
        }
        end++
      }
      const count = end - index
      if (count <= 0) {
        index++
        continue
      }
      const kind =
        columns[index].left === undefined
          ? 'ins'
          : columns[index].right === undefined
            ? 'del'
            : 'mixed'
      output.push(createColumnGapCell(model.rows[rowIndex], kind, count))
      structural = true
      index = end
    }

    const row = model.rows[rowIndex]
    row.childNodes = output
    for (const cell of output) {
      cell.parentNode = row
    }
  }

  const oldColgroups = table.childNodes.filter(
    (child) => isElement(child) && child.tagName === 'colgroup',
  )
  table.childNodes = table.childNodes.filter(
    (child) => !oldColgroups.includes(child),
  )
  const colgroup = createElement('colgroup')
  for (const column of columns) {
    const ownIndex = side === 'left' ? column.left : column.right
    const otherIndex = side === 'left' ? column.right : column.left
    const width =
      (ownIndex !== undefined ? widths[ownIndex] : undefined) ||
      (otherIndex !== undefined ? otherWidths[otherIndex] : undefined)
    const col = createElement(
      'col',
      width === undefined || width === ''
        ? []
        : [{ name: 'width', value: width }],
    )
    if (column.left === undefined || column.right === undefined) {
      addClass(col, 'adoc-diff-col-gap')
    }
    appendChild(colgroup, col)
  }
  const caption = firstChildTag(table, 'caption')
  const insertIndex = caption ? table.childNodes.indexOf(caption) + 1 : 0
  colgroup.parentNode = table
  table.childNodes.splice(insertIndex, 0, colgroup)
  return structural
}

function findTableSection(
  table: Element,
  tag: 'thead' | 'tbody' | 'tfoot',
): Element | undefined {
  for (const child of table.childNodes) {
    if (isElement(child) && child.tagName === tag) {
      return child
    }
  }
  return undefined
}

function ensureTableSection(
  table: Element,
  tag: 'thead' | 'tbody' | 'tfoot',
): Element {
  const existing = findTableSection(table, tag)
  if (existing) {
    return existing
  }
  const section = createElement(tag)
  appendChild(table, section)
  return section
}

function nextRowOnSide(
  pairs: readonly Alignment[],
  start: number,
  side: 'left' | 'right',
): Element | undefined {
  for (let i = start + 1; i < pairs.length; i++) {
    const row = side === 'left' ? pairs[i].left : pairs[i].right
    if (row) {
      return row
    }
  }
  return undefined
}

function insertRowPlaceholder(
  targetTable: Element,
  nextTargetRow: Element | undefined,
  sourceRow: Element,
  columns: number,
  kind: 'ins' | 'del',
): void {
  const sourceSection = sourceRow.parentNode as ChildNode | null
  const sectionTag =
    sourceSection &&
    isElement(sourceSection) &&
    (sourceSection.tagName === 'thead' ||
      sourceSection.tagName === 'tbody' ||
      sourceSection.tagName === 'tfoot')
      ? sourceSection.tagName
      : 'tbody'
  const section =
    nextTargetRow && sectionTag === 'tbody'
      ? (nextTargetRow.parentNode as Element)
      : ensureTableSection(targetTable, sectionTag)
  const row = createElement('tr', [
    {
      name: 'class',
      value: `adoc-diff-row-gap adoc-diff-gap-${kind}`,
    },
    { name: 'data-adoc-diff-row-gap', value: kind },
  ])
  const cell = createElement(sectionTag === 'thead' ? 'th' : 'td', [
    {
      name: 'class',
      value: 'tableblock adoc-diff-row-gap-cell',
    },
    { name: 'colspan', value: String(Math.max(1, columns)) },
    { name: 'aria-hidden', value: 'true' },
  ])
  appendChild(row, cell)
  const index =
    nextTargetRow && nextTargetRow.parentNode === section
      ? section.childNodes.indexOf(nextTargetRow)
      : section.childNodes.length
  row.parentNode = section
  section.childNodes.splice(index, 0, row)
}

function diffTable(left: Element, right: Element, ctx: DiffContext): boolean {
  if (!ctx.options.align) {
    return diffTablePlain(left, right, ctx)
  }
  recordLinePair(left, right, ctx)
  ctx.stats.changedTables++

  const leftModel = buildTableModel(left)
  const rightModel = buildTableModel(right)
  const gridId = `g${ctx.nextTable++}`
  setAttribute(left, 'data-adoc-diff-grid', gridId)
  setAttribute(right, 'data-adoc-diff-grid', gridId)

  const leftSignatures = Array.from({ length: leftModel.columns }, (_, index) =>
    columnSignature(leftModel, index),
  )
  const rightSignatures = Array.from(
    { length: rightModel.columns },
    (_, index) => columnSignature(rightModel, index),
  )
  const columnPairs = alignColumnIndices(leftSignatures, rightSignatures)
  const leftWidths = columnWidths(left)
  const rightWidths = columnWidths(right)
  const leftStructural = rebuildTableColumns(
    left,
    leftModel,
    columnPairs,
    'left',
    rightWidths,
  )
  const rightStructural = rebuildTableColumns(
    right,
    rightModel,
    columnPairs,
    'right',
    leftWidths,
  )
  let structural = leftStructural || rightStructural

  diffCaption(left, right, ctx)

  const leftRows = rowsOf(left)
  const rightRows = rowsOf(right)
  const pairs = alignElements(leftRows, rightRows)
  const leftAfter = buildTableModel(left)
  const rightAfter = buildTableModel(right)
  const leftRowIndex = new Map(leftAfter.rows.map((row, index) => [row, index]))
  const rightRowIndex = new Map(
    rightAfter.rows.map((row, index) => [row, index]),
  )

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]
    if (pair.left && pair.right) {
      if (!pair.unchanged) {
        const row = diffRowGrid(
          leftAfter,
          leftRowIndex.get(pair.left) as number,
          rightAfter,
          rightRowIndex.get(pair.right) as number,
          columnPairs.length,
          ctx,
        )
        if (row.structural) {
          structural = true
        }
      }
    } else if (pair.left) {
      addClass(pair.left, 'adoc-diff-row-del')
      ctx.stats.removedBlocks++
      structural = true
      insertRowPlaceholder(
        right,
        nextRowOnSide(pairs, i, 'right'),
        pair.left,
        columnPairs.length,
        'del',
      )
    } else if (pair.right) {
      addClass(pair.right, 'adoc-diff-row-ins')
      ctx.stats.addedBlocks++
      structural = true
      insertRowPlaceholder(
        left,
        nextRowOnSide(pairs, i, 'left'),
        pair.right,
        columnPairs.length,
        'ins',
      )
    }
  }

  if (structural) {
    addClass(left, 'adoc-diff-table-del')
    addClass(right, 'adoc-diff-table-ins')
  }
  return true
}

interface RowDiff {
  changed: boolean
  structural: boolean
}

function diffRowGrid(
  leftModel: TableModel,
  leftRowIndex: number,
  rightModel: TableModel,
  rightRowIndex: number,
  columnCount: number,
  ctx: DiffContext,
): RowDiff {
  let changed = false
  let structural = false
  const seenLeft = new Set<Element>()
  const seenRight = new Set<Element>()
  for (let column = 0; column < columnCount; column++) {
    const leftCell = leftModel.grid[leftRowIndex]?.[column]
    const rightCell = rightModel.grid[rightRowIndex]?.[column]
    if (!leftCell && !rightCell) {
      continue
    }
    if (
      (leftCell && leftCell.row !== leftRowIndex) ||
      (rightCell && rightCell.row !== rightRowIndex)
    ) {
      // A rowspan from an earlier row. A difference in rowspan structure is a
      // structural change; the content itself was compared at its anchor row.
      if (Boolean(leftCell) !== Boolean(rightCell)) {
        structural = true
      }
      continue
    }
    if (!leftCell || !rightCell) {
      structural = true
      continue
    }
    if (seenLeft.has(leftCell.element) || seenRight.has(rightCell.element)) {
      if (seenLeft.has(leftCell.element) !== seenRight.has(rightCell.element)) {
        structural = true
      }
      continue
    }
    seenLeft.add(leftCell.element)
    seenRight.add(rightCell.element)
    if (
      hasClass(leftCell.element, 'adoc-diff-col-gap') ||
      hasClass(rightCell.element, 'adoc-diff-col-gap')
    ) {
      continue
    }
    if (cellAttributesDiffer(leftCell.element, rightCell.element)) {
      structural = true
    }
    if (diffElement(leftCell.element, rightCell.element, ctx)) {
      markCellChanged(leftCell.element)
      markCellChanged(rightCell.element)
      ctx.stats.changedCells++
      changed = true
    }
  }
  return { changed, structural }
}

function diffTablePlain(
  left: Element,
  right: Element,
  ctx: DiffContext,
): boolean {
  recordLinePair(left, right, ctx)
  ctx.stats.changedTables++
  const leftModel = buildTableModel(left)
  const rightModel = buildTableModel(right)
  let structural = leftModel.columns !== rightModel.columns

  diffCaption(left, right, ctx)

  const pairs = alignElements(rowsOf(left), rowsOf(right))
  for (const pair of pairs) {
    if (pair.left && pair.right) {
      if (!pair.unchanged) {
        if (diffRowPlain(pair.left, pair.right, ctx)) {
          structural = true
        }
      }
    } else if (pair.left) {
      addClass(pair.left, 'adoc-diff-row-del')
      ctx.stats.removedBlocks++
      structural = true
    } else if (pair.right) {
      addClass(pair.right, 'adoc-diff-row-ins')
      ctx.stats.addedBlocks++
      structural = true
    }
  }

  if (structural) {
    addClass(left, 'adoc-diff-table-del')
    addClass(right, 'adoc-diff-table-ins')
  }
  return true
}

function diffRowPlain(
  left: Element,
  right: Element,
  ctx: DiffContext,
): boolean {
  const leftCells = cellsOf(left)
  const rightCells = cellsOf(right)
  let changed = leftCells.length !== rightCells.length
  const count = Math.max(leftCells.length, rightCells.length)
  for (let index = 0; index < count; index++) {
    const leftCell = leftCells[index]
    const rightCell = rightCells[index]
    if (leftCell && rightCell) {
      if (diffElement(leftCell, rightCell, ctx)) {
        markCellChanged(leftCell)
        markCellChanged(rightCell)
        ctx.stats.changedCells++
        changed = true
      }
    } else if (leftCell) {
      addClass(leftCell, 'adoc-diff-cell-del')
      ctx.stats.removedBlocks++
      changed = true
    } else if (rightCell) {
      addClass(rightCell, 'adoc-diff-cell-ins')
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
