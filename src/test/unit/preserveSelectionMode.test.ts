import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  isPreserveSelectionMode,
  PRESERVE_SELECTION_MODES,
} from '../../features/diff/preserveSelectionMode.js'

describe('isPreserveSelectionMode', () => {
  test('accepts every mode declared for the setting', () => {
    for (const mode of PRESERVE_SELECTION_MODES) {
      assert.equal(isPreserveSelectionMode(mode), true)
    }
  })

  test('rejects unknown, empty and non-string values', () => {
    assert.equal(isPreserveSelectionMode('left'), false)
    assert.equal(isPreserveSelectionMode(''), false)
    assert.equal(isPreserveSelectionMode(undefined), false)
    assert.equal(isPreserveSelectionMode(true), false)
    assert.equal(isPreserveSelectionMode(1), false)
  })
})
