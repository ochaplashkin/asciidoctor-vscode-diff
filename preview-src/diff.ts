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

interface Settings {
  ratio?: number
  strings?: Record<string, string>
  stats?: {
    addedBlocks: number
    removedBlocks: number
    changedBlocks: number
    changedTables: number
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

function syncFrom(side: 'left' | 'right'): void {
  if (!leftPane || !rightPane) {
    return
  }
  const source = side === 'left' ? leftPane : rightPane
  const target = side === 'left' ? rightPane : leftPane
  const targetSide = side === 'left' ? 'right' : 'left'
  const ratio = scrollRatio(source)
  setScroll(targetSide, target, ratio * maxScroll(target))
  post('didScroll', { ratio })
}

function onScroll(side: 'left' | 'right'): void {
  const pane = side === 'left' ? leftPane : rightPane
  if (!pane || consumeProgrammaticScroll(side, pane)) {
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

function updateStatus(): void {
  if (!statusElement) {
    return
  }
  const stats = settings.stats
  const total =
    (stats?.addedBlocks ?? 0) +
    (stats?.removedBlocks ?? 0) +
    (stats?.changedBlocks ?? 0) +
    (stats?.changedTables ?? 0)
  if (total === 0) {
    statusElement.textContent = strings.noDifferences ?? 'No differences'
    statusElement.className = 'diff-status diff-status-clean'
  } else {
    statusElement.textContent = ''
    statusElement.className = 'diff-status'
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
