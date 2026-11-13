import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { diffTitles } from '../../features/diff/diffTitle.js'

describe('diffTitles', () => {
  test('uses the basenames when they differ', () => {
    const titles = diffTitles('/docs/guide.adoc', '/docs/reference.adoc')
    assert.equal(titles.left, 'guide.adoc')
    assert.equal(titles.right, 'reference.adoc')
    assert.equal(titles.leftFullPath, '/docs/guide.adoc')
    assert.equal(titles.rightFullPath, '/docs/reference.adoc')
  })

  test('adds the parent directory when the basenames collide', () => {
    const titles = diffTitles(
      '/workspace/v1/index.adoc',
      '/workspace/v2/index.adoc',
    )
    assert.equal(titles.left, 'v1/index.adoc')
    assert.equal(titles.right, 'v2/index.adoc')
  })

  test('falls back to the full paths when the parents are named the same', () => {
    const titles = diffTitles(
      '/workspace/a/docs/index.adoc',
      '/workspace/b/docs/index.adoc',
    )
    assert.equal(titles.left, '/workspace/a/docs/index.adoc')
    assert.equal(titles.right, '/workspace/b/docs/index.adoc')
  })
})
