import * as vscode from 'vscode'
import { Disposable } from '../../core/dispose.js'
import { isAsciidocFile } from '../../core/file.js'
import { t as l10nT } from '../../core/l10n.js'
import { Logger } from '../../core/logger.js'
import { AsciidocPreviewManager } from './previewManager.js'

/** `asciidoc.preview.openInPreview`: open `.adoc` files as rendered pages. */
export const OPEN_IN_PREVIEW_SETTING = 'preview.openInPreview'

/**
 * Context key mirroring {@link OPEN_IN_PREVIEW_SETTING}. Menu and `when`
 * clauses use it to show the applicable part of the toggle (open in preview vs
 * open in source) and to switch the preview title-bar action.
 */
export const OPEN_IN_PREVIEW_CONTEXT_KEY = 'asciidoc.preview.openInPreview'

/**
 * Opens AsciiDoc documents in the rendered preview instead of the source
 * editor when `asciidoc.preview.openInPreview` is enabled.
 *
 * The extension has no "before a file opens" hook, so the file is first opened
 * by VS Code as usual and this manager swaps the newly created source tab for a
 * preview tab in the same editor group. The preview reuses the normal preview
 * pipeline, so links, scrolling, styles and live updates keep working without a
 * second implementation.
 *
 * When VS Code activates the extension *because* an AsciiDoc file was opened,
 * the tab already exists by the time `activate()` runs (the extension host is
 * started asynchronously), so there is no tab-open event to react to. The
 * extension calls {@link redirectActiveEditor} once at the end of activation to
 * cover that first file.
 */
export class PreviewOnOpenManager extends Disposable {
  private readonly logger: Logger

  public constructor(
    private readonly previewManager: AsciidocPreviewManager,
    logger?: Logger,
  ) {
    super()
    this.logger = logger ?? new Logger()
    this._register(
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        this.onDidChangeTabs(event)
      }),
    )
    this._register(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`asciidoc.${OPEN_IN_PREVIEW_SETTING}`)) {
          this.updateContext().then(undefined, (error) =>
            this.logger.error(`Unable to update the preview context: ${error}`),
          )
        }
      }),
    )
    this.updateContext().then(undefined, (error) =>
      this.logger.error(`Unable to update the preview context: ${error}`),
    )
  }

  /** Whether files should currently open in the preview. */
  public get enabled(): boolean {
    return (
      vscode.workspace
        .getConfiguration('asciidoc')
        .get<boolean>(OPEN_IN_PREVIEW_SETTING, false) === true
    )
  }

  /**
   * Persists the toggle in the scope that already overrides it (workspace or
   * user settings), so the context menu action changes the value the user
   * actually sees. It never silently overrides a workspace-level choice with a
   * user-level one.
   */
  public async setEnabled(value: boolean): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('asciidoc')
    const inspected = configuration.inspect<boolean>(OPEN_IN_PREVIEW_SETTING)
    const target =
      inspected?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global
    await configuration.update(OPEN_IN_PREVIEW_SETTING, value, target)
    await this.updateContext()
    vscode.window.setStatusBarMessage(
      value
        ? l10nT('preview.openInPreview.enabled')
        : l10nT('preview.openInPreview.disabled'),
      4000,
    )
  }

  /**
   * Swaps the active AsciiDoc source editor for a preview.
   *
   * Called once at activation, to cover the file whose opening activated the
   * extension. It deliberately handles only the active editor: restored
   * background tabs stay as they are instead of opening a preview for every
   * file of the window (the preview would end up showing only the last one).
   */
  public redirectActiveEditor(): void {
    if (!this.enabled) {
      return
    }
    const editor = vscode.window.activeTextEditor
    if (!editor || !isAsciidocFile(editor.document)) {
      return
    }
    const resource = editor.document.uri
    if (this.previewManager.hasPreviewFor(resource)) {
      return
    }
    const tab = this.findSourceTab(resource)
    if (!tab || tab.isDirty) {
      return
    }
    this.showPreviewForTab(tab, resource)
  }

  private onDidChangeTabs(event: vscode.TabChangeEvent): void {
    if (!this.enabled) {
      return
    }
    for (const tab of event.opened) {
      this.redirectTab(tab).then(undefined, (error) =>
        this.logger.error(`Unable to open the preview: ${error}`),
      )
    }
  }

  private async redirectTab(tab: vscode.Tab): Promise<void> {
    if (!this.enabled || !(tab.input instanceof vscode.TabInputText)) {
      return
    }
    if (tab.isDirty) {
      return
    }
    const resource = tab.input.uri
    // A source editor opened from the preview on purpose (the "View Source
    // Code" action) must stay open: the preview already exists for it.
    if (this.previewManager.hasPreviewFor(resource)) {
      return
    }
    // The tab opened event can fire before the document is registered in
    // `workspace.textDocuments`; resolving it also gives us the language id,
    // which is the only reliable AsciiDoc test (a file association can map any
    // extension to the language).
    let document: vscode.TextDocument
    try {
      document = await vscode.workspace.openTextDocument(resource)
    } catch {
      return
    }
    // The setting or the window may have changed while the document loaded.
    if (!this.enabled || !isAsciidocFile(document)) {
      return
    }
    if (this.previewManager.hasPreviewFor(resource)) {
      return
    }
    // The user may have closed the source tab in the meantime.
    if (this.findSourceTab(resource) === undefined) {
      return
    }
    this.showPreviewForTab(tab, resource)
  }

  private showPreviewForTab(tab: vscode.Tab, resource: vscode.Uri): void {
    // Join the group that already shows preview-first files when there is one.
    // The source tab may have been opened in another group (notably in the
    // source panel to the left of the previews), and previews must stay
    // together as tabs of the same panel.
    const column =
      this.previewManager.previewFirstColumn ?? tab.group.viewColumn
    // Open the preview before closing the source tab: the preview keeps the
    // editor group alive (closing its last tab could otherwise close the group
    // and shift the following columns).
    this.previewManager.preview(resource, {
      resourceColumn: column,
      previewColumn: column,
      locked: false,
      // Preview-first files get one tab each, so opening another file adds a
      // tab to the same group instead of replacing this preview.
      ownTab: true,
    })
    // The preview now has its own tab (in the preview panel, which may be
    // another group when the source panel is open), so the source tab can go
    // away. `close` is asynchronous and may be refused (e.g. a dirty editor),
    // in which case the preview and the editor are simply both open.
    vscode.window.tabGroups.close(tab).then(
      (closed) => {
        if (!closed) {
          this.logger.debug(
            `Could not close the source tab of ${resource.toString()}`,
          )
        }
      },
      (error) => {
        this.logger.error(
          `Unable to open the preview instead of the source: ${error}`,
        )
      },
    )
  }

  private findSourceTab(resource: vscode.Uri): vscode.Tab | undefined {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.toString() === resource.toString()
        ) {
          return tab
        }
      }
    }
    return undefined
  }

  private updateContext(): Thenable<unknown> {
    return vscode.commands.executeCommand(
      'setContext',
      OPEN_IN_PREVIEW_CONTEXT_KEY,
      this.enabled,
    )
  }
}
