import * as path from 'node:path'
import * as vscode from 'vscode'
import { Logger } from '../../core/logger.js'
import { AsciidocContributionProvider } from '../extensionContributions.js'
import { AsciidocDiffContentProvider } from './diffContentProvider.js'
import { buildDiffDocument } from './diffDocument.js'
import { AsciidocDiffPanel } from './diffPanel.js'
import type { DiffRenderResult } from './diffTypes.js'
import { renderDiff } from './renderDiff.js'

/**
 * Renders the two documents, computes the render diff and pushes the assembled
 * side-by-side document to the panel. Conversions are serialized (the
 * Asciidoctor registry is a global registration) and a render id guards against
 * a stale result overwriting a newer one while `openTextDocument`/conversion is
 * awaiting.
 */
export class AsciidocDiffSession {
  private version = 0
  private renderId = 0
  private lastResult: DiffRenderResult | undefined
  private diffContentCss: string | undefined

  constructor(
    private readonly panel: AsciidocDiffPanel,
    private readonly contentProvider: AsciidocDiffContentProvider,
    private readonly contributionProvider: AsciidocContributionProvider,
    private readonly logger: Logger,
  ) {}

  public async render(): Promise<void> {
    const renderId = ++this.renderId
    this.panel.setBusy(true)
    try {
      const leftDocument = await vscode.workspace.openTextDocument(
        this.panel.leftUri,
      )
      const rightDocument = await vscode.workspace.openTextDocument(
        this.panel.rightUri,
      )
      if (renderId !== this.renderId) {
        return
      }
      // Convert sequentially: the Asciidoctor registry is a global registration.
      const leftHtml = await this.contentProvider.providePreviewHTML(
        leftDocument,
        this.panel,
      )
      const rightHtml = await this.contentProvider.providePreviewHTML(
        rightDocument,
        this.panel,
      )
      if (renderId !== this.renderId) {
        return
      }
      const result = renderDiff(leftHtml, rightHtml)
      const diffContentCss = await this.getDiffContentCss()
      this.version++
      this.lastResult = result
      this.panel.setDocument(
        buildDiffDocument({
          leftHtml: result.leftHtml,
          rightHtml: result.rightHtml,
          diffScriptUri: this.panel.diffScriptUri,
          diffCssUri: this.panel.diffCssUri,
          diffContentCss,
          leftTitle: path.basename(this.panel.leftUri.fsPath),
          rightTitle: path.basename(this.panel.rightUri.fsPath),
          strings: this.panel.diffStrings,
          lineMap: result.lineMap,
          leftLineCount: result.leftLineCount,
          rightLineCount: result.rightLineCount,
          ratio: this.panel.ratio,
          version: this.version,
          stats: result.stats,
        }),
      )
    } catch (error) {
      this.logger.error(`Unable to render the diff: ${error}`)
      this.panel.setError(String(error))
    }
  }

  public get lastRender(): DiffRenderResult | undefined {
    return this.lastResult
  }

  private async getDiffContentCss(): Promise<string> {
    if (this.diffContentCss === undefined) {
      const uri = vscode.Uri.joinPath(
        this.contributionProvider.extensionUri,
        'media',
        'diff-content.css',
      )
      const bytes = await vscode.workspace.fs.readFile(uri)
      this.diffContentCss = new TextDecoder().decode(bytes)
    }
    return this.diffContentCss
  }
}
