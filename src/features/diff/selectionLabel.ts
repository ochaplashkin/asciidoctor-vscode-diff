/**
 * Helpers for the label shown while a file is selected for comparison.
 *
 * This module is vscode-free so the truncation rule can be unit-tested in Node.
 */

/** Maximum number of characters of the file name shown in the selection UI. */
export const SELECTION_NAME_MAX_LENGTH = 10

/**
 * Truncates a file name to `max` characters followed by `...` when it is longer,
 * so a long name does not overflow the status bar.
 *
 * Iterating over code points (not UTF-16 units) keeps emoji and other surrogate
 * pairs intact.
 */
export function truncateFileName(
  name: string,
  max: number = SELECTION_NAME_MAX_LENGTH,
): string {
  const characters = Array.from(name)
  if (characters.length <= max) {
    return name
  }
  return `${characters.slice(0, max).join('')}...`
}
