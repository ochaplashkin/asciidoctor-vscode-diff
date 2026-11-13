import * as path from 'node:path'
import * as vscode from 'vscode'
import { disposeAll } from '../../core/dispose.js'
import { Logger } from '../../core/logger.js'
import { AsciidocContributionProvider } from '../extensionContributions.js'
import { AsciidocPreviewConfigurationManager } from '../preview/previewConfig.js'
import { AsciidocDiffContentProvider } from './diffContentProvider.js'
import { AsciidocDiffPanel } from './diffPanel.js'
import { AsciidocDiffSession } from './diffSession.js'
import type { DiffSide } from './diffTypes.js'

const RENDER_DEBOUNCE_MS = 300

/**
 * Owns the single active diff panel (v1 limitation) and its render session,
 * wires document/save/configuration/theme events to re-renders, and restores the
 * panel after a window reload through the webview panel serializer.
 */
export class AsciidocDiffManager implements vscode.WebviewPanelSerializer {
  private readonly previewConfigurations =
    new AsciidocPreviewConfigurationManager()
  private panel: AsciidocDiffPanel | undefined
  private session: AsciidocDiffSession | undefined
  private renderTimer: ReturnType<typeof setTimeout> | undefined
  /** A render was requested while the panel was hidden. */
  private dirty = false
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly contentProvider: AsciidocDiffContentProvider,
    private readonly contributionProvider: AsciidocContributionProvider,
    private readonly logger: Logger,
  ) {
    this.disposables.push(
      vscode.window.registerWebviewPanelSerializer(
        AsciidocDiffPanel.viewType,
        this,
      ),
    )
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.isActiveDocument(event.document.uri)) {
          this.scheduleRender()
        }
      }),
    )
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (this.isActiveDocument(document.uri)) {
          // A save may pull in `include::`d files changed on disk.
          this.session?.invalidateCache()
          this.scheduleRender()
        }
      }),
    )
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('asciidoc')) {
          this.session?.invalidateCache()
          this.render().then()
        }
      }),
    )
    this.disposables.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        this.render().then()
      }),
    )
  }

  public async open(left: vscode.Uri, right: vscode.Uri): Promise<void> {
    if (this.panel) {
      this.panel.updatePair(left, right)
      await this.render()
      return
    }
    this.panel = await AsciidocDiffPanel.create(
      left,
      right,
      this.contributionProvider,
      this.previewConfigurations,
      this.logger,
    )
    this.session = new AsciidocDiffSession(
      this.panel,
      this.contentProvider,
      this.contributionProvider,
      this.logger,
    )
    this.bindPanel(this.panel, this.session)
    await this.render()
  }

  public async refresh(): Promise<void> {
    await this.render()
  }

  public async deserializeWebviewPanel(
    webview: vscode.WebviewPanel,
    state: Parameters<typeof AsciidocDiffPanel.revive>[1],
  ): Promise<void> {
    const panel = await AsciidocDiffPanel.revive(
      webview,
      state,
      this.contributionProvider,
      this.previewConfigurations,
      this.logger,
    )
    this.panel = panel
    this.session = new AsciidocDiffSession(
      panel,
      this.contentProvider,
      this.contributionProvider,
      this.logger,
    )
    this.bindPanel(panel, this.session)
    await this.render()
  }

  private bindPanel(
    panel: AsciidocDiffPanel,
    session: AsciidocDiffSession,
  ): void {
    panel.onDispose(() => {
      this.panel = undefined
      this.session = undefined
    })
    panel.onDidRequestSwap(() => {
      this.swap().then()
    })
    panel.onDidChangeViewState(() => {
      // While the panel is hidden, renders are skipped; catch up as soon as it
      // is shown again instead of leaving a stale diff on screen.
      if (this.dirty && panel.visible) {
        this.render().then()
      }
    })
    panel.onDidRequestOpenLink(({ href, side }) => {
      this.openLink(href, side).then()
    })
  }

  /**
   * Opens a link clicked in one of the panes. A `#fragment` is handled inside
   * the webview (it must scroll *its* pane); everything else is resolved
   * against the document of the side the link was clicked on.
   */
  private async openLink(href: string, side: DiffSide): Promise<void> {
    if (this.panel === undefined) {
      return
    }
    if (/^(?:https?|mailto):/i.test(href)) {
      await vscode.env.openExternal(vscode.Uri.parse(href))
      return
    }
    if (href.startsWith('//')) {
      await vscode.env.openExternal(vscode.Uri.parse(`https:${href}`))
      return
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href)) {
      // `command:` and other privileged schemes must not be reachable from the
      // rendered document of the diff panel.
      return
    }
    const [rawPath, fragment] = href.split('#')
    let decoded = rawPath
    try {
      decoded = decodeURIComponent(rawPath)
    } catch {
      decoded = rawPath
    }
    if (/^file:\/\//i.test(decoded)) {
      decoded = decoded.replace(/^file:\/\//i, '')
    }
    if (decoded === '') {
      return
    }
    const base =
      side === 'left' ? this.panel.leftUri.fsPath : this.panel.rightUri.fsPath
    const target = decoded.startsWith('/')
      ? decoded
      : path.resolve(path.dirname(base), decoded)
    if (target === '') {
      return
    }
    await vscode.commands.executeCommand('_asciidoc.openDocumentLink', {
      path: target,
      fragment: fragment ?? '',
    })
  }

  private async swap(): Promise<void> {
    if (!this.panel || !this.session) {
      return
    }
    this.panel.swap()
    await this.session.render()
  }

  public dispose(): void {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer)
      this.renderTimer = undefined
    }
    disposeAll(this.disposables)
    this.panel?.dispose()
    this.panel = undefined
    this.session = undefined
  }

  private isActiveDocument(uri: vscode.Uri): boolean {
    return (
      this.panel !== undefined &&
      (this.panel.leftUri.toString() === uri.toString() ||
        this.panel.rightUri.toString() === uri.toString())
    )
  }

  private scheduleRender(): void {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer)
    }
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined
      this.render().then()
    }, RENDER_DEBOUNCE_MS)
  }

  private async render(): Promise<void> {
    if (!this.panel || !this.session) {
      return
    }
    if (!this.panel.visible) {
      this.dirty = true
      return
    }
    this.dirty = false
    await this.session.render()
  }
}
