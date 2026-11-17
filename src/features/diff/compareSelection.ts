import * as path from 'node:path'
import * as vscode from 'vscode'
import { Disposable } from '../../core/dispose.js'
import { t } from '../../core/l10n.js'
import type { PreserveSelectionMode } from './preserveSelectionMode.js'
import { truncateFileName } from './selectionLabel.js'

/**
 * Context key set while at least one file is selected for comparison. The
 * Explorer context menu uses it to show "Compare with Selected File" and
 * "Clear Comparison Selection" only when they make sense.
 */
export const COMPARE_SELECTION_CONTEXT_KEY = 'asciidoc.compare.hasSelection'

/** The two files of a comparison, in the order shown by the diff panel. */
export interface CompareSelectionPair {
  readonly left: vscode.Uri
  readonly right: vscode.Uri
}

/**
 * Remembers the files picked for the next comparison.
 *
 * A selection can hold one file or a pair. "Select for Comparison" creates the
 * single-file form: that file is the old/left side of the next "Compare". A
 * comparison can leave its pair selected (see `asciidoc.diff.preserveSelection`),
 * in which case both files keep their `⇄` badge and invoking "Compare" on either
 * of them reopens the same pair.
 *
 * The selection can be changed at any time (selecting another file replaces the
 * previous selection) and is cleared by "Clear Comparison Selection".
 */
export class CompareSelection
  extends Disposable
  implements vscode.FileDecorationProvider
{
  private _left: vscode.Uri | undefined
  private _right: vscode.Uri | undefined
  private readonly _onDidChange = this._register(
    new vscode.EventEmitter<vscode.Uri | undefined>(),
  )
  public readonly onDidChange = this._onDidChange.event

  private readonly _onDidChangeDecorations = this._register(
    new vscode.EventEmitter<vscode.Uri[]>(),
  )
  public readonly onDidChangeFileDecorations =
    this._onDidChangeDecorations.event

  private readonly statusBar: vscode.StatusBarItem

  constructor() {
    super()
    this._register(vscode.window.registerFileDecorationProvider(this))
    this.statusBar = this._register(
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100),
    )
    this.statusBar.color = new vscode.ThemeColor(
      'statusBarItem.prominentForeground',
    )
    this.statusBar.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.prominentBackground',
    )
    this.updateContext()
  }

  public get left(): vscode.Uri | undefined {
    return this._left
  }

  public get right(): vscode.Uri | undefined {
    return this._right
  }

  /** Both sides, when the selection is a saved comparison pair. */
  public get pair(): CompareSelectionPair | undefined {
    if (this._left === undefined || this._right === undefined) {
      return undefined
    }
    return { left: this._left, right: this._right }
  }

  /**
   * The file the next comparison uses as its old/left side. When only the
   * second file of a comparison was kept, it is that file: a single selection is
   * always consumed as the old side.
   */
  public get selected(): vscode.Uri | undefined {
    return this._left ?? this._right
  }

  public get hasSelection(): boolean {
    return this._left !== undefined || this._right !== undefined
  }

  /** Selects a single file for comparison, replacing any previous selection. */
  public select(uri: vscode.Uri): void {
    this.setSelection(uri, undefined)
  }

  /** Selects both sides of a comparison. */
  public selectPair(left: vscode.Uri, right: vscode.Uri): void {
    this.setSelection(left, right)
  }

  /**
   * Applies `asciidoc.diff.preserveSelection` once a comparison panel closes.
   * `left` and `right` are the files that were compared.
   */
  public restoreAfterComparison(
    left: vscode.Uri,
    right: vscode.Uri,
    mode: PreserveSelectionMode,
  ): void {
    switch (mode) {
      case 'both':
        this.selectPair(left, right)
        break
      case 'first':
        this.select(left)
        break
      case 'second':
        this.select(right)
        break
      case 'none':
        this.clear()
        break
    }
  }

  /** Clears the selection, if any. */
  public clear(): void {
    if (this._left === undefined && this._right === undefined) {
      return
    }
    this.setSelection(undefined, undefined)
  }

  public provideFileDecoration(
    uri: vscode.Uri,
  ): vscode.FileDecoration | undefined {
    if (!this.matches(uri)) {
      return undefined
    }
    return new vscode.FileDecoration(
      '⇄',
      t('diff.selection.decorationTooltip'),
      // VS Code forces the badge of a focused, selected Explorer row to inherit
      // the selection foreground (`iconlabel.css`), so no badge color survives
      // while the row is selected. Blue is the intended accent for the normal
      // state; the prominent status bar entry keeps the selection visible when
      // the row is grayed out.
      new vscode.ThemeColor('charts.blue'),
    )
  }

  private setSelection(
    left: vscode.Uri | undefined,
    right: vscode.Uri | undefined,
  ): void {
    if (
      sameOptionalUri(this._left, left) &&
      sameOptionalUri(this._right, right)
    ) {
      return
    }
    const previous = [this._left, this._right].filter(
      (uri): uri is vscode.Uri => uri !== undefined,
    )
    this._left = left
    this._right = right
    this.onSelectionChanged(previous)
    this._onDidChange.fire(this.selected)
  }

  private matches(uri: vscode.Uri): boolean {
    return (
      (this._left !== undefined && sameUri(uri, this._left)) ||
      (this._right !== undefined && sameUri(uri, this._right))
    )
  }

  private onSelectionChanged(previous: readonly vscode.Uri[]): void {
    this.updateContext()
    this.updateStatusBar()
    const changed = [...previous, this._left, this._right].filter(
      (uri): uri is vscode.Uri => uri !== undefined,
    )
    this._onDidChangeDecorations.fire([
      ...new Map(changed.map((uri) => [uri.toString(), uri])).values(),
    ])
  }

  private updateContext(): void {
    vscode.commands
      .executeCommand(
        'setContext',
        COMPARE_SELECTION_CONTEXT_KEY,
        this.hasSelection,
      )
      .then()
  }

  private truncatedName(uri: vscode.Uri): string {
    return truncateFileName(path.basename(uri.fsPath))
  }

  private updateStatusBar(): void {
    const left = this._left
    const right = this._right
    if (left === undefined && right === undefined) {
      this.statusBar.hide()
      return
    }
    this.statusBar.command = 'asciidoc.clearComparisonSelection'
    if (left !== undefined && right !== undefined) {
      this.statusBar.text = `$(arrow-swap) ${t(
        'diff.selection.statusBarBoth',
        this.truncatedName(left),
        this.truncatedName(right),
      )}`
      this.statusBar.tooltip = t('diff.selection.statusBarTooltipBoth')
    } else {
      const selected = left ?? right
      if (selected === undefined) {
        this.statusBar.hide()
        return
      }
      this.statusBar.text = `$(arrow-swap) ${t(
        'diff.selection.statusBar',
        this.truncatedName(selected),
      )}`
      this.statusBar.tooltip = t('diff.selection.statusBarTooltip')
    }
    this.statusBar.show()
  }
}

function sameUri(left: vscode.Uri, right: vscode.Uri): boolean {
  return left.toString() === right.toString()
}

function sameOptionalUri(
  left: vscode.Uri | undefined,
  right: vscode.Uri | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right
  }
  return sameUri(left, right)
}
