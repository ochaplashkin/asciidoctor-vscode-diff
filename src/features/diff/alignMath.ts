/**
 * Pure spacing math for the side-by-side alignment.
 *
 * For every interval between two consecutive matched anchors, the client
 * measures the distance between the anchors on each side. If one side is
 * shorter, the difference becomes a gap on that side: a semantic gap (the
 * kernel marked an inserted/removed block) or a residual gap (the height
 * difference comes from wrapping, fonts or a changed leaf).
 *
 * Keeping this arithmetic free of the DOM makes it unit testable; the client
 * only maps the returned spaces to real elements and writes margins/paddings.
 */

export type AlignSide = 'left' | 'right'
export type AlignGapKind = 'ins' | 'del' | 'mixed' | 'residual'
export type AlignGapPosition = 'before' | 'after'
/** What the missing content is, for the gap label. */
export type AlignGapObject = 'blocks' | 'table' | 'lines'

export interface AlignInterval {
  /** Distance between the two anchors on the left, in CSS pixels. */
  readonly leftDistance: number
  /** Distance between the two anchors on the right, in CSS pixels. */
  readonly rightDistance: number
  /** Whether the kernel marked a gap before (or after the previous) left anchor. */
  readonly leftGap: boolean
  readonly rightGap: boolean
  /** Where the left gap lives: before the current or after the previous anchor. */
  readonly leftPosition: AlignGapPosition
  readonly rightPosition: AlignGapPosition
  readonly leftKind?: AlignGapKind
  readonly rightKind?: AlignGapKind
  /** How many blocks (or table rows) are missing, for the gap label. */
  readonly leftCount?: number
  readonly rightCount?: number
  /** Whether the missing content is a table, for the gap label. */
  readonly leftObject?: AlignGapObject
  readonly rightObject?: AlignGapObject
}

export interface AlignSpace {
  readonly side: AlignSide
  readonly position: AlignGapPosition
  readonly kind: AlignGapKind
  readonly height: number
  readonly count?: number
  readonly object?: AlignGapObject
}

/** Sub-pixel differences are not worth a gap. */
const EPSILON = 0.5

/**
 * Returns the spaces to add for the measured intervals. A semantic gap on the
 * shorter side is used when present; otherwise a residual (neutral) gap is
 * added before the next anchor on that side.
 */
export function computeSpaces(
  intervals: readonly AlignInterval[],
): AlignSpace[] {
  const spaces: AlignSpace[] = []
  for (const interval of intervals) {
    const delta = interval.rightDistance - interval.leftDistance
    if (Math.abs(delta) <= EPSILON) {
      continue
    }
    if (delta > 0) {
      if (interval.leftGap) {
        spaces.push({
          side: 'left',
          position: interval.leftPosition,
          kind: interval.leftKind ?? 'residual',
          height: delta,
          ...gapLabel(interval.leftCount, interval.leftObject),
        })
      } else {
        spaces.push({
          side: 'left',
          position: 'before',
          kind: 'residual',
          height: delta,
        })
      }
    } else {
      if (interval.rightGap) {
        spaces.push({
          side: 'right',
          position: interval.rightPosition,
          kind: interval.rightKind ?? 'residual',
          height: -delta,
          ...gapLabel(interval.rightCount, interval.rightObject),
        })
      } else {
        spaces.push({
          side: 'right',
          position: 'before',
          kind: 'residual',
          height: -delta,
        })
      }
    }
  }
  return spaces
}

function gapLabel(
  count: number | undefined,
  object: AlignGapObject | undefined,
): { count?: number; object?: AlignGapObject } {
  return {
    ...(count !== undefined ? { count } : {}),
    ...(object !== undefined ? { object } : {}),
  }
}
