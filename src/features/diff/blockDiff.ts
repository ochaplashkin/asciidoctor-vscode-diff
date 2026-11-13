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
import {
  type NonVisualChangeKind,
  navigationSignature,
  nonVisualKinds,
  ownNonVisualKinds,
  subtreeSignature,
  subtreesEqual,
  visualClasses,
} from './normalizeHtml.js'

export interface DiffStats {
  /**
   * Number of change regions ("hunks") the reviewer can navigate, the single
   * source of truth for the status. A hunk is one changed block pair, one
   * continuous run of added/removed blocks, one changed table row (or one
   * structural table change), one continuous run of changed code lines, or one
   * formatting/link/id-only change.
   */
  changes: number
  /** Hunks that change what is rendered (the `adoc-diff-*` visual markers). */
  visualChanges: number
  /** Hunks that only change formatting, a link target or an anchor id. */
  nonVisualChanges: number
  addedBlocks: number
  removedBlocks: number
  /** Blocks that exist on both sides but moved to another position. */
  movedBlocks: number
  changedBlocks: number
  changedTables: number
  changedCells: number
  /** Non-visual detail: blocks with a formatting-only change. */
  formattingChanges: number
  /** Non-visual detail: blocks whose link target changed. */
  linkChanges: number
  /** Non-visual detail: blocks whose anchor id changed. */
  idChanges: number
  /**
   * Changes that only affect the generated table of contents (for example
   * `:toclevels:`). It is not a hunk: the TOC is not a content region and is
   * not aligned or navigated, but a TOC-only change must not be reported as
   * "No differences".
   */
  navigationChanges: number
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
  nextHunk: number
  /** Depth of table cells being compared; a cell belongs to one row hunk. */
  cellDepth: number
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

function hasHunk(el: Element): boolean {
  return getAttribute(el, 'data-adoc-diff-hunk') !== undefined
}

/**
 * Starts a hunk: a change region the reviewer can navigate. The host and the
 * client both count hunks, not markers, so one changed cell, one table row or
 * one run of code lines is exactly one change.
 */
function beginHunk(ctx: DiffContext, kind: 'visual' | 'nonvisual'): string {
  ctx.stats.changes++
  if (kind === 'visual') {
    ctx.stats.visualChanges++
  } else {
    ctx.stats.nonVisualChanges++
  }
  return `h${ctx.nextHunk++}`
}

function markHunk(
  ctx: DiffContext,
  kind: 'visual' | 'nonvisual',
  left?: Element,
  right?: Element,
): string {
  const id = beginHunk(ctx, kind)
  if (left) {
    assignHunk(left, id)
  }
  if (right) {
    assignHunk(right, id)
  }
  return id
}

/**
 * Assigns a hunk id unless the element already carries one. A gap marker can
 * land on an element that is itself a change target (the next matched block);
 * the original hunk wins, and the gap keeps its visible space.
 */
function assignHunk(el: Element, id: string): void {
  if (!hasHunk(el)) {
    setAttribute(el, 'data-adoc-diff-hunk', id)
  }
}

/**
 * Marks a visual hunk unless the element is inside a table cell: the table row
 * is the navigation unit there, so cells must not add their own hunks.
 */
function markVisualHunk(
  ctx: DiffContext,
  left?: Element,
  right?: Element,
): void {
  if (ctx.cellDepth > 0) {
    return
  }
  markHunk(ctx, 'visual', left, right)
}

/**
 * Where the non-visual badge is rendered. A `<tr>` cannot be positioned
 * reliably, so the badge goes on its first cell instead.
 */
function nonVisualTarget(el: Element): Element {
  if (el.tagName === 'tr') {
    return cellsOf(el)[0] ?? el
  }
  return el
}

function markNonVisualBadge(
  left: Element,
  right: Element,
  kinds: ReadonlySet<NonVisualChangeKind>,
): void {
  const kind: NonVisualChangeKind = kinds.has('id')
    ? 'id'
    : kinds.has('link')
      ? 'link'
      : 'formatting'
  const leftTarget = nonVisualTarget(left)
  const rightTarget = nonVisualTarget(right)
  setAttribute(leftTarget, 'data-adoc-diff-nonvisual', kind)
  if (rightTarget !== leftTarget) {
    setAttribute(rightTarget, 'data-adoc-diff-nonvisual', kind)
  }
}

function countNonVisualKinds(
  ctx: DiffContext,
  kinds: ReadonlySet<NonVisualChangeKind>,
): void {
  if (kinds.has('formatting')) {
    ctx.stats.formattingChanges++
  }
  if (kinds.has('link')) {
    ctx.stats.linkChanges++
  }
  if (kinds.has('id')) {
    ctx.stats.idChanges++
  }
}

/**
 * The non-visual kinds of the element and of its inline content, ignoring
 * block descendants: those are compared on their own, so a badge on an outer
 * container must not repeat a change that is already marked deeper.
 */
function inlineNonVisualKinds(
  left: Element,
  right: Element,
): Set<NonVisualChangeKind> {
  const kinds = new Set<NonVisualChangeKind>()
  if (left.tagName !== right.tagName) {
    kinds.add('formatting')
  }
  for (const kind of ownNonVisualKinds(left, right)) {
    kinds.add(kind)
  }
  const visit = (leftNode: Element, rightNode: Element): void => {
    const leftChildren = leftNode.childNodes
    const rightChildren = rightNode.childNodes
    if (leftChildren.length !== rightChildren.length) {
      kinds.add('formatting')
      return
    }
    for (let index = 0; index < leftChildren.length; index++) {
      const leftChild = leftChildren[index]
      const rightChild = rightChildren[index]
      if (isElement(leftChild) && isElement(rightChild)) {
        if (BLOCK_TAGS.has(leftChild.tagName)) {
          continue
        }
        for (const kind of ownNonVisualKinds(leftChild, rightChild)) {
          kinds.add(kind)
        }
        visit(leftChild, rightChild)
      } else if (isElement(leftChild) !== isElement(rightChild)) {
        kinds.add('formatting')
      }
    }
  }
  visit(left, right)
  return kinds
}

/**
 * Reports a formatting/link/id-only difference in a subtree whose rendered
 * content is unchanged. Returns whether anything was marked.
 */
function diffNonVisual(
  left: Element,
  right: Element,
  ctx: DiffContext,
): boolean {
  if (hasHunk(left) || hasHunk(right)) {
    return false
  }
  const inline = inlineNonVisualKinds(left, right)
  let marked = false
  if (inline.size > 0) {
    markNonVisualBadge(left, right, inline)
    countNonVisualKinds(ctx, inline)
    markHunk(ctx, 'nonvisual', left, right)
    marked = true
  }
  const leftBlocks = blockChildren(left)
  const rightBlocks = blockChildren(right)
  if (leftBlocks.length === rightBlocks.length) {
    for (let index = 0; index < leftBlocks.length; index++) {
      if (diffNonVisual(leftBlocks[index], rightBlocks[index], ctx)) {
        marked = true
      }
    }
  }
  return marked
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
    changes: 0,
    visualChanges: 0,
    nonVisualChanges: 0,
    addedBlocks: 0,
    removedBlocks: 0,
    movedBlocks: 0,
    changedBlocks: 0,
    changedTables: 0,
    changedCells: 0,
    formattingChanges: 0,
    linkChanges: 0,
    idChanges: 0,
    navigationChanges: 0,
  }
  const ctx: DiffContext = {
    stats,
    lineMap: [],
    options,
    nextAnchor: 0,
    nextCollapse: 0,
    nextTable: 0,
    nextHunk: 0,
    cellDepth: 0,
  }
  if (subtreesEqual(leftRoot, rightRoot)) {
    // The rendered content is identical, but formatting, link targets and
    // anchor ids are not part of the visual signature: report them instead of
    // claiming that there is no difference at all.
    diffNonVisual(leftRoot, rightRoot, ctx)
    collectLinePairs(leftRoot, rightRoot, ctx)
  } else {
    diffElement(leftRoot, rightRoot, ctx)
  }
  reportNavigationChange(leftRoot, rightRoot, ctx)
  markChangeIcons(leftRoot)
  markChangeIcons(rightRoot)
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
  return stats.changes > 0
}

/**
 * Adds the left-margin icon only to changed blocks that have no finer marker
 * already: `adoc-diff-word` highlights a text change word by word and
 * `adoc-diff-code-line-*` marks the changed code lines, so an icon would be
 * redundant there. Media blocks, formulas and structural table changes keep
 * the icon because there is no text to point at.
 */
function markChangeIcons(root: Element): void {
  const inlineMarkerAncestors = new Set<Element>()
  walk(root, (node) => {
    if (!isElement(node)) {
      return
    }
    const marked = getClasses(node).some(
      (className) =>
        className === 'adoc-diff-word' ||
        className === 'adoc-diff-code-line-changed' ||
        className === 'adoc-diff-code-line-add' ||
        className === 'adoc-diff-code-line-del',
    )
    if (!marked) {
      return
    }
    let parent = node.parentNode
    while (parent !== null && 'tagName' in parent) {
      const element = parent as unknown as Element
      inlineMarkerAncestors.add(element)
      parent = element.parentNode
    }
  })
  walk(root, (node) => {
    if (
      !isElement(node) ||
      inlineMarkerAncestors.has(node) ||
      (!hasClass(node, 'adoc-diff-block-changed') &&
        getAttribute(node, 'data-adoc-diff-media-changed') === undefined)
    ) {
      return
    }
    setAttribute(node, 'data-adoc-diff-icon', '')
  })
}

function findGeneratedToc(root: Element): Element | undefined {
  let found: Element | undefined
  walk(root, (node) => {
    if (
      found === undefined &&
      isElement(node) &&
      getAttribute(node, 'id') === 'toc'
    ) {
      found = node
    }
  })
  return found
}

/**
 * Compares the two generated tables of contents, which `blockChildren` skips.
 * A TOC-only change (different `:toclevels:`, a different TOC structure) is not
 * a content hunk but is a real navigation difference; mark it so the status can
 * say it instead of claiming that nothing changed.
 */
function reportNavigationChange(
  leftRoot: Element,
  rightRoot: Element,
  ctx: DiffContext,
): void {
  const leftToc = findGeneratedToc(leftRoot)
  const rightToc = findGeneratedToc(rightRoot)
  if (leftToc === undefined && rightToc === undefined) {
    return
  }
  const same =
    leftToc !== undefined &&
    rightToc !== undefined &&
    navigationSignature(leftToc) === navigationSignature(rightToc)
  if (same) {
    return
  }
  ctx.stats.navigationChanges = 1
  for (const toc of [leftToc, rightToc]) {
    if (toc !== undefined) {
      addClass(toc, 'adoc-diff-navigation-changed')
      setAttribute(toc, 'data-adoc-diff-navigation', 'changed')
    }
  }
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

/**
 * The table of contents is generated from the headings: it is navigation, not
 * a second copy of the content. Diffing it counts every heading change twice,
 * adds gap markers inside the navigation, and lets those anchors take part in
 * the alignment of the two panes.
 */
function isGeneratedNavigation(el: Element): boolean {
  return getAttribute(el, 'id') === 'toc'
}

function blockChildren(el: Element): Element[] {
  const out: Element[] = []
  for (const child of el.childNodes) {
    if (
      isElement(child) &&
      BLOCK_TAGS.has(child.tagName) &&
      !isGeneratedNavigation(child)
    ) {
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
/**
 * Whether two blocks play the same structural role: same tag, and at least one
 * shared visual class for containers. Pairing by tag alone would pair a
 * `div.listingblock` with a `div.paragraph` when a code block is replaced by
 * prose, hide the removed code block inside a line diff, and leave the short
 * block next to it unpaired.
 */
function sameBlockRole(left: Element, right: Element): boolean {
  if (left.tagName !== right.tagName) {
    return false
  }
  const leftContainer = blockChildren(left).length > 0
  const rightContainer = blockChildren(right).length > 0
  if (!leftContainer && !rightContainer) {
    return true
  }
  const leftClasses = visualClasses(left)
  const rightClasses = visualClasses(right)
  if (leftClasses.length === 0 || rightClasses.length === 0) {
    return true
  }
  return leftClasses.some((className) => rightClasses.includes(className))
}

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
  const paired = new Map<Element, Element>()
  const usedAdded = new Set<number>()

  // Pair by content first. When an item is inserted in the middle of a list,
  // pairing the first unused same-tag block by position pairs the changed item
  // with the inserted one and shifts every following item, which paints whole
  // lists and nested blocks as removed/added. Similarity keeps "two" paired with
  // "two" and leaves "inserted" as the one-sided addition.
  const candidates: Array<{
    leftIndex: number
    rightIndex: number
    score: number
  }> = []
  for (let leftIndex = 0; leftIndex < removed.length; leftIndex++) {
    for (let rightIndex = 0; rightIndex < added.length; rightIndex++) {
      if (
        !sameBlockRole(removed[leftIndex], added[rightIndex]) ||
        !canPairPositionally(removed[leftIndex], added[rightIndex])
      ) {
        continue
      }
      const score = textSimilarity(
        elementText(removed[leftIndex]),
        elementText(added[rightIndex]),
      )
      if (score >= SIMILARITY_THRESHOLD) {
        candidates.push({ leftIndex, rightIndex, score })
      }
    }
  }
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.leftIndex - b.leftIndex ||
      a.rightIndex - b.rightIndex,
  )
  for (const candidate of candidates) {
    const leftEl = removed[candidate.leftIndex]
    if (paired.has(leftEl) || usedAdded.has(candidate.rightIndex)) {
      continue
    }
    usedAdded.add(candidate.rightIndex)
    paired.set(leftEl, added[candidate.rightIndex])
  }

  // One-to-one replacements that share no word (a short `2` -> `3`, a table
  // cell `one` -> `second`) are still paired positionally. Do this only when
  // the leftover counts match, so an insertion/deletion cannot shift the rest.
  const remainingLeft = removed.filter((el) => !paired.has(el))
  const remainingAdded = added.filter((_, index) => !usedAdded.has(index))
  if (remainingLeft.length === remainingAdded.length) {
    const freeAdded = new Set(remainingAdded.map((_, index) => index))
    for (const leftEl of remainingLeft) {
      const candidate = remainingAdded.findIndex(
        (rightEl, index) =>
          freeAdded.has(index) &&
          sameBlockRole(leftEl, rightEl) &&
          canPairPositionally(leftEl, rightEl),
      )
      if (candidate < 0) {
        continue
      }
      freeAdded.delete(candidate)
      paired.set(leftEl, remainingAdded[candidate])
    }
  }

  const leftOrder = new Map(removed.map((el, index) => [el, index]))
  const rightOrder = new Map(added.map((el, index) => [el, index]))
  const pairedRight = new Set(paired.values())
  const entries: Array<{ alignment: Alignment; key: number; order: number }> =
    []
  let order = 0

  for (const leftEl of removed) {
    const rightEl = paired.get(leftEl)
    if (rightEl) {
      entries.push({
        alignment: { left: leftEl, right: rightEl },
        key: rightOrder.get(rightEl) ?? 0,
        order: order++,
      })
    }
  }
  for (const rightEl of added) {
    if (!pairedRight.has(rightEl)) {
      entries.push({
        alignment: { right: rightEl },
        key: rightOrder.get(rightEl) ?? 0,
        order: order++,
      })
    }
  }
  for (const leftEl of removed) {
    if (paired.has(leftEl)) {
      continue
    }
    const index = leftOrder.get(leftEl) ?? 0
    // A removed block sits just before the next block that exists on both
    // sides; without a right index it would move to the end of the run and the
    // gap would reserve space in the wrong place.
    let nextKey: number | undefined
    for (let next = index + 1; next < removed.length; next++) {
      const rightEl = paired.get(removed[next])
      if (rightEl) {
        nextKey = rightOrder.get(rightEl)
        break
      }
    }
    entries.push({
      alignment: { left: leftEl },
      key:
        nextKey !== undefined
          ? nextKey - 0.5 + index * 1e-6
          : added.length + 1 + index * 1e-6,
      order: order++,
    })
  }

  entries.sort((a, b) => a.key - b.key || a.order - b.order)
  return entries.map((entry) => entry.alignment)
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

/**
 * A block that exists on both sides at a different position.
 */
interface MovedBlock {
  readonly left: Element
  readonly right: Element
}

/**
 * Turns an addition and a removal into a move when they are the same block.
 *
 * The LCS can keep only one of two permutations, so a reordered section ends up
 * as `removed` at its old place and `added` at its new one: the reviewer sees a
 * red collapsed strip and a green block, and has to find out by hand that
 * nothing was edited. Pairing the leftovers by their normalized signature
 * reports one "moved" region instead, without counting it twice.
 *
 * Only identical blocks are paired: a block that was also edited is a real
 * change and keeps its add/remove markers. Non-visual differences (`id`, link
 * target) disqualify a pair for the same reason.
 */
function extractMovedBlocks(pairs: Alignment[]): {
  readonly pairs: Alignment[]
  readonly moved: MovedBlock[]
} {
  const rightOnly = new Map<string, Element[]>()
  for (const pair of pairs) {
    if (pair.left !== undefined || pair.right === undefined) {
      continue
    }
    const signature = subtreeSignature(pair.right)
    const candidates = rightOnly.get(signature)
    if (candidates === undefined) {
      rightOnly.set(signature, [pair.right])
    } else {
      candidates.push(pair.right)
    }
  }
  if (rightOnly.size === 0) {
    return { pairs, moved: [] }
  }

  const movedRight = new Set<Element>()
  const movedLeft = new Set<Element>()
  const moved: MovedBlock[] = []
  for (const pair of pairs) {
    if (pair.left === undefined || pair.right !== undefined) {
      continue
    }
    const candidates = rightOnly.get(subtreeSignature(pair.left))
    const right = candidates?.find((element) => !movedRight.has(element))
    if (right === undefined) {
      continue
    }
    if (nonVisualKinds(pair.left, right).size > 0) {
      continue
    }
    movedRight.add(right)
    movedLeft.add(pair.left)
    moved.push({ left: pair.left, right })
  }
  if (moved.length === 0) {
    return { pairs, moved }
  }
  return {
    pairs: pairs.filter(
      (pair) =>
        (pair.left === undefined || !movedLeft.has(pair.left)) &&
        (pair.right === undefined || !movedRight.has(pair.right)),
    ),
    moved,
  }
}

/**
 * Marks a move as one hunk on both sides. The moved block is neither added nor
 * removed, and it is never collapsed: the reader must be able to see it where
 * it now lives.
 */
function markMovedBlock(ctx: DiffContext, left: Element, right: Element): void {
  addClass(left, 'adoc-diff-moved')
  addClass(right, 'adoc-diff-moved')
  ctx.stats.movedBlocks++
  const hunk = beginHunk(ctx, 'visual')
  assignHunk(left, hunk)
  assignHunk(right, hunk)
  setAttribute(left, 'data-adoc-diff-moved', hunk)
  setAttribute(right, 'data-adoc-diff-moved', hunk)
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

/**
 * The source spans of the formulas in the visible text.
 *
 * MathJax (and the AsciiMath input jax) finds a formula by its delimiters in a
 * single text node. Wrapping a changed character inside `$…$` or `\(…\)` in an
 * `adoc-diff-word` span splits the source and the formula is left unrendered,
 * so a formula change must be marked on the block instead of on its words.
 */
const MATH_REGION_RE = /\$[^$]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g

function mathRanges(text: string): TextRange[] {
  const ranges: TextRange[] = []
  for (const match of text.matchAll(MATH_REGION_RE)) {
    ranges.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    })
  }
  return ranges
}

function overlapsMath(range: InlineRange, math: readonly TextRange[]): boolean {
  return math.some(
    (region) => range.start < region.end && region.start < range.end,
  )
}

/**
 * Splits the word-diff ranges into the ones that may be wrapped and the ones
 * that fall inside a formula. The latter cannot be wrapped without breaking the
 * formula, so the caller marks the whole block as changed instead.
 */
function splitMathRanges(
  ranges: readonly InlineRange[],
  math: readonly TextRange[],
): { kept: InlineRange[]; mathChanged: boolean } {
  if (math.length === 0) {
    return { kept: [...ranges], mathChanged: false }
  }
  const kept: InlineRange[] = []
  let mathChanged = false
  for (const range of ranges) {
    if (overlapsMath(range, math)) {
      mathChanged = true
    } else {
      kept.push(range)
    }
  }
  return { kept, mathChanged }
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
    if (ctx.cellDepth === 0) {
      ctx.stats.changedBlocks++
      markVisualHunk(ctx, left, right)
    }
    return true
  }
  if (result.left.length === 0 && result.right.length === 0) {
    return false
  }
  const leftSplit = splitMathRanges(result.left, mathRanges(leftText))
  const rightSplit = splitMathRanges(result.right, mathRanges(rightText))
  const mathChanged = leftSplit.mathChanged || rightSplit.mathChanged
  wrapRanges(leftNodes, leftSplit.kept, 'adoc-diff-word adoc-diff-word-del')
  wrapRanges(rightNodes, rightSplit.kept, 'adoc-diff-word adoc-diff-word-ins')
  if (mathChanged) {
    // A changed formula cannot carry word markers without breaking its
    // delimiters for MathJax: the block marker is the visible indication.
    markChanged(left)
    markChanged(right)
  }
  if (ctx.cellDepth === 0) {
    ctx.stats.changedBlocks++
    markVisualHunk(ctx, left, right)
  }
  return true
}

function diffElement(left: Element, right: Element, ctx: DiffContext): boolean {
  if (left.tagName !== right.tagName) {
    markWhole(left, 'left')
    markWhole(right, 'right')
    ctx.stats.removedBlocks++
    ctx.stats.addedBlocks++
    markVisualHunk(ctx, left, right)
    return true
  }
  if (left.tagName === 'table' && isDataTable(left) && isDataTable(right)) {
    const tableChanged = diffTable(left, right, ctx)
    if (tableChanged) {
      return true
    }
    // The rows are identical, but the table itself may have changed in a way
    // that has no visible text: a class, an id or a link. Report it instead of
    // silently returning "unchanged".
    return diffNonVisual(left, right, ctx)
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
    const inCell = ctx.cellDepth > 0 || isInsideCell(left)
    if (textChanged && !inCell) {
      // Amber marker for a modified text block; the changed words keep their
      // red/green marks inside it.
      markChanged(left)
      markChanged(right)
    }
    if (visualChange) {
      markMediaChanged(left, right)
      if (CELL_TAGS.has(left.tagName) || CELL_TAGS.has(right.tagName)) {
        markCellChanged(left)
        markCellChanged(right)
      } else {
        markChanged(left)
        markChanged(right)
        if (!textChanged) {
          ctx.stats.changedBlocks++
          markVisualHunk(ctx, left, right)
        }
      }
      return true
    }
    if (!textChanged) {
      const nonVisual = diffNonVisual(left, right, ctx)
      return nonVisual
    }
    return true
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
  if (!changed) {
    changed = diffNonVisual(left, right, ctx)
  }
  return changed
}

/**
 * Marks the media elements whose target changed. The amber block marker alone
 * is not enough for an image: there is no text to point at, so the changed
 * media gets an outline of its own.
 *
 * The marker is also copied to the outermost ancestor that contains only this
 * media element. Client-side renderers (Mermaid, PlantUML) replace the `<img>`
 * with an `<svg>` after the diff is rendered, taking the class away with the
 * image; the ancestor survives and its `data-adoc-diff-media-changed`
 * attribute lets `diff-content.css` outline whatever replaced the image.
 */
function markMediaChanged(left: Element, right: Element): void {
  const leftKeys = new Set(mediaKeys(left))
  const rightKeys = new Set(mediaKeys(right))
  if (setsEqual(leftKeys, rightKeys)) {
    return
  }
  for (const element of mediaElements(left)) {
    if (!rightKeys.has(mediaKeyOf(element))) {
      markMediaElement(element)
    }
  }
  for (const element of mediaElements(right)) {
    if (!leftKeys.has(mediaKeyOf(element))) {
      markMediaElement(element)
    }
  }
}

function markMediaElement(element: Element): void {
  addClass(element, 'adoc-diff-media-changed')
  // The enclosing block survives a client-side renderer replacing the image,
  // so it carries the (single) visible icon. `.imageblock > .content > img`
  // yields `.content`, keeping the icon next to the image instead of at the
  // top of a whole section that happens to contain it.
  const host = mediaHost(element)
  if (host !== undefined) {
    setAttribute(host, 'data-adoc-diff-media-changed', '')
  }
}

const MEDIA_HOST_BOUNDARY_TAGS = new Set(['body', 'html'])

/**
 * The closest block ancestor of a media element, stopping before the document
 * shell and `#preview-root`. A paragraph holding several images yields the
 * paragraph itself: an icon there still says that this block has a changed
 * image, without touching its unchanged sibling.
 */
function mediaHost(element: Element): Element | undefined {
  let node = element.parentNode
  while (node !== null && 'tagName' in node) {
    const host = node as unknown as Element
    if (
      MEDIA_HOST_BOUNDARY_TAGS.has(host.tagName) ||
      getAttribute(host, 'id') === 'preview-root'
    ) {
      return undefined
    }
    if (BLOCK_TAGS.has(host.tagName)) {
      return host
    }
    node = host.parentNode
  }
  return undefined
}

function mediaKeyOf(element: Element): string {
  return [
    element.tagName,
    getAttribute(element, 'data-adoc-diff-key') ?? '',
    getAttribute(element, 'alt') ?? '',
    getAttribute(element, 'title') ?? '',
    getAttribute(element, 'width') ?? '',
    getAttribute(element, 'height') ?? '',
  ].join(':')
}

function mediaKeys(el: Element): string[] {
  return mediaElements(el).map(mediaKeyOf)
}

function mediaElements(el: Element): Element[] {
  const elements: Element[] = []
  walk(el, (node) => {
    if (isElement(node) && MEDIA_NODE_TAGS.has(node.tagName)) {
      elements.push(node)
    }
  })
  return elements
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) {
    return false
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false
    }
  }
  return true
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
  hunk?: string,
): Element {
  const classes = ['adoc-diff-code-line']
  if (kind) {
    classes.push(`adoc-diff-code-line-${kind}`)
  }
  const span = createElement('span', [
    { name: 'class', value: classes.join(' ') },
    { name: 'data-marker', value: marker },
    { name: 'data-line-number', value: String(number) },
    ...(hunk ? [{ name: 'data-adoc-diff-hunk', value: hunk }] : []),
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

function makeCodeGapLine(kind: 'add' | 'del', hunk?: string): Element {
  const span = createElement('span', [
    {
      name: 'class',
      value: `adoc-diff-code-line adoc-diff-code-line-gap adoc-diff-code-line-${kind}`,
    },
    { name: 'data-marker', value: '' },
    { name: 'data-line-number', value: '' },
    ...(hunk ? [{ name: 'data-adoc-diff-hunk', value: hunk }] : []),
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
    if (ctx.cellDepth === 0) {
      ctx.stats.changedBlocks++
      markVisualHunk(ctx, left, right)
    }
    return true
  }

  const leftOut: Element[] = []
  const rightOut: Element[] = []
  let leftNumber = 1
  let rightNumber = 1
  // A continuous run of added/removed/changed lines is one hunk: consecutive
  // lines that changed together are reviewed together.
  let runHunk: string | undefined
  const hunkForRun = (): string | undefined => {
    if (ctx.cellDepth > 0) {
      return undefined
    }
    runHunk ??= beginHunk(ctx, 'visual')
    return runHunk
  }
  for (const op of ops) {
    if (op.kind === 'equal') {
      runHunk = undefined
      leftOut.push(makeCodeLine(leftLines[op.left as number], '', leftNumber++))
      rightOut.push(
        makeCodeLine(rightLines[op.right as number], '', rightNumber++),
      )
    } else if (op.kind === 'changed') {
      const hunk = hunkForRun()
      const leftLine = leftLines[op.left as number]
      const rightLine = rightLines[op.right as number]
      const leftElement = makeCodeLine(
        leftLine,
        '~',
        leftNumber++,
        'changed',
        hunk,
      )
      const rightElement = makeCodeLine(
        rightLine,
        '~',
        rightNumber++,
        'changed',
        hunk,
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
      const hunk = hunkForRun()
      leftOut.push(
        makeCodeLine(
          leftLines[op.left as number],
          '−',
          leftNumber++,
          'del',
          hunk,
        ),
      )
      rightOut.push(makeCodeGapLine('del', hunk))
    } else {
      const hunk = hunkForRun()
      rightOut.push(
        makeCodeLine(
          rightLines[op.right as number],
          '+',
          rightNumber++,
          'add',
          hunk,
        ),
      )
      leftOut.push(makeCodeGapLine('add', hunk))
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
  if (ctx.cellDepth === 0) {
    ctx.stats.changedBlocks++
  }
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
    if (ctx.cellDepth === 0) {
      ctx.stats.changedBlocks++
      markVisualHunk(ctx, left, right)
    }
    return true
  }
  const changed = diffInlineTextNodes(left, right, ctx)
  if (!changed) {
    markChanged(left)
    markChanged(right)
    if (ctx.cellDepth === 0) {
      ctx.stats.changedBlocks++
      markVisualHunk(ctx, left, right)
    }
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
    ? countLines(text)
    : Math.max(1, Math.ceil(text.length / 90))
  // A list or a section with many short items may have little text but many
  // source lines; the `data-line-*` span is a better estimate of its height.
  // A code block is usually wrapped in `div.listingblock > .content > pre`,
  // where the wrapper's own text is short but the `pre` has many lines: count
  // the `pre` lines too, otherwise a long deleted listing is never collapsed.
  return Math.max(textLines, dataLineSpan(el), nestedCodeLines(el))
}

function countLines(text: string): number {
  return text.split(/\r\n?|\n/).length
}

function nestedCodeLines(el: Element): number {
  let lines = 0
  walk(el, (node) => {
    if (!isElement(node) || node.tagName !== 'pre') {
      return
    }
    lines = Math.max(lines, countLines(collectText(node)))
  })
  return lines
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

function firstDataLine(el: Element): number | undefined {
  const own = dataLineOf(el)
  if (own !== undefined) {
    return own
  }
  let found: number | undefined
  walk(el, (node) => {
    if (found !== undefined || !isElement(node)) {
      return
    }
    found = dataLineOf(node)
  })
  return found
}

/** Short, stable-enough identity of a deleted block across re-renders. */
function hashText(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

function excerptOf(value: string, limit = 60): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text
}

function collapseBlock(el: Element, ctx: DiffContext): void {
  addClass(el, 'adoc-diff-collapsed')
  setAttribute(el, 'data-adoc-diff-collapsed', `c${ctx.nextCollapse++}`)
  const lines = estimateBlockLines(el)
  setAttribute(el, 'data-adoc-diff-collapse-lines', String(lines))
  // The expanded state must survive a live re-render, where the positional
  // `cN` id and the DOM order can change. A source line plus an excerpt hash is
  // stable as long as the deleted block itself is.
  const line = firstDataLine(el) ?? 0
  const text = elementText(el)
  setAttribute(el, 'data-adoc-diff-collapse-key', `${line}:${hashText(text)}`)
  setAttribute(el, 'data-adoc-diff-collapse-excerpt', excerptOf(text))
}

function addGapMarker(el: Element, attribute: string, kind: string): void {
  const existing = getAttribute(el, attribute)
  if (existing === undefined) {
    setAttribute(el, attribute, kind)
  } else if (existing !== kind) {
    setAttribute(el, attribute, 'mixed')
  }
}

interface GapDetails {
  readonly count: number
  readonly object?: 'table' | 'lines'
  readonly hunk?: string
}

function applyGapDetails(el: Element, details: GapDetails): void {
  if (getAttribute(el, 'data-adoc-diff-gap-count') === undefined) {
    setAttribute(el, 'data-adoc-diff-gap-count', String(details.count))
  }
  if (details.object !== undefined) {
    setAttribute(el, 'data-adoc-diff-gap-object', details.object)
  }
  if (details.hunk !== undefined) {
    assignHunk(el, details.hunk)
  }
}

function markGap(
  side: 'left' | 'right',
  parent: Element,
  nextPaired: Alignment | undefined,
  previousPaired: Alignment | undefined,
  kind: string,
  details: GapDetails,
): void {
  const nextElement = side === 'left' ? nextPaired?.left : nextPaired?.right
  if (nextElement) {
    addGapMarker(nextElement, 'data-adoc-diff-gap', kind)
    applyGapDetails(nextElement, details)
    return
  }
  const previousElement =
    side === 'left' ? previousPaired?.left : previousPaired?.right
  if (previousElement) {
    addGapMarker(previousElement, 'data-adoc-diff-gap-after', kind)
    applyGapDetails(previousElement, details)
    return
  }
  addGapMarker(parent, 'data-adoc-diff-gap-after', kind)
  applyGapDetails(parent, details)
}

/**
 * A gap label describes what is missing on the other side: a number of blocks,
 * or the rows of a table that was removed as a whole.
 */
function isCodeContainer(el: Element): boolean {
  if (isVerbatim(el)) {
    return true
  }
  return (
    hasClass(el, 'listingblock') ||
    hasClass(el, 'literalblock') ||
    hasClass(el, 'sourceblock')
  )
}

function gapDetails(
  elements: readonly Element[],
  hunk: string | undefined,
): GapDetails {
  if (elements.length === 1 && isDataTable(elements[0])) {
    return { count: rowsOf(elements[0]).length, object: 'table', hunk }
  }
  if (elements.length === 1) {
    // A collapsed deleted block knows how many lines it hides; an expanded code
    // block can be measured. The label on the other side can then say
    // "8 removed lines" instead of "1 removed block".
    const lines = getAttribute(elements[0], 'data-adoc-diff-collapse-lines')
    if (lines !== undefined) {
      const count = Number(lines)
      if (Number.isFinite(count) && count > 0) {
        return { count, object: 'lines', hunk }
      }
    }
    // Only a code block itself is described by its lines. A section that
    // happens to contain a one-line listing is a block: labelling an added
    // section "1 added line" sends the reader looking for a missing line.
    if (isCodeContainer(elements[0])) {
      const codeLines = nestedCodeLines(elements[0])
      if (codeLines > 0) {
        return { count: codeLines, object: 'lines', hunk }
      }
    }
  }
  return { count: elements.length, hunk }
}

/**
 * Handles a run of blocks that exist on one side only.
 *
 * - Short removed blocks stay visible (red) and the other side receives a gap.
 * - Long removed blocks are collapsed into a `−N` strip. The strip still takes
 *   a few pixels, and the other side still receives a compact gap marker, so a
 *   reader of the new version sees that something was deleted there.
 * - Added blocks always stay visible (green) and the old side receives a gap.
 *
 * A continuous run is one hunk, marked on the first block of the run and on the
 * gap carrier of the other side.
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
  if (leftOnly.length === 0 && rightOnly.length === 0) {
    return false
  }
  const hunk = beginHunk(ctx, 'visual')
  if (leftOnly[0]) {
    assignHunk(leftOnly[0], hunk)
  }
  if (rightOnly[0]) {
    assignHunk(rightOnly[0], hunk)
  }
  for (const el of leftOnly) {
    if (ctx.options.align && shouldCollapse(el, ctx.options)) {
      collapseBlock(el, ctx)
    }
  }

  if (ctx.options.align && rightOnly.length > 0) {
    markGap(
      'left',
      leftParent,
      nextPaired,
      previousPaired,
      'ins',
      gapDetails(rightOnly, hunk),
    )
  }
  if (ctx.options.align && leftOnly.length > 0) {
    markGap(
      'right',
      rightParent,
      nextPaired,
      previousPaired,
      'del',
      gapDetails(leftOnly, hunk),
    )
  }
  return true
}

function alignBlockChildren(
  left: Element,
  right: Element,
  ctx: DiffContext,
): boolean {
  const aligned = alignElements(blockChildren(left), blockChildren(right))
  const { pairs, moved } = extractMovedBlocks(aligned)
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
  for (const move of moved) {
    markMovedBlock(ctx, move.left, move.right)
    changed = true
  }
  let previousPaired: Alignment | undefined
  let index = 0
  while (index < pairs.length) {
    const pair = pairs[index]
    if (pair.left && pair.right) {
      if (pair.unchanged) {
        collectLinePairs(pair.left, pair.right, ctx)
        if (diffNonVisual(pair.left, pair.right, ctx)) {
          changed = true
        }
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

function pairColumnRuns(
  raw: readonly ColumnPair[],
  leftSignatures: readonly string[],
  rightSignatures: readonly string[],
): ColumnPair[] {
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
    out.push(...pairColumnRun(left, right, leftSignatures, rightSignatures))
  }
  return out
}

/**
 * Pairs a run of one-sided columns by content, not by order.
 *
 * A column inserted before a column that also changed (a new `Severity` column
 * before `Status`, whose cells changed) used to pair the old `Status` with the
 * new `Severity`: every cell then looked modified, the old `Status` and the new
 * `Status` were painted as added/removed, and the reviewer read the wrong
 * "before" and "after". The header is part of the column signature, so the
 * similarity pairs `Status` with `Status` and leaves `Severity` one-sided.
 */
function pairColumnRun(
  left: readonly number[],
  right: readonly number[],
  leftSignatures: readonly string[],
  rightSignatures: readonly string[],
): ColumnPair[] {
  const paired = new Map<number, number>()
  const usedRight = new Set<number>()
  const candidates: Array<{ left: number; right: number; score: number }> = []
  for (const leftIndex of left) {
    for (const rightIndex of right) {
      const score = textSimilarity(
        columnWords(leftSignatures[leftIndex]),
        columnWords(rightSignatures[rightIndex]),
      )
      if (score >= SIMILARITY_THRESHOLD) {
        candidates.push({ left: leftIndex, right: rightIndex, score })
      }
    }
  }
  candidates.sort(
    (a, b) => b.score - a.score || a.left - b.left || a.right - b.right,
  )
  for (const candidate of candidates) {
    if (paired.has(candidate.left) || usedRight.has(candidate.right)) {
      continue
    }
    paired.set(candidate.left, candidate.right)
    usedRight.add(candidate.right)
  }

  const remainingLeft = left.filter((index) => !paired.has(index))
  const remainingRight = right.filter((index) => !usedRight.has(index))
  if (remainingLeft.length === remainingRight.length) {
    for (let index = 0; index < remainingLeft.length; index++) {
      paired.set(remainingLeft[index], remainingRight[index])
      usedRight.add(remainingRight[index])
    }
  }

  const entries: Array<{ pair: ColumnPair; key: number; order: number }> = []
  let order = 0
  for (const [leftIndex, rightIndex] of paired) {
    entries.push({
      pair: { left: leftIndex, right: rightIndex },
      key: rightIndex,
      order: order++,
    })
  }
  for (const rightIndex of right) {
    if (!usedRight.has(rightIndex)) {
      entries.push({
        pair: { right: rightIndex },
        key: rightIndex,
        order: order++,
      })
    }
  }
  const leftOrder = new Map(left.map((value, index) => [value, index]))
  for (const leftIndex of left) {
    if (paired.has(leftIndex)) {
      continue
    }
    const position = leftOrder.get(leftIndex) ?? 0
    let nextKey: number | undefined
    for (let next = position + 1; next < left.length; next++) {
      const rightIndex = paired.get(left[next])
      if (rightIndex !== undefined) {
        nextKey = rightIndex
        break
      }
    }
    entries.push({
      pair: { left: leftIndex },
      key:
        nextKey !== undefined
          ? nextKey - 0.5 + position * 1e-6
          : right.length + 1 + position * 1e-6,
      order: order++,
    })
  }
  entries.sort((a, b) => a.key - b.key || a.order - b.order)
  return entries.map((entry) => entry.pair)
}

function columnWords(signature: string): string {
  return signature.split('\u0001').join(' ')
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
  // the one-sided entries of each run by content.
  return pairColumnRuns(raw, leftSignatures, rightSignatures)
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
): Element {
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
  return row
}

/**
 * The visual layout of a table: its own width style and the columns' widths and
 * styles. A width change has no word to wrap, so without this it would be
 * invisible while still being a real visual difference.
 */
function tableLayoutSignature(table: Element): string {
  const parts: string[] = [
    `table:${getAttribute(table, 'style') ?? ''};${getAttribute(table, 'width') ?? ''}`,
  ]
  for (const child of table.childNodes) {
    if (!isElement(child) || child.tagName !== 'colgroup') {
      continue
    }
    parts.push(`group:${getAttribute(child, 'style') ?? ''}`)
    for (const col of child.childNodes) {
      if (!isElement(col) || col.tagName !== 'col') {
        continue
      }
      parts.push(
        `col:${getAttribute(col, 'width') ?? ''};${getAttribute(col, 'style') ?? ''}`,
      )
    }
  }
  return parts.join('|')
}

function diffTable(left: Element, right: Element, ctx: DiffContext): boolean {
  if (!ctx.options.align) {
    return diffTablePlain(left, right, ctx)
  }
  recordLinePair(left, right, ctx)

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
  // Compare the layout before the union grid replaces the `colgroup`s.
  const layoutChanged =
    tableLayoutSignature(left) !== tableLayoutSignature(right)
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
  const columnStructural = leftStructural || rightStructural
  let structural = columnStructural
  let tableChanged = false
  let tableHunk: string | undefined
  const ensureTableHunk = (): void => {
    tableChanged = true
    if (tableHunk !== undefined) {
      return
    }
    tableHunk = beginHunk(ctx, 'visual')
    assignHunk(left, tableHunk)
    assignHunk(right, tableHunk)
  }

  if (layoutChanged) {
    markChanged(left)
    markChanged(right)
    ensureTableHunk()
  }

  if (diffCaption(left, right, ctx)) {
    tableChanged = true
  }

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
      if (pair.unchanged) {
        if (diffNonVisual(pair.left, pair.right, ctx)) {
          tableChanged = true
        }
        continue
      }
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
      // One changed row is one hunk: a changed cell does not add a second one.
      // When the change is a column insertion, the table itself owns the hunk.
      if (row.changed || (row.structural && !columnStructural)) {
        markHunk(ctx, 'visual', pair.left, pair.right)
        tableChanged = true
      } else if (row.nonVisual) {
        tableChanged = true
      }
    } else if (pair.left) {
      addClass(pair.left, 'adoc-diff-row-del')
      ctx.stats.removedBlocks++
      structural = true
      const placeholder = insertRowPlaceholder(
        right,
        nextRowOnSide(pairs, i, 'right'),
        pair.left,
        columnPairs.length,
        'del',
      )
      markHunk(ctx, 'visual', pair.left, placeholder)
      tableChanged = true
    } else if (pair.right) {
      addClass(pair.right, 'adoc-diff-row-ins')
      ctx.stats.addedBlocks++
      structural = true
      const placeholder = insertRowPlaceholder(
        left,
        nextRowOnSide(pairs, i, 'left'),
        pair.right,
        columnPairs.length,
        'ins',
      )
      markHunk(ctx, 'visual', placeholder, pair.right)
      tableChanged = true
    }
  }

  if (structural) {
    addClass(left, 'adoc-diff-table-del')
    addClass(right, 'adoc-diff-table-ins')
  }
  if (tableChanged) {
    ctx.stats.changedTables++
  }
  return tableChanged
}

interface RowDiff {
  changed: boolean
  structural: boolean
  nonVisual: boolean
}

function sameCellAcrossRows(
  leftCell: TableCellInfo | undefined,
  rightCell: TableCellInfo | undefined,
  leftRowIndex: number,
  rightRowIndex: number,
): boolean {
  return (
    (leftCell !== undefined && leftCell.row !== leftRowIndex) ||
    (rightCell !== undefined && rightCell.row !== rightRowIndex)
  )
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
  let nonVisual = false
  const seenLeft = new Set<Element>()
  const seenRight = new Set<Element>()
  for (let column = 0; column < columnCount; column++) {
    const leftCell = leftModel.grid[leftRowIndex]?.[column]
    const rightCell = rightModel.grid[rightRowIndex]?.[column]
    if (!leftCell && !rightCell) {
      continue
    }
    if (sameCellAcrossRows(leftCell, rightCell, leftRowIndex, rightRowIndex)) {
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
    ctx.cellDepth++
    let cellChanged = false
    try {
      cellChanged = diffElement(leftCell.element, rightCell.element, ctx)
    } finally {
      ctx.cellDepth--
    }
    if (cellChanged) {
      markCellChanged(leftCell.element)
      markCellChanged(rightCell.element)
      ctx.stats.changedCells++
      changed = true
    } else if (diffNonVisual(leftCell.element, rightCell.element, ctx)) {
      nonVisual = true
    }
  }
  return { changed, structural, nonVisual }
}

function diffTablePlain(
  left: Element,
  right: Element,
  ctx: DiffContext,
): boolean {
  recordLinePair(left, right, ctx)
  const leftModel = buildTableModel(left)
  const rightModel = buildTableModel(right)
  let structural = leftModel.columns !== rightModel.columns
  let tableChanged = false
  let tableHunk: string | undefined
  const ensureTableHunk = (): void => {
    tableChanged = true
    if (tableHunk !== undefined) {
      return
    }
    tableHunk = beginHunk(ctx, 'visual')
    assignHunk(left, tableHunk)
    assignHunk(right, tableHunk)
  }

  if (tableLayoutSignature(left) !== tableLayoutSignature(right)) {
    markChanged(left)
    markChanged(right)
    ensureTableHunk()
  }

  if (diffCaption(left, right, ctx)) {
    tableChanged = true
  }

  const pairs = alignElements(rowsOf(left), rowsOf(right))
  for (const pair of pairs) {
    if (pair.left && pair.right) {
      if (pair.unchanged) {
        if (diffNonVisual(pair.left, pair.right, ctx)) {
          tableChanged = true
        }
        continue
      }
      const row = diffRowPlain(pair.left, pair.right, ctx)
      if (row.changed || row.structural) {
        markHunk(ctx, 'visual', pair.left, pair.right)
        tableChanged = true
      } else if (row.nonVisual) {
        tableChanged = true
      }
      if (row.structural) {
        structural = true
      }
    } else if (pair.left) {
      addClass(pair.left, 'adoc-diff-row-del')
      ctx.stats.removedBlocks++
      structural = true
      markHunk(ctx, 'visual', pair.left)
      tableChanged = true
    } else if (pair.right) {
      addClass(pair.right, 'adoc-diff-row-ins')
      ctx.stats.addedBlocks++
      structural = true
      markHunk(ctx, 'visual', undefined, pair.right)
      tableChanged = true
    }
  }

  if (structural) {
    addClass(left, 'adoc-diff-table-del')
    addClass(right, 'adoc-diff-table-ins')
  }
  if (tableChanged) {
    ctx.stats.changedTables++
  }
  return tableChanged
}

function diffRowPlain(
  left: Element,
  right: Element,
  ctx: DiffContext,
): RowDiff {
  const leftCells = cellsOf(left)
  const rightCells = cellsOf(right)
  let changed = leftCells.length !== rightCells.length
  let structural = leftCells.length !== rightCells.length
  let nonVisual = false
  const count = Math.max(leftCells.length, rightCells.length)
  for (let index = 0; index < count; index++) {
    const leftCell = leftCells[index]
    const rightCell = rightCells[index]
    if (leftCell && rightCell) {
      ctx.cellDepth++
      let cellChanged = false
      try {
        cellChanged = diffElement(leftCell, rightCell, ctx)
      } finally {
        ctx.cellDepth--
      }
      if (cellChanged) {
        markCellChanged(leftCell)
        markCellChanged(rightCell)
        ctx.stats.changedCells++
        changed = true
      } else if (diffNonVisual(leftCell, rightCell, ctx)) {
        nonVisual = true
      }
    } else if (leftCell) {
      addClass(leftCell, 'adoc-diff-cell-del')
      ctx.stats.removedBlocks++
      changed = true
      structural = true
    } else if (rightCell) {
      addClass(rightCell, 'adoc-diff-cell-ins')
      ctx.stats.addedBlocks++
      changed = true
      structural = true
    }
  }
  return { changed, structural, nonVisual }
}

function diffCaption(left: Element, right: Element, ctx: DiffContext): boolean {
  const leftCaption = firstChildTag(left, 'caption')
  const rightCaption = firstChildTag(right, 'caption')
  if (leftCaption && rightCaption) {
    return diffElement(leftCaption, rightCaption, ctx)
  }
  if (leftCaption) {
    markWhole(leftCaption, 'left')
    ctx.stats.removedBlocks++
    markHunk(ctx, 'visual', leftCaption)
    return true
  }
  if (rightCaption) {
    markWhole(rightCaption, 'right')
    ctx.stats.addedBlocks++
    markHunk(ctx, 'visual', undefined, rightCaption)
    return true
  }
  return false
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
