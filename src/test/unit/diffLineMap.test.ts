import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  type DiffLineMapEntry,
  mapLine,
  normalizeLineMap,
} from '../../features/diff/diffLineMap.js'

describe('normalizeLineMap', () => {
  test('sorts by left line and drops duplicate left lines', () => {
    const entries: DiffLineMapEntry[] = [
      { leftLine: 20, rightLine: 22 },
      { leftLine: 12, rightLine: 14 },
      { leftLine: 12, rightLine: 15 },
    ]
    assert.deepEqual(normalizeLineMap(entries), [
      { leftLine: 12, rightLine: 14 },
      { leftLine: 20, rightLine: 22 },
    ])
  })
})

describe('mapLine', () => {
  test('falls back to proportional mapping with an empty map', () => {
    assert.equal(mapLine(1, [], 11, 21), 1)
    assert.equal(mapLine(11, [], 11, 21), 21)
    assert.equal(mapLine(6, [], 11, 21), 11)
  })

  test('clamps before the first pair', () => {
    const entries = [
      { leftLine: 5, rightLine: 7 },
      { leftLine: 10, rightLine: 12 },
    ]
    assert.equal(mapLine(1, entries, 10, 12), 7)
  })

  test('clamps after the last pair', () => {
    const entries = [
      { leftLine: 5, rightLine: 7 },
      { leftLine: 10, rightLine: 12 },
    ]
    assert.equal(mapLine(15, entries, 20, 30), 12)
  })

  test('interpolates between pairs', () => {
    const entries = [
      { leftLine: 10, rightLine: 10 },
      { leftLine: 20, rightLine: 30 },
    ]
    assert.equal(mapLine(15, entries, 20, 30), 20)
  })

  test('returns the exact right line on an exact left match', () => {
    const entries = [{ leftLine: 10, rightLine: 30 }]
    assert.equal(mapLine(10, entries, 20, 30), 30)
  })

  test('handles a single-pair map by returning that pair everywhere', () => {
    const entries = [{ leftLine: 4, rightLine: 9 }]
    assert.equal(mapLine(1, entries, 10, 10), 9)
    assert.equal(mapLine(100, entries, 10, 10), 9)
  })
})
