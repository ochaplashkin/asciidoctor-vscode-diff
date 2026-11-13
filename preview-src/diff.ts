/**
 * Client entry point of the diff panel.
 *
 * Both previews are rendered into the same webview document, one per scrollable
 * pane (`#diff-left`, `#diff-right`). This script keeps their vertical scroll in
 * sync, restores the reading position and the expanded deleted blocks after a
 * live re-render, and turns the status into a navigator through the change
 * regions ("hunks") the kernel marked with `data-adoc-diff-hunk`.
 *
 * The panes are synchronized by *anchors* (the matched rendered blocks), and
 * fall back to the same fraction of the scrollable range when no anchor is
 * available.
 */

import { AlignmentController } from './diff-align.js'

interface DiffStats {
  changes?: number
  visualChanges?: number
  nonVisualChanges?: number
  addedBlocks?: number
  removedBlocks?: number
  movedBlocks?: number
  changedBlocks?: number
  changedTables?: number
  changedCells?: number
  formattingChanges?: number
  linkChanges?: number
  idChanges?: number
  navigationChanges?: number
}

interface LineMapEntry {
  leftLine: number
  rightLine: number
}

interface Settings {
  align?: boolean
  showStats?: boolean
  ratio?: number
  leftLine?: number
  rightLine?: number
  expanded?: string[]
  lineMap?: LineMapEntry[]
  leftLineCount?: number
  rightLineCount?: number
  strings?: Record<string, string>
  stats?: DiffStats
}

interface LineAnchor {
  readonly element: HTMLElement
  readonly line: number
}

interface HunkTarget {
  readonly pane: HTMLElement
  readonly element: HTMLElement
}

const dataElement = document.getElementById('vscode-asciidoc-diff-data')
const settings = JSON.parse(
  dataElement?.getAttribute('data-settings') ?? '{}',
) as Settings
const strings = settings.strings ?? {}

const leftPane = document.getElementById('diff-left') as HTMLElement | null
const rightPane = document.getElementById('diff-right') as HTMLElement | null
const statusElement = document.getElementById('diff-status')
const legendElement = document.getElementById('diff-legend')

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
  setState?(state: unknown): void
  getState?(): unknown
}

// A docinfo script may have acquired the webview API already; scrolling still
// works without it, only the messages to the host are lost.
let api: { postMessage(message: unknown): void } | undefined
try {
  api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined
} catch {
  api = undefined
}

function post(type: string, body: Record<string, unknown> = {}) {
  api?.postMessage({ type, ...body })
}

function text(key: string, fallback: string): string {
  const value = strings[key]
  return value !== undefined && value !== '' ? value : fallback
}

function format(template: string, values: readonly (string | number)[]) {
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = values[Number(index)]
    return value !== undefined ? String(value) : match
  })
}

/** The scroll offset we last set programmatically on each pane. */
const pendingScroll = new Map<
  'left' | 'right',
  { top: number; until: number }
>()

function maxScroll(pane: HTMLElement): number {
  return Math.max(0, pane.scrollHeight - pane.clientHeight)
}

function scrollRatio(pane: HTMLElement): number {
  const max = maxScroll(pane)
  if (max <= 0) {
    return 0
  }
  return Math.min(1, Math.max(0, pane.scrollTop / max))
}

function contentTop(pane: HTMLElement, element: Element): number {
  return (
    element.getBoundingClientRect().top -
    pane.getBoundingClientRect().top +
    pane.scrollTop
  )
}

function setScroll(
  side: 'left' | 'right',
  pane: HTMLElement,
  top: number,
): void {
  const clamped = Math.max(0, Math.min(top, maxScroll(pane)))
  if (Math.abs(pane.scrollTop - clamped) < 0.5) {
    return
  }
  pendingScroll.set(side, { top: clamped, until: Date.now() + 100 })
  pane.scrollTop = clamped
}

/**
 * Whether the current `scroll` event was produced by our own `scrollTop` write.
 * When it is, the event is ignored, so the panes do not drive each other in a
 * loop. A user scroll moves the pane away from the position we wrote, which
 * clears the marker immediately.
 */
function consumeProgrammaticScroll(
  side: 'left' | 'right',
  pane: HTMLElement,
): boolean {
  const pending = pendingScroll.get(side)
  if (pending === undefined) {
    return false
  }
  if (Date.now() >= pending.until) {
    pendingScroll.delete(side)
    return false
  }
  if (Math.abs(pane.scrollTop - pending.top) <= 2) {
    return true
  }
  pendingScroll.delete(side)
  return false
}

/**
 * The last anchor at or above the viewport top, or the first anchor when the
 * pane is scrolled above all of them. Anchors are nested in document order, so
 * the deepest matching anchor is also the most precise one.
 */
function anchorAtTop(pane: HTMLElement): HTMLElement | undefined {
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
  return best ?? first
}

function syncFrom(side: 'left' | 'right'): void {
  if (!leftPane || !rightPane) {
    return
  }
  const source = side === 'left' ? leftPane : rightPane
  const target = side === 'left' ? rightPane : leftPane
  const targetSide = side === 'left' ? 'right' : 'left'
  const ratio = scrollRatio(source)
  const sourceAnchor = anchorAtTop(source)
  const anchorId = sourceAnchor?.getAttribute('data-adoc-diff-anchor')
  const targetAnchor = anchorId
    ? target.querySelector<HTMLElement>(`[data-adoc-diff-anchor="${anchorId}"]`)
    : null
  if (sourceAnchor && targetAnchor) {
    const sourceOffset =
      sourceAnchor.getBoundingClientRect().top -
      source.getBoundingClientRect().top
    const targetOffset =
      targetAnchor.getBoundingClientRect().top -
      target.getBoundingClientRect().top
    setScroll(
      targetSide,
      target,
      target.scrollTop + targetOffset - sourceOffset,
    )
  } else {
    setScroll(targetSide, target, ratio * maxScroll(target))
  }
}

/* ------------------------------------------------------------------ */
/* Source-line restore and reporting                                    */
/* ------------------------------------------------------------------ */

function lineOfElement(element: Element): number | undefined {
  const attr = element.getAttribute('data-line')
  if (attr !== null) {
    const value = Number(attr)
    if (Number.isFinite(value)) {
      return value
    }
  }
  for (const className of (element.getAttribute('class') ?? '').split(/\s+/)) {
    const match = /^data-line-(\d+)$/.exec(className)
    if (match) {
      return Number(match[1])
    }
  }
  return undefined
}

function collectLineAnchors(pane: HTMLElement): LineAnchor[] {
  const anchors: LineAnchor[] = []
  for (const element of pane.querySelectorAll<HTMLElement>(
    '[class*="data-line-"], [data-line]',
  )) {
    const line = lineOfElement(element)
    if (line !== undefined) {
      anchors.push({ element, line })
    }
  }
  return anchors
}

const leftLineAnchors = leftPane ? collectLineAnchors(leftPane) : []
const rightLineAnchors = rightPane ? collectLineAnchors(rightPane) : []

function lineAtTop(pane: HTMLElement, anchors: readonly LineAnchor[]) {
  const paneTop = pane.getBoundingClientRect().top
  let first: number | undefined
  let best: number | undefined
  for (const anchor of anchors) {
    if (anchor.element.getClientRects().length === 0) {
      continue
    }
    first ??= anchor.line
    if (anchor.element.getBoundingClientRect().top - paneTop <= 1) {
      best = anchor.line
    }
  }
  return best ?? first
}

function anchorForLine(
  anchors: readonly LineAnchor[],
  line: number,
): LineAnchor | undefined {
  let previous: LineAnchor | undefined
  for (const anchor of anchors) {
    if (anchor.line >= line) {
      return anchor
    }
    previous = anchor
  }
  return previous
}

function scrollPaneToLine(
  side: 'left' | 'right',
  pane: HTMLElement,
  anchors: readonly LineAnchor[],
  line: number,
): boolean {
  const anchor = anchorForLine(anchors, line)
  if (!anchor || anchor.element.getClientRects().length === 0) {
    return false
  }
  setScroll(side, pane, contentTop(pane, anchor.element) - 8)
  return true
}

/**
 * Maps the line recorded in one pane to the other pane through the source-line
 * map. This is the fallback for an added/removed region, where the recorded
 * line does not exist on the other side.
 */
function mapLineForSide(
  side: 'left' | 'right',
  line: number,
): number | undefined {
  const entries = settings.lineMap ?? []
  if (entries.length === 0) {
    return undefined
  }
  let best = entries[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const entry of entries) {
    const value = side === 'left' ? entry.leftLine : entry.rightLine
    const distance = Math.abs(value - line)
    if (distance < bestDistance) {
      bestDistance = distance
      best = entry
    }
  }
  return side === 'left' ? best.rightLine : best.leftLine
}

function restoreScroll(): void {
  const leftLine =
    typeof settings.leftLine === 'number'
      ? settings.leftLine
      : typeof settings.rightLine === 'number'
        ? mapLineForSide('right', settings.rightLine)
        : undefined
  const rightLine =
    typeof settings.rightLine === 'number'
      ? settings.rightLine
      : typeof settings.leftLine === 'number'
        ? mapLineForSide('left', settings.leftLine)
        : undefined
  let restored = false
  if (leftPane && leftLine !== undefined) {
    restored =
      scrollPaneToLine('left', leftPane, leftLineAnchors, leftLine) || restored
  }
  if (rightPane && rightLine !== undefined) {
    restored =
      scrollPaneToLine('right', rightPane, rightLineAnchors, rightLine) ||
      restored
  }
  if (
    !restored &&
    typeof settings.ratio === 'number' &&
    leftPane &&
    rightPane
  ) {
    const ratio = Math.min(1, Math.max(0, settings.ratio))
    setScroll('left', leftPane, ratio * maxScroll(leftPane))
    setScroll('right', rightPane, ratio * maxScroll(rightPane))
  }
}

/* ------------------------------------------------------------------ */
/* Hunks: the navigation unit                                           */
/* ------------------------------------------------------------------ */

let hunks: string[] = []
const hunkIndexById = new Map<string, number>()
let currentHunk = -1

function collectHunks(): void {
  const seen = new Set<string>()
  hunks = []
  for (const pane of [leftPane, rightPane]) {
    if (!pane) {
      continue
    }
    for (const element of pane.querySelectorAll<HTMLElement>(
      '[data-adoc-diff-hunk]',
    )) {
      const id = element.getAttribute('data-adoc-diff-hunk')
      if (id !== null && !seen.has(id)) {
        seen.add(id)
        hunks.push(id)
      }
    }
  }
  hunkIndexById.clear()
  hunks.forEach((id, index) => hunkIndexById.set(id, index))
}

function hunkTargets(id: string): HunkTarget[] {
  const targets: HunkTarget[] = []
  for (const pane of [leftPane, rightPane]) {
    if (!pane) {
      continue
    }
    const element = pane.querySelector<HTMLElement>(
      `[data-adoc-diff-hunk="${id}"]`,
    )
    if (element) {
      targets.push({ pane, element })
    }
  }
  return targets
}

function topHunkIndex(pane: HTMLElement | null): number {
  if (!pane) {
    return -1
  }
  const paneTop = pane.getBoundingClientRect().top
  let best = -1
  for (const element of pane.querySelectorAll<HTMLElement>(
    '[data-adoc-diff-hunk]',
  )) {
    if (element.getClientRects().length === 0) {
      continue
    }
    const index = hunkIndexById.get(
      element.getAttribute('data-adoc-diff-hunk') ?? '',
    )
    if (index === undefined) {
      continue
    }
    if (element.getBoundingClientRect().top - paneTop <= 1) {
      best = Math.max(best, index)
    } else {
      break
    }
  }
  return best
}

function updateCurrentHunk(): void {
  if (hunks.length === 0) {
    currentHunk = -1
    return
  }
  // The left pane owns most of the order; fall back to the right one for a hunk
  // that only exists there.
  const fromLeft = topHunkIndex(leftPane)
  const index = fromLeft >= 0 ? fromLeft : topHunkIndex(rightPane)
  // `-1` means "no hunk at or above the viewport yet": the status still shows
  // `1 / N`, and the first click jumps to the first change instead of skipping
  // it.
  currentHunk = index >= 0 ? index : -1
}

function expandForHunk(id: string): void {
  let changed = false
  for (const target of hunkTargets(id)) {
    const collapsed = target.element.closest<HTMLElement>(
      '[data-adoc-diff-collapsed]',
    )
    if (!collapsed) {
      continue
    }
    collapsed.classList.add('adoc-diff-expanded')
    collapsed.title = text(
      'collapseCollapse',
      'Click to collapse deleted block',
    )
    changed = true
  }
  if (changed) {
    alignment?.refresh()
    post('setExpanded', { keys: alignment?.expandedKeys() ?? [] })
  }
}

function flashElement(element: HTMLElement): void {
  element.classList.add('adoc-diff-hunk-target')
  window.setTimeout(() => {
    element.classList.remove('adoc-diff-hunk-target')
  }, 1600)
}

function flashHunk(id: string): void {
  for (const target of hunkTargets(id)) {
    flashElement(target.element)
  }
}

function goToHunk(index: number): void {
  if (hunks.length === 0) {
    return
  }
  const normalized = ((index % hunks.length) + hunks.length) % hunks.length
  currentHunk = normalized
  const id = hunks[normalized]
  expandForHunk(id)
  const targets = hunkTargets(id)
  for (const target of targets) {
    const side = target.pane === leftPane ? 'left' : 'right'
    setScroll(side, target.pane, contentTop(target.pane, target.element) - 8)
  }
  if (targets.length === 1) {
    // The hunk exists on one side only (its gap target already carried another
    // hunk): move the other pane by the nearest anchor.
    syncFrom(targets[0].pane === leftPane ? 'left' : 'right')
  }
  flashHunk(id)
  updateStatus()
  // The programmatic scroll is ignored by the scroll handler; report the new
  // reading position so a later live re-render restores the visited hunk.
  scheduleScrollPost()
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

function countNonVisual(): string {
  const stats = settings.stats
  const parts: string[] = []
  const formatting = stats?.formattingChanges ?? 0
  const link = stats?.linkChanges ?? 0
  const id = stats?.idChanges ?? 0
  const detail = text(
    'statusNonVisual',
    '{0} formatting / {1} link / {2} id changes',
  )
  if (formatting !== 0 || link !== 0 || id !== 0) {
    parts.push(format(detail, [formatting, link, id]))
  }
  return parts.join(' · ')
}

function navigationSummary(count: number): string {
  return format(
    count === 1
      ? text('statusNavigationSummaryOne', '1 navigation change')
      : text('statusNavigationSummary', '{0} navigation changes'),
    [count],
  )
}

function statusTooltip(navigation: number): string {
  const stats = settings.stats
  if (!stats) {
    return ''
  }
  const summary = format(
    text(
      'statusSummary',
      '{0} change regions · +{1} added blocks · −{2} removed blocks',
    ),
    [stats.changes ?? 0, stats.addedBlocks ?? 0, stats.removedBlocks ?? 0],
  )
  const nonVisual = countNonVisual()
  const navigationDetail =
    navigation > 0 ? text('navigationChanged', 'Table of contents changed') : ''
  const jump = text(
    'statusJump',
    'Click for the next change, Shift+click for the previous',
  )
  return [summary, nonVisual, navigationDetail, jump]
    .filter((part) => part !== '')
    .join('\n')
}

function updateStatus(): void {
  if (!statusElement) {
    return
  }
  const total = hunks.length
  const stats = settings.stats
  const visual = stats?.visualChanges ?? 0
  const nonVisual = stats?.nonVisualChanges ?? 0
  const navigation = stats?.navigationChanges ?? 0
  if (total === 0) {
    if (navigation > 0) {
      statusElement.textContent = `${text('noVisualDifferences', 'No visual text differences')} — ${navigationSummary(navigation)}`
      statusElement.className = 'diff-status diff-status-navigation'
      statusElement.title = text(
        'navigationChanged',
        'Table of contents changed',
      )
      statusElement.removeAttribute('role')
      statusElement.removeAttribute('tabindex')
    } else {
      statusElement.textContent = text('noDifferences', 'No differences')
      statusElement.className = 'diff-status diff-status-clean'
      statusElement.title = ''
      statusElement.removeAttribute('role')
      statusElement.removeAttribute('tabindex')
    }
    if (legendElement) {
      legendElement.hidden = true
    }
    return
  }

  const index = currentHunk >= 0 ? currentHunk : 0
  const busy = statusElement.classList.contains('diff-status-busy')
  statusElement.className = 'diff-status diff-status-clickable'
  if (busy) {
    statusElement.classList.add('diff-status-busy')
  }
  if (visual === 0 && nonVisual > 0) {
    const count = nonVisual + navigation
    const summary = format(
      count === 1
        ? text('statusNonVisualSummaryOne', '1 change')
        : text('statusNonVisualSummary', '{0} changes'),
      [count],
    )
    statusElement.textContent = `${text('noVisualDifferences', 'No visual text differences')} — ${summary}`
  } else {
    // The navigator replaces the marker counters: it counts what the reviewer
    // can actually visit, not the internal `adoc-diff-*` marks.
    statusElement.textContent = `${index + 1} / ${total}`
  }
  statusElement.title = statusTooltip(navigation)
  statusElement.setAttribute('role', 'button')
  statusElement.tabIndex = 0
  if (legendElement) {
    legendElement.hidden =
      settings.showStats === false || (visual === 0 && nonVisual > 0)
  }
}

statusElement?.addEventListener('click', (event) => {
  if (statusElement.classList.contains('diff-status-clean')) {
    return
  }
  if (hunks.length === 0) {
    return
  }
  const step = event.shiftKey ? -1 : 1
  goToHunk(
    currentHunk < 0 ? (step < 0 ? hunks.length - 1 : 0) : currentHunk + step,
  )
})

statusElement?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return
  }
  event.preventDefault()
  if (hunks.length === 0) {
    return
  }
  goToHunk(currentHunk < 0 ? 0 : currentHunk + 1)
})

let busyTimer: number | undefined

function setBusy(busy: boolean): void {
  if (!statusElement) {
    return
  }
  if (busy) {
    statusElement.classList.add('diff-status-busy')
    if (busyTimer === undefined) {
      busyTimer = window.setTimeout(() => {
        busyTimer = undefined
        if (
          statusElement.classList.contains('diff-status-busy') &&
          statusElement.textContent === ''
        ) {
          statusElement.textContent = text('rendering', 'Rendering…')
        }
      }, 400)
    }
  } else {
    if (busyTimer !== undefined) {
      window.clearTimeout(busyTimer)
      busyTimer = undefined
    }
    statusElement.classList.remove('diff-status-busy')
    updateStatus()
  }
}

function setError(message: string): void {
  if (!statusElement) {
    return
  }
  statusElement.textContent =
    message || text('error', 'Unable to render the diff')
  statusElement.className = 'diff-status diff-status-error'
}

/* ------------------------------------------------------------------ */
/* Expanded state, labels and tooltips                                  */
/* ------------------------------------------------------------------ */

function applyExpandedState(): void {
  const keys = new Set(settings.expanded ?? [])
  if (keys.size === 0) {
    return
  }
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-adoc-diff-collapse-key]',
  )) {
    const key = element.getAttribute('data-adoc-diff-collapse-key') ?? ''
    if (keys.has(key)) {
      element.classList.add('adoc-diff-expanded')
    }
  }
}

function applyCollapseLabels(): void {
  const label = text('collapseLabel', '{0} lines')
  const labelWithExcerpt = text('collapseLabelWithExcerpt', '{0} lines · {1}')
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-adoc-diff-collapsed]',
  )) {
    const lines = element.getAttribute('data-adoc-diff-collapse-lines') ?? ''
    const excerpt =
      element.getAttribute('data-adoc-diff-collapse-excerpt') ?? ''
    const value =
      excerpt !== ''
        ? format(labelWithExcerpt, [lines, excerpt])
        : format(label, [lines])
    element.setAttribute('data-adoc-diff-collapse-label', value)
    element.title = element.classList.contains('adoc-diff-expanded')
      ? text('collapseCollapse', 'Click to collapse deleted block')
      : text('collapseExpand', 'Click to expand deleted block')
  }
}

function applyMarkerTooltips(): void {
  const titles: Record<string, string> = {
    formatting: text('nonVisualFormatting', 'Formatting changed here'),
    link: text('nonVisualLink', 'Link target changed here'),
    id: text('nonVisualId', 'Anchor id changed here'),
  }
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-adoc-diff-nonvisual]',
  )) {
    const kind =
      element.getAttribute('data-adoc-diff-nonvisual') ?? 'formatting'
    element.title = titles[kind] ?? titles.formatting
  }
  // The left-margin icon carries its explanation as a tooltip on the block
  // itself: a pseudo-element cannot have its own title. Only the elements that
  // actually draw the icon get it, so text blocks with word markers and code
  // blocks with line markers stay tooltip-free.
  const mediaTitle = text('mediaChanged', 'Changed image or diagram')
  const blockTitle = text('blockChanged', 'Changed block')
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-adoc-diff-icon]',
  )) {
    if (element.title !== '') {
      continue
    }
    element.title = element.hasAttribute('data-adoc-diff-media-changed')
      ? mediaTitle
      : blockTitle
  }
}

/* ------------------------------------------------------------------ */
/* Swap                                                                 */
/* ------------------------------------------------------------------ */

function bindSwapButton(): void {
  document
    .getElementById('diff-swap')
    ?.addEventListener('click', () => post('swap'))
}

/* ------------------------------------------------------------------ */
/* Link interception                                                    */
/* ------------------------------------------------------------------ */

function findByIdInPane(
  pane: HTMLElement,
  id: string,
): HTMLElement | undefined {
  for (const element of pane.querySelectorAll<HTMLElement>('[id]')) {
    if (element.id === id) {
      return element
    }
  }
  return undefined
}

function interceptLinks(): void {
  for (const [pane, side] of [
    [leftPane, 'left'],
    [rightPane, 'right'],
  ] as const) {
    if (!pane) {
      continue
    }
    pane.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      const anchor = target.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || !pane.contains(anchor)) {
        return
      }
      const href = anchor.getAttribute('href') ?? ''
      if (href.startsWith('#')) {
        // An in-page link must scroll *this* pane. The document has two panes
        // and duplicate ids, so the global `#id` lookup would scroll the left
        // one from a click in the right one.
        event.preventDefault()
        let id = href.slice(1)
        try {
          id = decodeURIComponent(id)
        } catch {
          // A malformed escape sequence: use the raw fragment.
        }
        const destination = findByIdInPane(pane, id)
        if (destination) {
          setScroll(side, pane, contentTop(pane, destination) - 8)
          syncFrom(side)
        }
        return
      }
      event.preventDefault()
      post('openLink', { href, side })
    })
  }
}

/* ------------------------------------------------------------------ */
/* Startup                                                              */
/* ------------------------------------------------------------------ */

applyExpandedState()

let alignment: AlignmentController | undefined
if (settings.align !== false && leftPane && rightPane) {
  alignment = new AlignmentController(leftPane, rightPane, {
    strings,
    onExpandedChange: (keys) => post('setExpanded', { keys }),
  })
}

collectHunks()
applyCollapseLabels()
applyMarkerTooltips()
bindSwapButton()
interceptLinks()
updateStatus()

leftPane?.addEventListener('scroll', () => onScroll('left'), {
  passive: true,
})
rightPane?.addEventListener('scroll', () => onScroll('right'), {
  passive: true,
})

/* Scroll reporting is throttled: it crosses the webview IPC boundary, and the
 * host only needs the reading position, not every frame. The scroll *sync*
 * itself still runs on every event. */
let postTimer: number | undefined
let lastPostAt = 0

function postScrollState(): void {
  lastPostAt = performance.now()
  post('didScroll', {
    ratio: leftPane ? scrollRatio(leftPane) : 0,
    leftLine: leftPane ? lineAtTop(leftPane, leftLineAnchors) : undefined,
    rightLine: rightPane ? lineAtTop(rightPane, rightLineAnchors) : undefined,
  })
}

function scheduleScrollPost(): void {
  const elapsed = performance.now() - lastPostAt
  if (elapsed >= 150) {
    postScrollState()
    return
  }
  if (postTimer !== undefined) {
    return
  }
  postTimer = window.setTimeout(() => {
    postTimer = undefined
    postScrollState()
  }, 150 - elapsed)
}

let statusTimer: number | undefined

function scheduleStatusUpdate(): void {
  if (statusTimer !== undefined) {
    return
  }
  statusTimer = window.setTimeout(() => {
    statusTimer = undefined
    updateCurrentHunk()
    updateStatus()
  }, 120)
}

function onScroll(side: 'left' | 'right'): void {
  const pane = side === 'left' ? leftPane : rightPane
  if (!pane || consumeProgrammaticScroll(side, pane)) {
    return
  }
  // The alignment controller restores the scroll position by anchors; do not
  // echo that programmatic scroll back into the other pane.
  if (pane.dataset.adocDiffAligning === 'true') {
    return
  }
  // The browser already coalesces `scroll` events to about one per frame, and
  // the synchronization only reads `scrollTop`/`scrollHeight` and writes one
  // `scrollTop`, so run it right away: no extra frame of latency.
  syncFrom(side)
  scheduleScrollPost()
  scheduleStatusUpdate()
}

window.addEventListener('message', (event) => {
  const message = event.data as {
    type?: string
    busy?: boolean
    message?: string
  }
  switch (message?.type) {
    case 'setBusy':
      setBusy(Boolean(message.busy))
      break
    case 'setError':
      setError(message.message ?? '')
      break
  }
})

const startAlignment = (): void => {
  alignment?.start()
}

if (settings.align === false || !alignment) {
  restoreScroll()
  updateCurrentHunk()
  updateStatus()
} else {
  // Restore before the first alignment pass so the controller measures from the
  // position the reader left, not from the top.
  requestAnimationFrame(() => {
    restoreScroll()
    startAlignment()
    updateCurrentHunk()
    updateStatus()
  })
}
