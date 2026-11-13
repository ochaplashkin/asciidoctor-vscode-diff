import * as vscode from 'vscode'
import * as uri from 'vscode-uri'
import { Disposable, disposeAll } from '../../core/dispose.js'
import { t } from '../../core/l10n.js'
import { Logger } from '../../core/logger.js'
import { WebviewResourceProvider } from '../../core/resources.js'
import {
  getWorkspaceFolder,
  getWorkspaceFolders,
} from '../../core/workspace.js'
import { AsciidocContributionProvider } from '../extensionContributions.js'
import { AsciidocPreviewConfigurationManager } from '../preview/previewConfig.js'
import type { DiffDocumentStrings } from './diffDocument.js'
import { diffTitles } from './diffTitle.js'
import type {
  DiffFromWebviewMessage,
  DiffPanelState,
  DiffSide,
  DiffToWebviewMessage,
} from './diffTypes.js'

/**
 * The webview panel hosting the side-by-side rendered diff.
 *
 * The panel implements `WebviewResourceProvider` so the existing preview
 * converter resolves document resources (images, styles, …) to webview URIs.
 */
export class AsciidocDiffPanel
  extends Disposable
  implements WebviewResourceProvider
{
  public static readonly viewType = 'asciidoc.diffPreview'

  private readonly editor: vscode.WebviewPanel
  private left: vscode.Uri
  private right: vscode.Uri
  private _ratio: number | undefined
  private _leftLine: number | undefined
  private _rightLine: number | undefined
  private _expanded: string[] = []
  private disposed = false
  private readonly disposables: vscode.Disposable[] = []

  private readonly _onDidScrollEmitter = new vscode.EventEmitter<number>()
  public readonly onDidScroll = this._onDidScrollEmitter.event

  private readonly _onDisposeEmitter = new vscode.EventEmitter<void>()
  public readonly onDispose = this._onDisposeEmitter.event

  private readonly _onDidRequestSwapEmitter = new vscode.EventEmitter<void>()
  public readonly onDidRequestSwap = this._onDidRequestSwapEmitter.event

  private readonly _onDidChangeViewStateEmitter =
    new vscode.EventEmitter<void>()
  public readonly onDidChangeViewState = this._onDidChangeViewStateEmitter.event

  private readonly _onDidRequestOpenLinkEmitter = new vscode.EventEmitter<{
    readonly href: string
    readonly side: DiffSide
  }>()
  public readonly onDidRequestOpenLink = this._onDidRequestOpenLinkEmitter.event

  private constructor(
    editor: vscode.WebviewPanel,
    left: vscode.Uri,
    right: vscode.Uri,
    private readonly contributionProvider: AsciidocContributionProvider,
    private readonly previewConfigurations: AsciidocPreviewConfigurationManager,
    private readonly logger: Logger,
  ) {
    super()
    this.editor = editor
    this.left = left
    this.right = right

    this.editor.onDidDispose(() => this.dispose(), null, this.disposables)
    this.editor.onDidChangeViewState(
      () => this._onDidChangeViewStateEmitter.fire(),
      null,
      this.disposables,
    )
    this.editor.webview.onDidReceiveMessage(
      (message) => this.onMessage(message),
      null,
      this.disposables,
    )
  }

  public static async create(
    left: vscode.Uri,
    right: vscode.Uri,
    contributionProvider: AsciidocContributionProvider,
    previewConfigurations: AsciidocPreviewConfigurationManager,
    logger: Logger,
  ): Promise<AsciidocDiffPanel> {
    const editor = vscode.window.createWebviewPanel(
      AsciidocDiffPanel.viewType,
      AsciidocDiffPanel.panelTitle(left, right),
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        enableCommandUris: true,
        localResourceRoots: AsciidocDiffPanel.getLocalResourceRoots(
          left,
          right,
          contributionProvider,
          previewConfigurations,
        ),
      },
    )
    return new AsciidocDiffPanel(
      editor,
      left,
      right,
      contributionProvider,
      previewConfigurations,
      logger,
    )
  }

  public static async revive(
    webview: vscode.WebviewPanel,
    state: Partial<DiffPanelState>,
    contributionProvider: AsciidocContributionProvider,
    previewConfigurations: AsciidocPreviewConfigurationManager,
    logger: Logger,
  ): Promise<AsciidocDiffPanel> {
    const left = state.left ? vscode.Uri.parse(state.left) : undefined
    const right = state.right ? vscode.Uri.parse(state.right) : undefined
    if (!left || !right) {
      throw new Error('Invalid diff panel state')
    }
    webview.webview.options = {
      enableScripts: true,
      enableCommandUris: true,
      localResourceRoots: AsciidocDiffPanel.getLocalResourceRoots(
        left,
        right,
        contributionProvider,
        previewConfigurations,
      ),
    }
    const panel = new AsciidocDiffPanel(
      webview,
      left,
      right,
      contributionProvider,
      previewConfigurations,
      logger,
    )
    panel._ratio = state.ratio
    panel._leftLine = state.leftLine
    panel._rightLine = state.rightLine
    panel._expanded = [...(state.expanded ?? [])]
    return panel
  }

  public get leftUri(): vscode.Uri {
    return this.left
  }

  public get rightUri(): vscode.Uri {
    return this.right
  }

  public get visible(): boolean {
    return this.editor.visible
  }

  public get ratio(): number | undefined {
    return this._ratio
  }

  public get leftLine(): number | undefined {
    return this._leftLine
  }

  public get rightLine(): number | undefined {
    return this._rightLine
  }

  public get expanded(): readonly string[] {
    return this._expanded
  }

  public get diffScriptUri(): string {
    return this.asMediaWebViewSrc('dist', 'diff.js')
  }

  public get diffCssUri(): string {
    return this.asMediaWebViewSrc('media', 'diff.css')
  }

  public get diffStrings(): DiffDocumentStrings {
    return {
      rendering: t('diff.status.rendering'),
      noDifferences: t('diff.status.noDifferences'),
      noVisualDifferences: t('diff.status.noVisualDifferences'),
      statusNonVisualSummary: t('diff.status.nonVisualSummary'),
      statusNonVisualSummaryOne: t('diff.status.nonVisualSummaryOne'),
      statusNavigationSummary: t('diff.status.navigationSummary'),
      statusNavigationSummaryOne: t('diff.status.navigationSummaryOne'),
      navigationChanged: t('diff.nonVisual.navigation'),
      error: t('diff.status.error'),
      old: t('diff.label.old'),
      new: t('diff.label.new'),
      swap: t('diff.swap'),
      nonVisualFormatting: t('diff.nonVisual.formatting'),
      nonVisualLink: t('diff.nonVisual.link'),
      nonVisualId: t('diff.nonVisual.id'),
      blockChanged: t('diff.block.changed'),
      mediaChanged: t('diff.media.changed'),
      shellDiffers: t('diff.shellDiffers'),
      statusSummary: t('diff.status.summary'),
      statusNonVisual: t('diff.status.nonVisual'),
      statusJump: t('diff.status.jump'),
      collapseExpand: t('diff.collapse.expand'),
      collapseCollapse: t('diff.collapse.collapse'),
      collapseLabel: t('diff.collapse.label'),
      collapseLabelWithExcerpt: t('diff.collapse.labelWithExcerpt'),
      gapAddedBlocks: t('diff.gap.addedBlocks'),
      gapAddedTable: t('diff.gap.addedTable'),
      gapAddedLines: t('diff.gap.addedLines'),
      gapRemovedBlocks: t('diff.gap.removedBlocks'),
      gapRemovedTable: t('diff.gap.removedTable'),
      gapRemovedLines: t('diff.gap.removedLines'),
      gapChangedBlocks: t('diff.gap.changedBlocks'),
      gapChangedTable: t('diff.gap.changedTable'),
      gapChangedLines: t('diff.gap.changedLines'),
      gapAddedBlock: t('diff.gap.addedBlock'),
      gapAddedTableRow: t('diff.gap.addedTableRow'),
      gapAddedLine: t('diff.gap.addedLine'),
      gapRemovedBlock: t('diff.gap.removedBlock'),
      gapRemovedTableRow: t('diff.gap.removedTableRow'),
      gapRemovedLine: t('diff.gap.removedLine'),
      gapChangedBlock: t('diff.gap.changedBlock'),
      gapChangedTableRow: t('diff.gap.changedTableRow'),
      gapChangedLine: t('diff.gap.changedLine'),
    }
  }

  public get state(): DiffPanelState {
    return {
      left: this.left.toString(),
      right: this.right.toString(),
      ratio: this._ratio,
      leftLine: this._leftLine,
      rightLine: this._rightLine,
      expanded: this._expanded,
    }
  }

  public updatePair(left: vscode.Uri, right: vscode.Uri): void {
    this.left = left
    this.right = right
    this.editor.title = AsciidocDiffPanel.panelTitle(left, right)
    this.editor.webview.options = {
      enableScripts: true,
      enableCommandUris: true,
      localResourceRoots: AsciidocDiffPanel.getLocalResourceRoots(
        left,
        right,
        this.contributionProvider,
        this.previewConfigurations,
      ),
    }
  }

  /**
   * Reverses the two sides (the old becomes the new and vice versa).
   */
  public swap(): void {
    this.updatePair(this.right, this.left)
  }

  /**
   * Replaces the whole webview document with the side-by-side diff document.
   * Both previews live in the active frame so they share the webview's resource
   * handling and theme (see `diffDocument.ts`).
   */
  public setDocument(html: string): void {
    this.editor.webview.html = html
  }

  public setBusy(busy: boolean): void {
    this.postMessage({ type: 'setBusy', busy })
  }

  public setError(message: string): void {
    this.postMessage({ type: 'setError', message })
  }

  override dispose() {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this._onDisposeEmitter.fire()
    this._onDisposeEmitter.dispose()
    this._onDidScrollEmitter.dispose()
    this._onDidRequestSwapEmitter.dispose()
    this._onDidChangeViewStateEmitter.dispose()
    this._onDidRequestOpenLinkEmitter.dispose()
    this.editor.dispose()
    disposeAll(this.disposables)
    super.dispose()
  }

  asWebviewUri(resource: vscode.Uri): vscode.Uri {
    return this.editor.webview.asWebviewUri(resource)
  }

  asMediaWebViewSrc(...pathSegments: string[]): string {
    return this.escapeAttribute(
      this.asWebviewUri(
        vscode.Uri.joinPath(
          this.contributionProvider.extensionUri,
          ...pathSegments,
        ),
      ),
    )
  }

  get cspSource(): string {
    return this.editor.webview.cspSource
  }

  private onMessage(message: DiffFromWebviewMessage): void {
    switch (message.type) {
      case 'didScroll': {
        if (typeof message.ratio === 'number') {
          this._ratio = message.ratio
          this._onDidScrollEmitter.fire(message.ratio)
        }
        if (typeof message.leftLine === 'number') {
          this._leftLine = message.leftLine
        }
        if (typeof message.rightLine === 'number') {
          this._rightLine = message.rightLine
        }
        break
      }
      case 'swap': {
        this._onDidRequestSwapEmitter.fire()
        break
      }
      case 'setExpanded': {
        this._expanded = [...(message.keys ?? [])]
        break
      }
      case 'openLink': {
        if (message.href !== undefined && message.href !== '') {
          this._onDidRequestOpenLinkEmitter.fire({
            href: message.href,
            side: message.side === 'left' ? 'left' : 'right',
          })
        }
        break
      }
    }
  }

  private postMessage(message: DiffToWebviewMessage): void {
    if (!this.disposed) {
      this.editor.webview.postMessage(message)
    }
  }

  private escapeAttribute(value: string | vscode.Uri): string {
    return value.toString().replace(/"/g, '&quot;')
  }

  private static panelTitle(left: vscode.Uri, right: vscode.Uri): string {
    const titles = diffTitles(left.fsPath, right.fsPath)
    return t('diff.panel.title', titles.left, titles.right)
  }

  private static getLocalResourceRoots(
    left: vscode.Uri,
    right: vscode.Uri,
    contributionProvider: AsciidocContributionProvider,
    previewConfigurations: AsciidocPreviewConfigurationManager,
  ): vscode.Uri[] {
    const roots: vscode.Uri[] = [
      vscode.Uri.joinPath(contributionProvider.extensionUri, 'media'),
      vscode.Uri.joinPath(contributionProvider.extensionUri, 'dist'),
    ]
    for (const resource of [left, right]) {
      const config = previewConfigurations.loadAndCacheConfiguration(resource)
      const previewStylePath = config.previewStyle
      if (
        previewStylePath !== '' &&
        !/^(https?|file):/i.test(previewStylePath) &&
        (previewStylePath.startsWith('/') ||
          /^[a-z]:[\\/]/i.test(previewStylePath))
      ) {
        roots.push(uri.Utils.dirname(vscode.Uri.file(previewStylePath)))
      }
      const folder = getWorkspaceFolder(resource)
      if (folder) {
        const workspaceRoots = getWorkspaceFolders()?.map((f) => f.uri)
        if (workspaceRoots) {
          roots.push(...workspaceRoots)
        }
      } else {
        roots.push(uri.Utils.dirname(resource))
      }
    }
    return dedupeUris(roots)
  }
}

function dedupeUris(uris: vscode.Uri[]): vscode.Uri[] {
  const seen = new Set<string>()
  return uris.filter((uri) => {
    const key = uri.toString()
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
