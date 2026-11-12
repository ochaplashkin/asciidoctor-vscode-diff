/**
 * Word-level diff of two visible-text strings.
 *
 * The output is a set of [start, end) ranges (in each input string) that must be
 * highlighted. The actual wrapping into `<span class="adoc-diff-word …">` is
 * done by the caller, which owns the DOM text nodes and their offsets.
 *
 * Uses `diffArrays` from the `diff` package over the token stream produced by
 * `textTokens.ts`. Whitespace tokens are diffed (so they keep the alignment
 * stable) but never emitted as highlight ranges: a whitespace-only change is not
 * a visual difference.
 */

import { diffArrays } from 'diff'
import { type TextToken, tokenize } from './textTokens.js'

export interface InlineRange {
  readonly start: number
  readonly end: number
}

export interface InlineDiffResult {
  readonly left: readonly InlineRange[]
  readonly right: readonly InlineRange[]
}

// Safety valve: diffing is O(n·d); beyond this many tokens a block is more
// cheaply treated as "changed" than diffed token by token.
const MAX_TOKENS = 20_000

function rangesFor(
  tokens: TextToken[],
  startIndex: number,
  count: number,
): InlineRange[] {
  const out: InlineRange[] = []
  for (let i = startIndex; i < startIndex + count; i++) {
    const token = tokens[i]
    if (token.type === 'space') {
      continue
    }
    out.push({ start: token.start, end: token.end })
  }
  return out
}

/**
 * Coalesces ranges that overlap, touch, or are separated only by whitespace so
 * a changed phrase like "hello world" is wrapped in a single span instead of two
 * spans with an unhighlighted space between them.
 */
function mergeRanges(ranges: InlineRange[], text: string): InlineRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: InlineRange[] = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (!last) {
      merged.push(range)
      continue
    }
    const between = text.slice(last.end, range.start)
    if (range.start <= last.end || /^\s*$/.test(between)) {
      merged[merged.length - 1] = {
        start: last.start,
        end: Math.max(last.end, range.end),
      }
    } else {
      merged.push(range)
    }
  }
  return merged
}

/**
 * Computes the highlight ranges between `leftText` and `rightText`, or
 * `undefined` when the token count exceeds the safety limit.
 */
export function computeInlineDiff(
  leftText: string,
  rightText: string,
): InlineDiffResult | undefined {
  const leftTokens = tokenize(leftText)
  const rightTokens = tokenize(rightText)
  if (leftTokens.length + rightTokens.length > MAX_TOKENS) {
    return undefined
  }

  const changes = diffArrays(
    leftTokens.map((token) => token.value),
    rightTokens.map((token) => token.value),
  )

  const left: InlineRange[] = []
  const right: InlineRange[] = []
  let leftIndex = 0
  let rightIndex = 0
  for (const change of changes) {
    if (change.removed && !change.added) {
      left.push(...rangesFor(leftTokens, leftIndex, change.count))
      leftIndex += change.count
    } else if (change.added && !change.removed) {
      right.push(...rangesFor(rightTokens, rightIndex, change.count))
      rightIndex += change.count
    } else {
      leftIndex += change.count
      rightIndex += change.count
    }
  }

  return {
    left: mergeRanges(left, leftText),
    right: mergeRanges(right, rightText),
  }
}
