import * as vscode from 'vscode'
import { Command } from '../core/commandManager.js'
import { AsciidocPreviewManager } from '../features/preview/previewManager.js'

/**
 * Opens the source of the previewed document in an editor group to the left of
 * the preview, keeping the rendered page visible.
 *
 * The resulting order is Explorer -> source -> rendered document, which reads
 * left to right as "input, then output". The VS Code API can only open an
 * editor group to the *right* of the active one, so the group on the left is
 * created with the workbench's "New Editor Group to the Left" command.
 *
 * Unlike `asciidoc.showSource` (the title-bar toggle, which reveals the source
 * in the preview's own group), this targets the in-page "View Source Code"
 * action of preview-first mode. It reuses an editor that is already visible, a
 * hidden tab in another group, or the source panel opened for a previous file,
 * instead of opening duplicates.
 */
export class ViewSourceCommand implements Command {
  public readonly id = 'asciidoc.viewSource'

  // The group created for the source on the left. Reused for the next file so
  // the sources stay tabs of one panel, mirroring the rendered tabs.
  private sourceColumn: vscode.ViewColumn | undefined

  public constructor(private readonly previewManager: AsciidocPreviewManager) {}

  public async execute(resource?: vscode.Uri) {
    const target = resource ?? this.previewManager.activePreviewResource
    if (!target) {
      return
    }
    const targetString = target.toString()

    const visibleEditor = vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === targetString,
    )
    if (visibleEditor) {
      await vscode.window.showTextDocument(
        visibleEditor.document,
        visibleEditor.viewColumn,
      )
      return
    }

    const document = await vscode.workspace.openTextDocument(target)

    // A source tab may already exist in another group (for example when the
    // preview was opened to the side): activate it instead of opening another
    // copy of the same document. A tab in the preview's own group is skipped:
    // revealing it would hide the preview.
    const previewColumn =
      this.previewManager.revealPreviewFor(target) ??
      this.previewManager.activePreviewColumn
    const existing = vscode.window.tabGroups.all
      .flatMap((group) =>
        group.tabs.map((tab) => ({ column: group.viewColumn, tab })),
      )
      .find(
        ({ column, tab }) =>
          column !== previewColumn &&
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.toString() === targetString,
      )
    if (existing) {
      if (previewColumn !== undefined && existing.column < previewColumn) {
        this.sourceColumn = existing.column
      }
      await vscode.window.showTextDocument(document, existing.column)
      return
    }

    if (this.canReuseSourceColumn(previewColumn)) {
      await vscode.window.showTextDocument(document, this.sourceColumn)
      return
    }

    // The preview must be the active group for "New Editor Group to the Left"
    // to insert the source group immediately before it.
    const groupCount = vscode.window.tabGroups.all.length
    let targetColumn: vscode.ViewColumn | undefined
    try {
      await vscode.commands.executeCommand('workbench.action.newGroupLeft')
      if (vscode.window.tabGroups.all.length > groupCount) {
        targetColumn = vscode.window.tabGroups.activeTabGroup.viewColumn
      }
    } catch {
      // The command is a standard VS Code workbench command; if it is not
      // available, fall back to opening the source beside the preview.
    }

    if (targetColumn !== undefined) {
      this.sourceColumn = targetColumn
    }
    await vscode.window.showTextDocument(document, {
      viewColumn: targetColumn ?? vscode.ViewColumn.Beside,
      preserveFocus: false,
    })
  }

  private canReuseSourceColumn(
    previewColumn: vscode.ViewColumn | undefined,
  ): boolean {
    if (this.sourceColumn === undefined || previewColumn === undefined) {
      return false
    }
    if (this.sourceColumn >= previewColumn) {
      return false
    }
    return vscode.window.tabGroups.all.some(
      (group) => group.viewColumn === this.sourceColumn,
    )
  }
}
