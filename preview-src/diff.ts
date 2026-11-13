/**
 * Client entry point of the diff panel.
 *
 * Both previews are rendered into the same webview document, one per scrollable
 * pane (`#diff-left`, `#diff-right`). This script keeps their vertical scroll in
 * sync, reports the scroll ratio, and renders the status.
 *
 * The panes are synchronized *proportionally* (the same fraction of the
 * scrollable range on each side). This is cheap enough to run every frame — no
 * DOM measurement — so the driven pane scrolls as smoothly as the active one,
 * and it is symmetric at the edges: both panes start at the top and end at the
 * bottom together, which removes the jump that an anchor-based mapping causes
 * when one side is clamped at its end.
 */

import { AlignmentController } from './diff-align.js'

interface Settings {
  align?: boolean
  showStats?: boolean
  ratio?: number
  strings?: Record<string, string>
  stats?: {
    addedBlocks: number
    removedBlocks: number
    changedBlocks: number
    changedTables: number
    changedCells: number
  }
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

const alignment =
  settings.align !== false && leftPane && rightPane
    ? new AlignmentController(leftPane, rightPane)
    : undefined
alignment?.start()

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
}

// A docinfo script may have acquired the webview API already; scrolling still
// works without it, only `didScroll` is lost.
let api: { postMessage(message: unknown): void } | undefined
try {
  api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined
} catch {
  api = undefined
}

function post(type: string, body: Record<string, unknown> = {}) {
  api?.postMessage({ type, ...body })
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
  post('didScroll', { ratio })
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
}

leftPane?.addEventListener('scroll', () => onScroll('left'), {
  passive: true,
})
rightPane?.addEventListener('scroll', () => onScroll('right'), {
  passive: true,
})

document
  .getElementById('diff-swap')
  ?.addEventListener('click', () => post('swap'))

const CHANGE_SELECTOR = [
  '.adoc-diff-block-ins',
  '.adoc-diff-block-del',
  '.adoc-diff-block-changed',
  '.adoc-diff-table-ins',
  '.adoc-diff-table-del',
  '.adoc-diff-cell-changed',
  '.adoc-diff-word-ins',
  '.adoc-diff-word-del',
  '.adoc-diff-code-line-add',
  '.adoc-diff-code-line-del',
  '.adoc-diff-code-line-changed',
  'tr.adoc-diff-row-ins',
  'tr.adoc-diff-row-del',
  'tr.adoc-diff-row-gap',
].join(',')

function contentTop(pane: HTMLElement, element: Element): number {
  return (
    element.getBoundingClientRect().top -
    pane.getBoundingClientRect().top +
    pane.scrollTop
  )
}

function firstChange(): void {
  if (!leftPane || !rightPane) {
    return
  }
  // A change can be present only on one side (an added or removed block), so
  // look at both panes and jump to the earliest one in document order.
  let target:
    | { pane: HTMLElement; element: HTMLElement; top: number }
    | undefined
  for (const pane of [leftPane, rightPane]) {
    const element = pane.querySelector<HTMLElement>(CHANGE_SELECTOR)
    if (!element) {
      continue
    }
    const top = contentTop(pane, element)
    if (!target || top < target.top) {
      target = { pane, element, top }
    }
  }
  if (!target) {
    return
  }
  const anchor =
    target.element.closest<HTMLElement>('[data-adoc-diff-anchor]') ??
    target.element
  const id = anchor.getAttribute('data-adoc-diff-anchor')
  for (const [pane, side] of [
    [leftPane, 'left'],
    [rightPane, 'right'],
  ] as const) {
    const anchorElement =
      pane === target.pane
        ? anchor
        : id
          ? pane.querySelector<HTMLElement>(`[data-adoc-diff-anchor="${id}"]`)
          : null
    if (!anchorElement) {
      continue
    }
    const offset =
      anchorElement.getBoundingClientRect().top -
      pane.getBoundingClientRect().top
    setScroll(side, pane, pane.scrollTop + offset)
  }
}

statusElement?.addEventListener('click', () => {
  if (statusElement.classList.contains('diff-status-clean')) {
    return
  }
  firstChange()
})

function updateStatus(): void {
  if (!statusElement) {
    return
  }
  const stats = settings.stats
  const total =
    (stats?.addedBlocks ?? 0) +
    (stats?.removedBlocks ?? 0) +
    (stats?.changedBlocks ?? 0) +
    (stats?.changedTables ?? 0) +
    (stats?.changedCells ?? 0)
  if (total === 0) {
    statusElement.textContent = strings.noDifferences ?? 'No differences'
    statusElement.className = 'diff-status diff-status-clean'
    statusElement.title = ''
    if (legendElement) {
      legendElement.hidden = true
    }
  } else if (settings.showStats === false) {
    statusElement.textContent = ''
    statusElement.className = 'diff-status'
    statusElement.title = ''
    if (legendElement) {
      legendElement.hidden = true
    }
  } else {
    const added = stats?.addedBlocks ?? 0
    const removed = stats?.removedBlocks ?? 0
    const changed =
      (stats?.changedBlocks ?? 0) +
      (stats?.changedTables ?? 0) +
      (stats?.changedCells ?? 0)
    statusElement.textContent = `+${added} −${removed} ~${changed}`
    statusElement.className = 'diff-status diff-status-clickable'
    statusElement.title = `${added} added, ${removed} removed, ${changed} changed — click to jump to the first change`
    if (legendElement) {
      legendElement.hidden = false
    }
  }
}

function setBusy(busy: boolean): void {
  if (!statusElement) {
    return
  }
  if (busy) {
    statusElement.textContent = strings.rendering ?? 'Rendering…'
    statusElement.className = 'diff-status diff-status-busy'
  } else {
    updateStatus()
  }
}

function setError(message: string): void {
  if (!statusElement) {
    return
  }
  statusElement.textContent =
    message || strings.error || 'Unable to render the diff'
  statusElement.className = 'diff-status diff-status-error'
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

updateStatus()

// Restore the last position after a re-render.
if (leftPane && rightPane && typeof settings.ratio === 'number') {
  const ratio = Math.min(1, Math.max(0, settings.ratio))
  requestAnimationFrame(() => {
    setScroll('left', leftPane, ratio * maxScroll(leftPane))
    setScroll('right', rightPane, ratio * maxScroll(rightPane))
  })
}
