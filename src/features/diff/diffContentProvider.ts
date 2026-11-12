import * as vscode from 'vscode'
import { WebviewResourceProvider } from '../../core/resources.js'
import { AsciidocPreviewConfigurationManager } from '../preview/previewConfig.js'
import { AsciidocContentProvider } from '../preview/previewContentProvider.js'

/**
 * Thin adapter that renders a single document with the existing preview
 * pipeline (`AsciidocContentProvider`), for the diff feature. Kept separate so
 * the diff session depends on this narrow surface rather than on the whole
 * preview content provider.
 */
export class AsciidocDiffContentProvider {
  // Only needed to satisfy `AsciidocContentProvider.providePreviewHTML`; the
  // engine uses its own configuration cache during conversion.
  private readonly previewConfigurations =
    new AsciidocPreviewConfigurationManager()

  constructor(private readonly contentProvider: AsciidocContentProvider) {}

  public async providePreviewHTML(
    document: vscode.TextDocument,
    editor: WebviewResourceProvider,
    line?: number,
  ): Promise<string> {
    return this.contentProvider.providePreviewHTML(
      document,
      this.previewConfigurations,
      editor,
      line,
    )
  }
}
