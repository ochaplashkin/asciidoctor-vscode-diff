import * as vscode from 'vscode'
import {
  isPreserveSelectionMode,
  type PreserveSelectionMode,
} from './preserveSelectionMode.js'

/**
 * Reads `asciidoc.diff.preserveSelection`, falling back to `none` (clear the
 * selection) when the setting is unset or holds an unknown value.
 */
export function getPreserveSelectionMode(): PreserveSelectionMode {
  const value = vscode.workspace
    .getConfiguration('asciidoc.diff')
    .get<string>('preserveSelection')
  return isPreserveSelectionMode(value) ? value : 'none'
}
