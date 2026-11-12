import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { renderDiff } from '../../features/diff/renderDiff.js'

function doc(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><script nonce="deadbeef" src="pre.js"></script></head><body><div id="preview-root">${body}</div></body></html>`
}

function diff(leftBody: string, rightBody: string) {
  return renderDiff(doc(leftBody), doc(rightBody))
}

describe('renderDiff', () => {
  test('leaves an unchanged document without markers', () => {
    const result = diff(
      '<p class="data-line-1">Hello</p>',
      '<p class="data-line-1">Hello</p>',
    )
    assert.doesNotMatch(result.leftHtml, /adoc-diff/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff/)
    assert.deepEqual(result.stats, {
      addedBlocks: 0,
      removedBlocks: 0,
      changedBlocks: 0,
      changedTables: 0,
    })
  })

  test('highlights a replaced word but not the whole block', () => {
    const result = diff(
      '<p class="data-line-1">Hello world</p>',
      '<p class="data-line-1">Hello AsciiDoc</p>',
    )
    assert.match(result.leftHtml, /adoc-diff-word adoc-diff-word-del/)
    assert.match(result.rightHtml, /adoc-diff-word adoc-diff-word-ins/)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-block/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-block/)
    assert.equal(result.stats.changedBlocks, 1)
  })

  test('marks an added block wholesale', () => {
    const result = diff(
      '<p class="data-line-1">A</p>',
      '<p class="data-line-1">A</p><p class="data-line-2">B</p>',
    )
    assert.doesNotMatch(result.leftHtml, /adoc-diff-block/)
    assert.match(result.rightHtml, /adoc-diff-block-ins/)
    assert.equal(result.stats.addedBlocks, 1)
  })

  test('marks a removed block wholesale', () => {
    const result = diff(
      '<p class="data-line-1">A</p><p class="data-line-2">B</p>',
      '<p class="data-line-1">A</p>',
    )
    assert.match(result.leftHtml, /adoc-diff-block-del/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-block/)
    assert.equal(result.stats.removedBlocks, 1)
  })

  test('highlights table, cell and word for a table change', () => {
    const result = diff(
      '<table class="tableblock"><tbody><tr><td class="tableblock"><p class="tableblock">old value</p></td></tr></tbody></table>',
      '<table class="tableblock"><tbody><tr><td class="tableblock"><p class="tableblock">new value</p></td></tr></tbody></table>',
    )
    assert.match(result.leftHtml, /adoc-diff-table-del/)
    assert.match(result.rightHtml, /adoc-diff-table-ins/)
    assert.match(result.leftHtml, /adoc-diff-cell-del/)
    assert.match(result.rightHtml, /adoc-diff-cell-ins/)
    assert.match(result.leftHtml, /adoc-diff-word adoc-diff-word-del/)
    assert.match(result.rightHtml, /adoc-diff-word adoc-diff-word-ins/)
    assert.equal(result.stats.changedTables, 1)
  })

  test('never uses del/ins tags or text-decoration', () => {
    const result = diff(
      '<p class="data-line-1">Hello world</p>',
      '<p class="data-line-1">Hello AsciiDoc</p>',
    )
    for (const html of [result.leftHtml, result.rightHtml]) {
      assert.doesNotMatch(html, /<del>|<ins>|text-decoration/)
    }
  })

  test('builds a line map of matched data-line anchors', () => {
    const result = diff(
      '<p class="data-line-1">A</p><p class="data-line-2">B</p>',
      '<p class="data-line-1">A</p><p class="data-line-4">B</p>',
    )
    assert.deepEqual(result.lineMap, [
      { leftLine: 1, rightLine: 1 },
      { leftLine: 2, rightLine: 4 },
    ])
  })
})
