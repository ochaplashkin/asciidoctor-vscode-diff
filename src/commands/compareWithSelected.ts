import * as vscode from 'vscode'
import { Command } from '../core/commandManager.js'
import { t } from '../core/l10n.js'
import { CompareSelection } from '../features/diff/compareSelection.js'
import { AsciidocDiffManager } from '../features/diff/diffManager.js'

function sameUri(left: vscode.Uri, right: vscode.Uri): boolean {
  return left.toString() === right.toString()
}

/**
 * Compares the selected file (old/left) with the clicked (or active) file
 * (new/right).
 *
 * When the selection is a pair kept after a previous comparison, clicking
 * either file reopens that pair instead of starting a new comparison. Selecting
 * any other file compares it with the old side and replaces the pair.
 *
 * The selection is not cleared here: once the comparison panel closes,
 * `asciidoc.diff.preserveSelection` decides which side(s) stay selected.
 */
export class CompareWithSelectedCommand implements Command {
  public readonly id = 'asciidoc.compareWithSelected'

  constructor(
    private readonly manager: AsciidocDiffManager,
    private readonly selection: CompareSelection,
  ) {}

  public async execute(uri?: vscode.Uri): Promise<void> {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri
    if (target === undefined) {
      return
    }
    const pair = this.selection.pair
    if (
      pair !== undefined &&
      (sameUri(target, pair.left) || sameUri(target, pair.right))
    ) {
      await this.manager.open(pair.left, pair.right)
      return
    }
    const selected = this.selection.selected
    if (selected === undefined) {
      vscode.window.showInformationMessage(t('diff.selection.none')).then()
      return
    }
    if (sameUri(target, selected)) {
      vscode.window.showInformationMessage(t('diff.selection.sameFile')).then()
      return
    }
    await this.manager.open(selected, target)
  }
}
