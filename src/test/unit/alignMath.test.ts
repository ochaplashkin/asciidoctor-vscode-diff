import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  type AlignInterval,
  computeSpaces,
} from '../../features/diff/alignMath.js'

function interval(overrides: Partial<AlignInterval> = {}): AlignInterval {
  return {
    leftDistance: 100,
    rightDistance: 100,
    leftGap: false,
    rightGap: false,
    leftPosition: 'before',
    rightPosition: 'before',
    ...overrides,
  }
}

describe('computeSpaces', () => {
  test('returns nothing when the anchors are already aligned', () => {
    assert.deepEqual(computeSpaces([interval()]), [])
    assert.deepEqual(
      computeSpaces([interval({ leftDistance: 100, rightDistance: 100.4 })]),
      [],
    )
  })

  test('uses the semantic inset gap when the left side is shorter', () => {
    assert.deepEqual(
      computeSpaces([
        interval({
          leftDistance: 100,
          rightDistance: 160,
          leftGap: true,
          leftKind: 'ins',
        }),
      ]),
      [{ side: 'left', position: 'before', kind: 'ins', height: 60 }],
    )
  })

  test('uses the semantic deletion gap when the right side is shorter', () => {
    assert.deepEqual(
      computeSpaces([
        interval({
          leftDistance: 160,
          rightDistance: 100,
          rightGap: true,
          rightKind: 'del',
        }),
      ]),
      [{ side: 'right', position: 'before', kind: 'del', height: 60 }],
    )
  })

  test('keeps a gap-after semantic space after the previous anchor', () => {
    assert.deepEqual(
      computeSpaces([
        interval({
          leftDistance: 100,
          rightDistance: 140,
          leftGap: true,
          leftPosition: 'after',
          leftKind: 'ins',
        }),
      ]),
      [{ side: 'left', position: 'after', kind: 'ins', height: 40 }],
    )
  })

  test('falls back to a residual gap when no semantic gap is marked', () => {
    assert.deepEqual(
      computeSpaces([
        interval({ leftDistance: 100, rightDistance: 130 }),
        interval({ leftDistance: 140, rightDistance: 100 }),
      ]),
      [
        { side: 'left', position: 'before', kind: 'residual', height: 30 },
        { side: 'right', position: 'before', kind: 'residual', height: 40 },
      ],
    )
  })

  test('prefers the semantic gap when the shorter side has one', () => {
    // Both sides are marked, but only the shorter one receives a space.
    assert.deepEqual(
      computeSpaces([
        interval({
          leftDistance: 100,
          rightDistance: 120,
          leftGap: true,
          rightGap: true,
          leftKind: 'ins',
          rightKind: 'del',
        }),
      ]),
      [{ side: 'left', position: 'before', kind: 'ins', height: 20 }],
    )
  })
})
