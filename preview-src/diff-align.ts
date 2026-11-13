/**
 * Client-side alignment of the two diff panes.
 *
 * The extension host marks matched blocks with the same
 * `data-adoc-diff-anchor` on both sides and marks the missing side of an
 * added/removed block with `data-adoc-diff-gap` (or `data-adoc-diff-gap-after`
 * on the previous block). This controller:
 *
 * 1. resets the spacing it applied previously;
 * 2. measures the distance between consecutive anchors in each pane;
 * 3. asks `computeSpaces` how much space the shorter side needs;
 * 4. applies it as padding on the **previous** matched block (never as a margin
 *    on the next one: the preview wrappers let child margins collapse through,
 *    so a margin on the wrapper does not add the expected height);
 * 5. re-runs when fonts, images, diagrams or the window size change.
 *
 * It never inserts block elements into the preview content, which would break
 * Asciidoctor's `:first-child` / `:last-child` rules.
 */

import {
  type AlignGapKind,
  type AlignGapPosition,
  type AlignInterval,
  type AlignSpace,
  computeSpaces,
} from '../src/features/diff/alignMath.js'

interface AnchorPair {
  readonly left: HTMLElement
  readonly right: HTMLElement
}

interface SpaceState {
  top: number
  bottom: number
  kindTop: AlignGapKind
  kindBottom: AlignGapKind
}

type SpaceSide = 'top' | 'bottom'

const GAP_CLASSES = [
  'adoc-diff-gap-top',
  'adoc-diff-gap-bottom',
  'adoc-diff-gap-ins',
  'adoc-diff-gap-del',
  'adoc-diff-gap-mixed',
  'adoc-diff-gap-residual',
]

const MEDIA_SELECTOR = 'img, video, audio, iframe, object'
const GAP_TOP_HEIGHT = '--adoc-diff-gap-top-h'
const GAP_TOP_OFFSET = '--adoc-diff-gap-top-offset'
const GAP_BOTTOM_HEIGHT = '--adoc-diff-gap-bottom-h'
const GAP_BOTTOM_OFFSET = '--adoc-diff-gap-bottom-offset'

export class AlignmentController {
  private readonly carriers = new Set<HTMLElement>()
  private readonly baseInline = new Map<
    HTMLElement,
    { paddingTop: string; paddingBottom: string }
  >()
  private readonly disposables: Array<() => void> = []
  private resizeObserver: ResizeObserver | undefined
  private mutationObserver: MutationObserver | undefined
  private timer: number | undefined
  private aligning = false
  private lastAlignAt = 0
  private disposed = false

  constructor(
    private readonly leftPane: HTMLElement,
    private readonly rightPane: HTMLElement,
  ) {}

  public start(): void {
    for (const element of this.leftPane.querySelectorAll<HTMLElement>(
      '[data-adoc-diff-collapsed]',
    )) {
      element.title = 'Click to expand deleted block'
    }
    this.schedule(0)
    this.observe()
    this.schedule(400)
    this.schedule(1500)
  }

  public dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer)
      this.timer = undefined
    }
    this.resizeObserver?.disconnect()
    this.mutationObserver?.disconnect()
    for (const dispose of this.disposables.splice(0)) {
      dispose()
    }
    this.resetSpaces()
  }

  private schedule(delay = 80): void {
    if (this.disposed) {
      return
    }
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer)
    }
    this.timer = window.setTimeout(() => {
      this.timer = undefined
      this.align()
    }, delay)
  }

  private align(): void {
    if (this.disposed || this.aligning) {
      return
    }
    const pairs = this.collectAnchorPairs()
    if (pairs.length < 2) {
      return
    }
    this.aligning = true
    const scroll = this.captureScroll()
    try {
      this.alignTables()
      this.resetSpaces()
      const intervals = this.measureIntervals(pairs)
      this.applySpaces(intervals, pairs)
      // Padding can interact with collapsed child margins and fixed heights,
      // so a first pass may overshoot. Measure again and pad the higher side by
      // the remaining difference; this is monotonic and converges quickly.
      for (let pass = 0; pass < 2; pass++) {
        if (!this.adjustResiduals(pairs)) {
          break
        }
      }
      this.restoreScroll(scroll)
    } finally {
      this.aligning = false
      this.lastAlignAt = performance.now()
    }
  }

  private topAnchor(
    pane: HTMLElement,
  ): { id: string; offset: number } | undefined {
    const paneTop = pane.getBoundingClientRect().top
    let first: HTMLElement | undefined
    let best: HTMLElement | undefined
    for (const element of pane.querySelectorAll<HTMLElement>(
      '[data-adoc-diff-anchor]',
    )) {
      if (element.getClientRects().length === 0) {
        continue
      }
      first ??= element
      if (element.getBoundingClientRect().top - paneTop <= 1) {
        best = element
      } else {
        break
      }
    }
    const anchor = best ?? first
    const id = anchor?.getAttribute('data-adoc-diff-anchor')
    if (!anchor || !id) {
      return undefined
    }
    return {
      id,
      offset: anchor.getBoundingClientRect().top - paneTop,
    }
  }

  private captureScroll(): {
    left?: { id: string; offset: number }
    right?: { id: string; offset: number }
  } {
    return {
      left: this.topAnchor(this.leftPane),
      right: this.topAnchor(this.rightPane),
    }
  }

  private restoreScroll(scroll: {
    left?: { id: string; offset: number }
    right?: { id: string; offset: number }
  }): void {
    const entries: Array<{
      pane: HTMLElement
      anchor: { id: string; offset: number } | undefined
    }> = [
      { pane: this.leftPane, anchor: scroll.left },
      { pane: this.rightPane, anchor: scroll.right },
    ]
    if (entries.every((entry) => entry.anchor === undefined)) {
      return
    }
    for (const pane of [this.leftPane, this.rightPane]) {
      pane.dataset.adocDiffAligning = 'true'
    }
    for (const { pane, anchor } of entries) {
      if (!anchor) {
        continue
      }
      const element = pane.querySelector<HTMLElement>(
        `[data-adoc-diff-anchor="${anchor.id}"]`,
      )
      if (!element || element.getClientRects().length === 0) {
        continue
      }
      const offset =
        element.getBoundingClientRect().top - pane.getBoundingClientRect().top
      pane.scrollTop += offset - anchor.offset
    }
    window.setTimeout(() => {
      for (const pane of [this.leftPane, this.rightPane]) {
        delete pane.dataset.adocDiffAligning
      }
    }, 150)
  }

  private observe(): void {
    const onLoad = (event: Event): void => {
      if (
        event.target instanceof Element &&
        event.target.matches(MEDIA_SELECTOR)
      ) {
        this.schedule()
      }
    }
    for (const pane of [this.leftPane, this.rightPane]) {
      pane.addEventListener('load', onLoad, true)
      pane.addEventListener('error', onLoad, true)
      this.disposables.push(() => {
        pane.removeEventListener('load', onLoad, true)
        pane.removeEventListener('error', onLoad, true)
      })
    }

    const onResize = (): void => this.schedule()
    window.addEventListener('resize', onResize)
    this.disposables.push(() => window.removeEventListener('resize', onResize))

    if (typeof document.fonts !== 'undefined') {
      document.fonts.ready.then(
        () => this.schedule(),
        () => undefined,
      )
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.schedule())
      for (const pane of [this.leftPane, this.rightPane]) {
        this.resizeObserver.observe(pane)
      }
    }

    if (typeof MutationObserver !== 'undefined') {
      this.mutationObserver = new MutationObserver(() => {
        // Our own gap classes/styles change the DOM; ignore those mutations.
        if (this.aligning || performance.now() - this.lastAlignAt < 200) {
          return
        }
        this.schedule()
      })
      for (const pane of [this.leftPane, this.rightPane]) {
        this.mutationObserver.observe(pane, {
          childList: true,
          subtree: true,
          attributes: true,
        })
      }
    }

    const onClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      const collapsed = target.closest<HTMLElement>(
        '[data-adoc-diff-collapsed]',
      )
      if (!collapsed || !this.leftPane.contains(collapsed)) {
        return
      }
      const expanded = collapsed.classList.contains('adoc-diff-expanded')
      const rect = collapsed.getBoundingClientRect()
      // Only the top strip toggles, so clicking the content of an expanded
      // deleted block does not collapse it again.
      if (expanded && event.clientY - rect.top > 18) {
        return
      }
      if (!expanded && Math.abs(event.clientY - rect.top) > 18) {
        return
      }
      collapsed.classList.toggle('adoc-diff-expanded', !expanded)
      collapsed.title = expanded
        ? 'Expand deleted block'
        : 'Collapse deleted block'
      this.schedule(0)
    }
    for (const pane of [this.leftPane, this.rightPane]) {
      pane.addEventListener('click', onClick)
      this.disposables.push(() => pane.removeEventListener('click', onClick))
    }
  }

  private alignTables(): void {
    const leftTables = this.tablesById(this.leftPane)
    const rightTables = this.tablesById(this.rightPane)
    // Inner tables first: their final height contributes to the outer rows.
    const ids = [...leftTables.keys()]
      .filter((id) => rightTables.has(id))
      .reverse()
    for (const id of ids) {
      this.alignTablePair(leftTables.get(id)!, rightTables.get(id)!)
    }
  }

  private tablesById(pane: HTMLElement): Map<string, HTMLTableElement> {
    const tables = new Map<string, HTMLTableElement>()
    for (const table of pane.querySelectorAll<HTMLTableElement>(
      'table[data-adoc-diff-grid]',
    )) {
      const id = table.getAttribute('data-adoc-diff-grid')
      if (id) {
        tables.set(id, table)
      }
    }
    return tables
  }

  private alignTablePair(
    left: HTMLTableElement,
    right: HTMLTableElement,
  ): void {
    const leftCols = directColumns(left)
    const rightCols = directColumns(right)
    const count = Math.max(leftCols.length, rightCols.length)
    if (count === 0) {
      return
    }
    const fallbackWidth = `${100 / count}%`
    const widths = Array.from({ length: count }, (_, index) => {
      const leftWidth = leftCols[index]?.getAttribute('width') ?? ''
      const rightWidth = rightCols[index]?.getAttribute('width') ?? ''
      return rightWidth || leftWidth || fallbackWidth
    })
    for (const table of [left, right]) {
      table.style.tableLayout = 'fixed'
      table.style.width = '100%'
    }
    for (const cols of [leftCols, rightCols]) {
      for (let index = 0; index < count; index++) {
        const col = cols[index]
        if (col) {
          col.setAttribute('width', widths[index])
          col.style.width = widths[index]
        }
      }
    }

    // Force a layout so the column widths are applied before the row heights
    // are measured.
    left.getBoundingClientRect()
    const leftRows = Array.from(left.rows)
    const rightRows = Array.from(right.rows)
    const rowCount = Math.max(leftRows.length, rightRows.length)
    for (let index = 0; index < rowCount; index++) {
      const leftRow = leftRows[index]
      const rightRow = rightRows[index]
      const leftHeight = leftRow?.getBoundingClientRect().height ?? 0
      const rightHeight = rightRow?.getBoundingClientRect().height ?? 0
      const height = Math.max(leftHeight, rightHeight)
      if (height > 0) {
        if (leftRow) {
          leftRow.style.height = `${height}px`
        }
        if (rightRow) {
          rightRow.style.height = `${height}px`
        }
      }
    }
  }

  private collectAnchorPairs(): AnchorPair[] {
    const left = this.collectAnchors(this.leftPane)
    const rightById = new Map(
      this.collectAnchors(this.rightPane).map((element) => [
        element.getAttribute('data-adoc-diff-anchor') ?? '',
        element,
      ]),
    )
    const pairs: AnchorPair[] = []
    for (const leftElement of left) {
      const id = leftElement.getAttribute('data-adoc-diff-anchor')
      const rightElement = id ? rightById.get(id) : undefined
      if (rightElement) {
        pairs.push({ left: leftElement, right: rightElement })
      }
    }
    return pairs
  }

  private collectAnchors(pane: HTMLElement): HTMLElement[] {
    const anchors: HTMLElement[] = []
    for (const element of pane.querySelectorAll<HTMLElement>(
      '[data-adoc-diff-anchor]',
    )) {
      if (element.getClientRects().length > 0) {
        anchors.push(element)
      }
    }
    return anchors
  }

  private measureIntervals(pairs: readonly AnchorPair[]): AlignInterval[] {
    const leftTops = pairs.map((pair) =>
      this.contentTop(pair.left, this.leftPane),
    )
    const rightTops = pairs.map((pair) =>
      this.contentTop(pair.right, this.rightPane),
    )
    const intervals: AlignInterval[] = []
    for (let i = 0; i < pairs.length - 1; i++) {
      const previous = pairs[i]
      const current = pairs[i + 1]
      const leftGap = this.gapInfo(previous.left, current.left)
      const rightGap = this.gapInfo(previous.right, current.right)
      intervals.push({
        leftDistance: leftTops[i + 1] - leftTops[i],
        rightDistance: rightTops[i + 1] - rightTops[i],
        leftGap: leftGap !== undefined,
        rightGap: rightGap !== undefined,
        leftPosition: leftGap?.position ?? 'before',
        rightPosition: rightGap?.position ?? 'before',
        leftKind: leftGap?.kind,
        rightKind: rightGap?.kind,
      })
    }
    return intervals
  }

  private gapInfo(
    previous: HTMLElement,
    current: HTMLElement,
  ): { position: AlignGapPosition; kind: AlignGapKind } | undefined {
    const before = current.getAttribute('data-adoc-diff-gap')
    if (before !== null) {
      return { position: 'before', kind: normalizeKind(before) }
    }
    // A trailing gap may be marked on a container of the previous anchor (a
    // section, a list, a cell), not on the immediate anchor.
    let node: HTMLElement | null = previous
    while (node) {
      const after = node.getAttribute('data-adoc-diff-gap-after')
      if (after !== null) {
        return { position: 'after', kind: normalizeKind(after) }
      }
      node = node.parentElement
    }
    return undefined
  }

  private contentTop(element: HTMLElement, pane: HTMLElement): number {
    return (
      element.getBoundingClientRect().top -
      pane.getBoundingClientRect().top +
      pane.scrollTop
    )
  }

  private applySpaces(
    intervals: readonly AlignInterval[],
    pairs: readonly AnchorPair[],
  ): void {
    const states = new Map<HTMLElement, SpaceState>()
    for (let i = 0; i < intervals.length; i++) {
      const spaces = computeSpaces([intervals[i]])
      if (spaces.length === 0) {
        continue
      }
      // Padding can only be added to the previous anchor: it then moves the
      // next anchor (and everything after it) by exactly the requested height.
      // When the current anchor is a descendant of the previous one (a gap at
      // the start of a container), the padding goes on the top of the parent.
      const previousLeft = pairs[i].left
      const previousRight = pairs[i].right
      const currentLeft = pairs[i + 1].left
      const currentRight = pairs[i + 1].right
      for (const space of spaces) {
        const previous = space.side === 'left' ? previousLeft : previousRight
        const current = space.side === 'left' ? currentLeft : currentRight
        const position: SpaceSide = previous.contains(current)
          ? 'top'
          : 'bottom'
        addSpace(states, previous, position, space)
      }
    }
    for (const [element, state] of states) {
      if (state.top > 0) {
        this.applyPadding(element, 'top', state.top, state.kindTop)
      }
      if (state.bottom > 0) {
        this.applyPadding(element, 'bottom', state.bottom, state.kindBottom)
      }
    }
  }

  private adjustResiduals(pairs: readonly AnchorPair[]): boolean {
    const leftTops = pairs.map((pair) =>
      this.contentTop(pair.left, this.leftPane),
    )
    const rightTops = pairs.map((pair) =>
      this.contentTop(pair.right, this.rightPane),
    )
    let adjusted = false
    for (let i = 0; i < pairs.length - 1; i++) {
      const shift =
        rightTops[i + 1] - rightTops[i] - (leftTops[i + 1] - leftTops[i])
      if (Math.abs(shift) <= 0.5) {
        continue
      }
      const previous = shift > 0 ? pairs[i].left : pairs[i].right
      const current = shift > 0 ? pairs[i + 1].left : pairs[i + 1].right
      const kind = this.gapInfo(previous, current)?.kind ?? 'residual'
      const position: SpaceSide = previous.contains(current) ? 'top' : 'bottom'
      this.applyPadding(previous, position, Math.abs(shift), kind)
      adjusted = true
    }
    return adjusted
  }

  private applyPadding(
    element: HTMLElement,
    position: SpaceSide,
    height: number,
    kind: AlignGapKind,
  ): void {
    this.rememberBase(element)
    const style = window.getComputedStyle(element)
    const base =
      parseFloat(position === 'top' ? style.paddingTop : style.paddingBottom) ||
      0
    if (position === 'top') {
      element.style.paddingTop = `${base + height}px`
      element.style.setProperty(GAP_TOP_HEIGHT, `${base + height}px`)
      element.style.setProperty(GAP_TOP_OFFSET, '0px')
    } else {
      element.style.paddingBottom = `${base + height}px`
      element.style.setProperty(GAP_BOTTOM_HEIGHT, `${base + height}px`)
      element.style.setProperty(GAP_BOTTOM_OFFSET, '0px')
    }
    element.classList.add(
      position === 'top' ? 'adoc-diff-gap-top' : 'adoc-diff-gap-bottom',
      gapKindClass(this.effectiveKind(element, kind)),
    )
    this.carriers.add(element)
  }

  private effectiveKind(
    element: HTMLElement,
    kind: AlignGapKind,
  ): AlignGapKind {
    if (kind !== 'residual') {
      return kind
    }
    for (const existing of ['ins', 'del', 'mixed'] as const) {
      if (element.classList.contains(`adoc-diff-gap-${existing}`)) {
        return existing
      }
    }
    return 'residual'
  }

  private rememberBase(element: HTMLElement): void {
    if (!this.baseInline.has(element)) {
      this.baseInline.set(element, {
        paddingTop: element.style.paddingTop,
        paddingBottom: element.style.paddingBottom,
      })
    }
  }

  private resetSpaces(): void {
    for (const element of this.carriers) {
      const base = this.baseInline.get(element)
      element.style.paddingTop = base?.paddingTop ?? ''
      element.style.paddingBottom = base?.paddingBottom ?? ''
      for (const property of [
        GAP_TOP_HEIGHT,
        GAP_TOP_OFFSET,
        GAP_BOTTOM_HEIGHT,
        GAP_BOTTOM_OFFSET,
      ]) {
        element.style.removeProperty(property)
      }
      element.classList.remove(...GAP_CLASSES)
    }
    this.carriers.clear()
  }
}

function directColumns(table: HTMLTableElement): HTMLTableColElement[] {
  const columns: HTMLTableColElement[] = []
  for (const group of Array.from(table.children)) {
    if (group.tagName !== 'COLGROUP') {
      continue
    }
    for (const child of Array.from(group.children)) {
      if (child.tagName === 'COL') {
        columns.push(child as HTMLTableColElement)
      }
    }
  }
  return columns
}

function normalizeKind(value: string): AlignGapKind {
  return value === 'ins' || value === 'del' || value === 'mixed'
    ? value
    : 'residual'
}

function gapKindClass(kind: AlignGapKind): string {
  return kind === 'residual'
    ? 'adoc-diff-gap-residual'
    : `adoc-diff-gap-${kind}`
}

function addSpace(
  states: Map<HTMLElement, SpaceState>,
  element: HTMLElement,
  position: SpaceSide,
  space: AlignSpace,
): void {
  const state = states.get(element) ?? {
    top: 0,
    bottom: 0,
    kindTop: 'residual' as AlignGapKind,
    kindBottom: 'residual' as AlignGapKind,
  }
  if (position === 'top') {
    state.top += space.height
    state.kindTop = mergeKind(state.kindTop, space.kind)
  } else {
    state.bottom += space.height
    state.kindBottom = mergeKind(state.kindBottom, space.kind)
  }
  states.set(element, state)
}

function mergeKind(current: AlignGapKind, next: AlignGapKind): AlignGapKind {
  if (current === 'residual') {
    return next
  }
  if (next === 'residual' || current === next) {
    return current
  }
  return 'mixed'
}
