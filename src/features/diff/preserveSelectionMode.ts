/**
 * Values of `asciidoc.diff.preserveSelection` (must match the enum in
 * `package.json`).
 *
 * This module is vscode-free so the validation rule can be unit-tested in
 * Node.js. The setting is read through `preserveSelection.ts`.
 */
export const PRESERVE_SELECTION_MODES = [
  'none',
  'both',
  'first',
  'second',
] as const

export type PreserveSelectionMode = (typeof PRESERVE_SELECTION_MODES)[number]

/**
 * Validates an untrusted setting value (for example one coming from a
 * hand-edited `settings.json`) against the known modes.
 */
export function isPreserveSelectionMode(
  value: unknown,
): value is PreserveSelectionMode {
  return (
    typeof value === 'string' &&
    (PRESERVE_SELECTION_MODES as readonly string[]).includes(value)
  )
}
