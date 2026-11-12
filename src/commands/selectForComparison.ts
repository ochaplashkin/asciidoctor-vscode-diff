import * as vscode from 'vscode'
import { Command } from '../core/commandManager.js'
import { CompareSelection } from '../features/diff/compareSelection.js'

/**
 * Remembers the clicked (or active) file as the first side of the next
 * comparison. Selecting another file replaces the previous choice, which is how
 * the user re-selects the first file.
 */
export class SelectForComparisonCommand implements Command {
  public readonly id = 'asciidoc.selectForComparison'

  constructor(private readonly selection: CompareSelection) {}

  public execute(uri?: vscode.Uri): void {
    const resource = uri ?? vscode.window.activeTextEditor?.document.uri
    if (resource !== undefined) {
      this.selection.select(resource)
    }
  }
}
