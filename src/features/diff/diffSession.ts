import * as vscode from 'vscode'
import { Logger } from '../../core/logger.js'
import { AsciidocContributionProvider } from '../extensionContributions.js'
import type { DiffRenderOptions } from './blockDiff.js'
import { AsciidocDiffContentProvider } from './diffContentProvider.js'
import { buildDiffDocument } from './diffDocument.js'
import { AsciidocDiffPanel } from './diffPanel.js'
import { diffTitles } from './diffTitle.js'
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
  /** Signature of the last document pushed to the webview, for the no-op guard. */
  private lastDocumentKey: string | undefined
  /** Converted HTML per `uri#version`; invalidated on save and on config change. */
  private readonly conversionCache = new Map<string, string>()
  private cacheGeneration = 0

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
      const leftHtml = await this.convert(leftDocument, renderId)
      const rightHtml = await this.convert(rightDocument, renderId)
      if (leftHtml === undefined || rightHtml === undefined) {
        return
      }
      if (renderId !== this.renderId) {
        return
      }
      const options = this.renderOptions()
      const result = renderDiff(leftHtml, rightHtml, options)
      const diffContentCss = await this.getDiffContentCss()
      if (renderId !== this.renderId) {
        return
      }
      this.lastResult = result

      const titles = diffTitles(
        this.panel.leftUri.fsPath,
        this.panel.rightUri.fsPath,
      )
      const strings = this.panel.diffStrings
      // Save-without-change, repeated renders and a configuration change that
      // does not affect the output must not replace the document: replacing it
      // reloads images/diagrams and moves the scroll.
      const documentKey = JSON.stringify({
        leftHtml: result.leftHtml,
        rightHtml: result.rightHtml,
        options,
        diffContentCss,
        titles,
        strings,
        lineMap: result.lineMap,
        leftLineCount: result.leftLineCount,
        rightLineCount: result.rightLineCount,
        stats: result.stats,
      })
      if (documentKey === this.lastDocumentKey) {
        this.panel.setBusy(false)
        return
      }
      this.lastDocumentKey = documentKey
      this.version++
      this.panel.setDocument(
        buildDiffDocument({
          leftHtml: result.leftHtml,
          rightHtml: result.rightHtml,
          diffScriptUri: this.panel.diffScriptUri,
          diffCssUri: this.panel.diffCssUri,
          diffContentCss,
          leftTitle: titles.left,
          rightTitle: titles.right,
          leftTitleTooltip: titles.leftFullPath,
          rightTitleTooltip: titles.rightFullPath,
          strings,
          lineMap: result.lineMap,
          leftLineCount: result.leftLineCount,
          rightLineCount: result.rightLineCount,
          ratio: this.panel.ratio,
          leftLine: this.panel.leftLine,
          rightLine: this.panel.rightLine,
          expanded: this.panel.expanded,
          version: this.version,
          stats: result.stats,
          options,
        }),
      )
    } catch (error) {
      this.logger.error(`Unable to render the diff: ${error}`)
      this.panel.setError(String(error))
    }
  }

  /**
   * Drops the converted HTML. A save may change an `include::`d file, so the
   * next render must convert again even when the document version is unchanged.
   */
  public invalidateCache(): void {
    this.cacheGeneration++
    this.conversionCache.clear()
  }

  private async convert(
    document: vscode.TextDocument,
    renderId: number,
  ): Promise<string | undefined> {
    const key = `${document.uri.toString()}#${document.version}#${this.cacheGeneration}`
    const cached = this.conversionCache.get(key)
    if (cached !== undefined) {
      return cached
    }
    const html = await this.contentProvider.providePreviewHTML(
      document,
      this.panel,
    )
    if (renderId !== this.renderId) {
      return undefined
    }
    this.conversionCache.set(key, html)
    // Keep the cache bounded: the two current versions are enough, plus a
    // little history for a fast undo/redo.
    while (this.conversionCache.size > 4) {
      const oldest = this.conversionCache.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.conversionCache.delete(oldest)
    }
    return html
  }

  public get lastRender(): DiffRenderResult | undefined {
    return this.lastResult
  }

  private renderOptions(): DiffRenderOptions {
    const config = vscode.workspace.getConfiguration('asciidoc.diff')
    return {
      align: config.get<boolean>('align', true),
      deletedBlocks: config.get<'collapse' | 'expand'>(
        'deletedBlocks',
        'collapse',
      ),
      codeBlocks: config.get<'line' | 'block'>('codeBlocks', 'line'),
      collapseLines: config.get<number>('collapseLines', 5),
      showStats: config.get<boolean>('showStats', true),
    }
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
