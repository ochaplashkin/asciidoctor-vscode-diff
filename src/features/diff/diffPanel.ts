import * as path from 'node:path'
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
import type { DiffToWebviewMessage } from './diffTypes.js'

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
  private disposed = false
  private readonly disposables: vscode.Disposable[] = []

  private readonly _onDidScrollEmitter = new vscode.EventEmitter<number>()
  public readonly onDidScroll = this._onDidScrollEmitter.event

  private readonly _onDisposeEmitter = new vscode.EventEmitter<void>()
  public readonly onDispose = this._onDisposeEmitter.event

  private readonly _onDidRequestSwapEmitter = new vscode.EventEmitter<void>()
  public readonly onDidRequestSwap = this._onDidRequestSwapEmitter.event

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
    state: { left?: string; right?: string; ratio?: number },
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
      error: t('diff.status.error'),
      old: t('diff.label.old'),
      new: t('diff.label.new'),
      swap: t('diff.swap'),
    }
  }

  public get state(): {
    left: string
    right: string
    ratio?: number
  } {
    return {
      left: this.left.toString(),
      right: this.right.toString(),
      ratio: this._ratio,
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

  private onMessage(message: { type?: string; ratio?: number }): void {
    switch (message.type) {
      case 'didScroll': {
        this._ratio = message.ratio
        this._onDidScrollEmitter.fire(message.ratio ?? 0)
        break
      }
      case 'swap': {
        this._onDidRequestSwapEmitter.fire()
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
    return t(
      'diff.panel.title',
      path.basename(left.fsPath),
      path.basename(right.fsPath),
    )
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
