import * as vscode from 'vscode'
import { Command } from '../core/commandManager.js'
import { t } from '../core/l10n.js'
import { CompareSelection } from '../features/diff/compareSelection.js'
import { AsciidocDiffManager } from '../features/diff/diffManager.js'

/**
 * Compares the previously selected file (old/left) with the clicked (or active)
 * file (new/right), then clears the selection.
 *
 * The selected file can be changed at any time with "Select for Comparison", and
 * picking the selected file itself is rejected so the user can choose another
 * one instead of comparing a file with itself.
 */
export class CompareWithSelectedCommand implements Command {
  public readonly id = 'asciidoc.compareWithSelected'

  constructor(
    private readonly manager: AsciidocDiffManager,
    private readonly selection: CompareSelection,
  ) {}

  public async execute(uri?: vscode.Uri): Promise<void> {
    const selected = this.selection.selected
    if (selected === undefined) {
      vscode.window.showInformationMessage(t('diff.selection.none')).then()
      return
    }
    const target = uri ?? vscode.window.activeTextEditor?.document.uri
    if (target === undefined) {
      return
    }
    if (target.toString() === selected.toString()) {
      vscode.window.showInformationMessage(t('diff.selection.sameFile')).then()
      return
    }
    await this.manager.open(selected, target)
    this.selection.clear()
  }
}
