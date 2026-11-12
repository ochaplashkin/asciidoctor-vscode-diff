import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import * as vscode from 'vscode'
import { validatePair } from '../commands/compareFiles.js'
import { Logger } from '../core/logger.js'
import { AsciidocDiffContentProvider } from '../features/diff/diffContentProvider.js'
import { AsciidocDiffPanel } from '../features/diff/diffPanel.js'
import { AsciidocDiffSession } from '../features/diff/diffSession.js'
import { getAsciidocExtensionContributions } from '../features/extensionContributions.js'
import { AsciidocPreviewConfigurationManager } from '../features/preview/previewConfig.js'
import { extensionContext } from './helper.js'
import { createFile, removeFiles } from './workspaceHelper.js'

function tick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('validatePair', () => {
  test('accepts two distinct URIs in order', () => {
    const left = vscode.Uri.file('/a.adoc')
    const right = vscode.Uri.file('/b.adoc')
    const result = validatePair([left, right])
    assert.deepEqual(result, { left, right })
  })

  test('rejects a non-pair', () => {
    const uri = vscode.Uri.file('/a.adoc')
    assert.deepEqual(validatePair([uri]), { error: 'diff.selectExactlyTwo' })
  })

  test('rejects the same file twice', () => {
    const uri = vscode.Uri.file('/a.adoc')
    assert.deepEqual(validatePair([uri, uri]), { error: 'diff.sameFile' })
  })
})

describe('AsciidocDiffPanel', () => {
  let left: vscode.Uri
  let right: vscode.Uri

  before(async () => {
    left = await createFile('= Left\n\nold\n', 'diff-left.adoc')
    right = await createFile('= Right\n\nnew\n', 'diff-right.adoc')
  })

  after(async () => {
    await removeFiles([left, right])
  })

  test('sets the composed document on the webview', async () => {
    const panel = await AsciidocDiffPanel.create(
      left,
      right,
      getAsciidocExtensionContributions(extensionContext),
      new AsciidocPreviewConfigurationManager(),
      new Logger(),
    )
    try {
      panel.setDocument(
        '<html><body><div id="diff-left"></div><div id="diff-right"></div></body></html>',
      )
      const html = (panel as unknown as { editor: vscode.WebviewPanel }).editor
        .webview.html
      assert.match(html, /id="diff-left"/)
      assert.match(html, /id="diff-right"/)
      assert.match(panel.diffScriptUri, /diff\.js$/)
      assert.match(panel.diffCssUri, /diff\.css$/)
    } finally {
      panel.dispose()
    }
  })

  test('renders a diff and sets the composed document', async () => {
    const contributions = getAsciidocExtensionContributions(extensionContext)
    // A lightweight content provider so the test does not depend on the full
    // Asciidoctor conversion and its runtime assets.
    const contentProvider = {
      providePreviewHTML: async (document: vscode.TextDocument) =>
        `<html><head></head><body class="vscode-body article"><div id="preview-root"><p class="data-line-1">${document.getText()}</p></div></body></html>`,
    } as unknown as AsciidocDiffContentProvider

    const documents: string[] = []
    const fakePanel = {
      leftUri: left,
      rightUri: right,
      ratio: undefined,
      diffScriptUri: '/ext/dist/diff.js',
      diffCssUri: '/ext/media/diff.css',
      diffStrings: {
        rendering: 'Rendering…',
        noDifferences: 'No differences',
        error: 'error',
        old: 'old',
        new: 'new',
        swap: 'Swap',
      },
      setBusy: () => undefined,
      setError: () => undefined,
      setDocument: (html: string) => {
        documents.push(html)
      },
    } as unknown as AsciidocDiffPanel

    const session = new AsciidocDiffSession(
      fakePanel,
      contentProvider,
      contributions,
      new Logger(),
    )
    await session.render()
    await tick(50)

    assert.equal(documents.length, 1)
    const html = documents[0]
    // Both sides are in the same document, in their own panes.
    assert.match(html, /<div id="diff-left" class="diff-pane">/)
    assert.match(html, /<div id="diff-right" class="diff-pane">/)
    assert.equal((html.match(/id="preview-root"/g) ?? []).length, 2)
    // The two documents differ, so the render must carry diff markers.
    assert.match(html, /adoc-diff-word adoc-diff-word-del/)
    assert.match(html, /adoc-diff-word adoc-diff-word-ins/)
  })
})
