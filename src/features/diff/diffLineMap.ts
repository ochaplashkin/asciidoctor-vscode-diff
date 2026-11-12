/**
 * Pure line-map logic for the diff panel's synchronized scrolling.
 *
 * Each matched element contributes a pair `(leftLine, rightLine)` of 1-based
 * source lines (the `data-line-N` anchors of the preview). When one pane is
 * scrolled to a source line, the other pane is scrolled so the corresponding
 * line is at the same relative position, interpolating between pairs.
 */

export interface DiffLineMapEntry {
  /** 1-based source line in the left document. */
  readonly leftLine: number
  /** 1-based source line in the right document. */
  readonly rightLine: number
}

/**
 * Sorts entries by `leftLine` and drops duplicate left lines (keeping the first),
 * which is what the diff collector produces when a block is matched at several
 * nesting levels.
 */
export function normalizeLineMap(
  entries: readonly DiffLineMapEntry[],
): DiffLineMapEntry[] {
  const sorted = [...entries].sort((a, b) => a.leftLine - b.leftLine)
  const deduped: DiffLineMapEntry[] = []
  let lastLeft = Number.NaN
  for (const entry of sorted) {
    if (entry.leftLine !== lastLeft) {
      deduped.push(entry)
      lastLeft = entry.leftLine
    }
  }
  return deduped
}

/**
 * Maps a 1-based left source line to a 1-based right source line.
 *
 * - between two pairs → linear interpolation;
 * - before the first / after the last pair → the nearest pair;
 * - empty map → proportional mapping via the line counts.
 */
export function mapLine(
  line: number,
  entries: readonly DiffLineMapEntry[],
  leftLineCount: number,
  rightLineCount: number,
): number {
  if (entries.length === 0) {
    if (leftLineCount <= 1) {
      return 1
    }
    const ratio = (line - 1) / (leftLineCount - 1)
    return 1 + ratio * Math.max(0, rightLineCount - 1)
  }

  if (line <= entries[0].leftLine) {
    return entries[0].rightLine
  }
  const last = entries[entries.length - 1]
  if (line >= last.leftLine) {
    return last.rightLine
  }

  let previous = entries[0]
  let next = entries[0]
  for (let i = 1; i < entries.length; i++) {
    previous = entries[i - 1]
    next = entries[i]
    if (line <= next.leftLine) {
      break
    }
  }
  if (next.leftLine === previous.leftLine) {
    return previous.rightLine
  }
  const progress =
    (line - previous.leftLine) / (next.leftLine - previous.leftLine)
  return previous.rightLine + progress * (next.rightLine - previous.rightLine)
}
