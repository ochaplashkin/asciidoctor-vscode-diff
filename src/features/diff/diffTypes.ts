/**
 * Shared data types for the diff feature.
 *
 * The types used by the vscode-free diff kernel (`DiffRenderResult`,
 * `DiffLineMapEntry`, `DiffStats`) live here so both the kernel and the
 * extension host can import them. `DiffPanelState` references the URIs as
 * strings, so this module stays free of runtime vscode imports.
 */

import type { DiffStats } from './blockDiff.js'
import type { DiffLineMapEntry } from './diffLineMap.js'

export type {
  DiffCodeBlocksMode,
  DiffDeletedBlocksMode,
  DiffRenderOptions,
  DiffStats,
} from './blockDiff.js'
export type { DiffLineMapEntry } from './diffLineMap.js'

export type DiffSide = 'left' | 'right'

export interface DiffRenderResult {
  /** Full HTML of the left preview document, with diff markers. */
  readonly leftHtml: string
  /** Full HTML of the right preview document, with diff markers. */
  readonly rightHtml: string
  readonly lineMap: readonly DiffLineMapEntry[]
  readonly leftLineCount: number
  readonly rightLineCount: number
  readonly stats: DiffStats
}

/** State persisted for panel revive after a window reload. */
export interface DiffPanelState {
  readonly left: string
  readonly right: string
  readonly ratio?: number
  /** Top source line of each pane at the last scroll. */
  readonly leftLine?: number
  readonly rightLine?: number
  /** Collapse keys of deleted blocks the reader expanded. */
  readonly expanded?: readonly string[]
  readonly column?: number
}

/** Webview → extension messages. */
export interface DiffDidScrollMessage {
  readonly type: 'didScroll'
  readonly ratio?: number
  readonly leftLine?: number
  readonly rightLine?: number
}

export interface DiffSwapMessage {
  readonly type: 'swap'
}

export interface DiffSetExpandedMessage {
  readonly type: 'setExpanded'
  readonly keys?: readonly string[]
}

export interface DiffOpenLinkMessage {
  readonly type: 'openLink'
  readonly href?: string
  readonly side?: DiffSide
}

export type DiffFromWebviewMessage =
  | DiffDidScrollMessage
  | DiffSwapMessage
  | DiffSetExpandedMessage
  | DiffOpenLinkMessage

/** Extension → webview messages. */
export interface DiffSetBusyMessage {
  readonly type: 'setBusy'
  readonly busy: boolean
}

export interface DiffSetErrorMessage {
  readonly type: 'setError'
  readonly message: string
}

export type DiffToWebviewMessage = DiffSetBusyMessage | DiffSetErrorMessage
