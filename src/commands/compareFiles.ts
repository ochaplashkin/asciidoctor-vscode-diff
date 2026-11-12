import * as vscode from 'vscode'
import { Command } from '../core/commandManager.js'
import { t } from '../core/l10n.js'
import { AsciidocDiffManager } from '../features/diff/diffManager.js'

/** Keys of the localized error messages, for the pure validation helper. */
export type PairErrorKey =
  | 'diff.selectExactlyTwo'
  | 'diff.sameFile'
  | 'diff.notAsciidoc'

export type PairValidation =
  | { readonly left: vscode.Uri; readonly right: vscode.Uri }
  | { readonly error: PairErrorKey }

const ASCIIDOC_GLOB = '**/*.{adoc,ad,asciidoc,asc}'

/**
 * Validates a pair of candidates (two distinct URIs). Asciidoc-ness is checked
 * by the caller, which can open the documents; this keeps the helper pure and
 * unit-testable.
 */
export function validatePair(
  candidates: readonly vscode.Uri[],
): PairValidation {
  if (candidates.length !== 2) {
    return { error: 'diff.selectExactlyTwo' }
  }
  const [left, right] = candidates
  if (left.toString() === right.toString()) {
    return { error: 'diff.sameFile' }
  }
  return { left, right }
}

async function pickSecondFile(
  excluded: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  const files = await vscode.workspace.findFiles(ASCIIDOC_GLOB)
  const excludedString = excluded.toString()
  const candidates = files.filter((uri) => uri.toString() !== excludedString)
  if (candidates.length === 0) {
    vscode.window.showInformationMessage(t('diff.noOtherFiles')).then()
    return undefined
  }
  const picked = await vscode.window.showQuickPick(
    candidates.map((uri) => ({
      label: uri.fsPath,
      uri,
    })),
    { placeHolder: t('diff.pickSecondFile') },
  )
  return picked?.uri
}

/**
 * Command: compare the rendered output of two AsciiDoc files.
 *
 * With two URIs (Explorer multi-select), opens them immediately in the selected
 * order; the diff panel has a Swap button to reverse the sides. With one URI (or
 * the active editor), asks for a second file.
 */
export class CompareFilesCommand implements Command {
  public readonly id = 'asciidoc.compareFiles'

  constructor(private readonly manager: AsciidocDiffManager) {}

  public async execute(
    mainUri?: vscode.Uri,
    allUris?: vscode.Uri[],
  ): Promise<void> {
    let candidates: vscode.Uri[] = Array.isArray(allUris)
      ? [...allUris]
      : mainUri
        ? [mainUri]
        : []

    if (candidates.length === 0 && vscode.window.activeTextEditor) {
      candidates = [vscode.window.activeTextEditor.document.uri]
    }

    if (candidates.length === 0) {
      vscode.window.showInformationMessage(t('diff.selectTwoFiles')).then()
      return
    }

    if (candidates.length === 1) {
      const second = await pickSecondFile(candidates[0])
      if (!second) {
        return
      }
      candidates = [candidates[0], second]
    }

    const validation = validatePair(candidates)
    if ('error' in validation) {
      vscode.window.showInformationMessage(t(validation.error)).then()
      return
    }

    if (!(await this.areAsciidoc(validation.left, validation.right))) {
      vscode.window.showInformationMessage(t('diff.notAsciidoc')).then()
      return
    }

    await this.manager.open(validation.left, validation.right)
  }

  private async areAsciidoc(
    left: vscode.Uri,
    right: vscode.Uri,
  ): Promise<boolean> {
    const [leftDoc, rightDoc] = await Promise.all([
      vscode.workspace.openTextDocument(left),
      vscode.workspace.openTextDocument(right),
    ])
    return (
      leftDoc.languageId === 'asciidoc' && rightDoc.languageId === 'asciidoc'
    )
  }
}
