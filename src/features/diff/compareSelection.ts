import * as path from 'node:path'
import * as vscode from 'vscode'
import { Disposable } from '../../core/dispose.js'
import { t } from '../../core/l10n.js'
import { truncateFileName } from './selectionLabel.js'

/**
 * Context key set while a file is selected for comparison. The Explorer context
 * menu uses it to show "Compare with Selected File" and "Clear Comparison
 * Selection" only when they make sense.
 */
export const COMPARE_SELECTION_CONTEXT_KEY = 'asciidoc.compare.hasSelection'

/**
 * Remembers the file picked with "Select for Comparison".
 *
 * The selected file is decorated in the Explorer with a `⇄` badge and mirrored in
 * the status bar, so the user can see which file the next "Compare with Selected
 * File" will use. The selection can be changed at any time (selecting another
 * file replaces it) and is cleared once a comparison has been opened.
 */
export class CompareSelection
  extends Disposable
  implements vscode.FileDecorationProvider
{
  private _selected: vscode.Uri | undefined
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
    this.updateContext()
  }

  public get selected(): vscode.Uri | undefined {
    return this._selected
  }

  public get hasSelection(): boolean {
    return this._selected !== undefined
  }

  /** Selects a file for comparison, replacing any previous selection. */
  public select(uri: vscode.Uri): void {
    const previous = this._selected
    this._selected = uri
    this.onSelectionChanged(previous)
    this._onDidChange.fire(uri)
  }

  /** Clears the selection, if any. */
  public clear(): void {
    const previous = this._selected
    if (previous === undefined) {
      return
    }
    this._selected = undefined
    this.onSelectionChanged(previous)
    this._onDidChange.fire(undefined)
  }

  public provideFileDecoration(
    uri: vscode.Uri,
  ): vscode.FileDecoration | undefined {
    if (this._selected === undefined || !sameUri(uri, this._selected)) {
      return undefined
    }
    return new vscode.FileDecoration(
      '⇄',
      t('diff.selection.statusBar', this.truncatedName()),
      new vscode.ThemeColor('charts.blue'),
    )
  }

  private onSelectionChanged(previous: vscode.Uri | undefined): void {
    this.updateContext()
    this.updateStatusBar()
    this._onDidChangeDecorations.fire(
      [previous, this._selected].filter(
        (uri): uri is vscode.Uri => uri !== undefined,
      ),
    )
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

  private truncatedName(): string {
    if (this._selected === undefined) {
      return ''
    }
    return truncateFileName(path.basename(this._selected.fsPath))
  }

  private updateStatusBar(): void {
    if (this._selected === undefined) {
      this.statusBar.hide()
      return
    }
    this.statusBar.text = `$(arrow-swap) ${t('diff.selection.statusBar', this.truncatedName())}`
    this.statusBar.tooltip = t('diff.selection.statusBarTooltip')
    this.statusBar.command = 'asciidoc.clearComparisonSelection'
    this.statusBar.show()
  }
}

function sameUri(left: vscode.Uri, right: vscode.Uri): boolean {
  return left.toString() === right.toString()
}
