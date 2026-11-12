import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { computeInlineDiff } from '../../features/diff/inlineDiff.js'

describe('computeInlineDiff', () => {
  test('returns empty ranges for identical text', () => {
    const result = computeInlineDiff('Hello world', 'Hello world')
    assert.deepEqual(result, { left: [], right: [] })
  })

  test('highlights a single replaced word', () => {
    const result = computeInlineDiff('Hello world', 'Hello AsciiDoc')
    assert.deepEqual(result?.left, [{ start: 6, end: 11 }])
    assert.deepEqual(result?.right, [{ start: 6, end: 14 }])
  })

  test('highlights a removed word on the left only', () => {
    const result = computeInlineDiff('Hello brave world', 'Hello world')
    assert.deepEqual(result?.left, [{ start: 6, end: 11 }])
    assert.deepEqual(result?.right, [])
  })

  test('highlights an added word on the right only', () => {
    const result = computeInlineDiff('Hello world', 'Hello big world')
    assert.deepEqual(result?.right, [{ start: 6, end: 9 }])
    assert.deepEqual(result?.left, [])
  })

  test('does not highlight whitespace-only changes', () => {
    const result = computeInlineDiff('a b', 'a  b')
    assert.deepEqual(result?.left, [])
    assert.deepEqual(result?.right, [])
  })

  test('merges changed words separated by whitespace into one range', () => {
    const result = computeInlineDiff('one two three', 'one four five three')
    assert.deepEqual(result?.right, [{ start: 4, end: 13 }])
  })
})
