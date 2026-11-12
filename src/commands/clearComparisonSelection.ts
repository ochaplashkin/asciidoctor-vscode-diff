import { Command } from '../core/commandManager.js'
import { CompareSelection } from '../features/diff/compareSelection.js'

/** Forgets the file picked with "Select for Comparison". */
export class ClearComparisonSelectionCommand implements Command {
  public readonly id = 'asciidoc.clearComparisonSelection'

  constructor(private readonly selection: CompareSelection) {}

  public execute(): void {
    this.selection.clear()
  }
}
