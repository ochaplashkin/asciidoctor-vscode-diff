import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { truncateFileName } from '../../features/diff/selectionLabel.js'

describe('truncateFileName', () => {
  test('keeps a name within the limit unchanged', () => {
    assert.equal(truncateFileName('a.adoc'), 'a.adoc')
    assert.equal(truncateFileName('1234567890'), '1234567890')
  })

  test('keeps exactly ten characters and adds an ellipsis beyond that', () => {
    assert.equal(truncateFileName('review.adoc'), 'review.ado...')
    assert.equal(truncateFileName('12345678901'), '1234567890...')
  })

  test('truncates on code points, not UTF-16 units', () => {
    assert.equal(
      truncateFileName('😀😀😀😀😀😀😀😀😀😀😀'),
      '😀😀😀😀😀😀😀😀😀😀...',
    )
  })

  test('handles an empty name', () => {
    assert.equal(truncateFileName(''), '')
  })
})
