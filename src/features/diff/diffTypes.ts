/**
 * Shared data types for the diff feature.
 *
 * The types used by the vscode-free diff kernel (`DiffRenderResult`,
 * `DiffLineMapEntry`, `DiffStats`) live here so both the kernel and the
 * extension host can import them. `DiffPair` references `vscode.Uri` through a
 * type-only import, which is erased at compile time and therefore safe for the
 * vscode-free modules that import the rest of this file.
 */

import type { Uri } from 'vscode'
import type { DiffStats } from './blockDiff.js'
import type { DiffLineMapEntry } from './diffLineMap.js'

export type { DiffStats } from './blockDiff.js'
export type { DiffLineMapEntry } from './diffLineMap.js'

export type DiffSide = 'left' | 'right'

export interface DiffPair {
  readonly left: Uri
  readonly right: Uri
}

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
  readonly column?: number
}

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
