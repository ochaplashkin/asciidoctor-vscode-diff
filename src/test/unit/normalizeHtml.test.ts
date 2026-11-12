import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { type Element, parseFragment } from '../../features/diff/htmlTree.js'
import {
  isIgnoredAttribute,
  isServiceClass,
  subtreeSignature,
  subtreesEqual,
  visualClasses,
} from '../../features/diff/normalizeHtml.js'

function firstElement(html: string): Element {
  const fragment = parseFragment(html)
  const el = fragment.childNodes.find((node) => node.nodeName !== '#text')
  if (!el || el.nodeName === '#text' || el.nodeName === '#comment') {
    throw new Error('Expected an element')
  }
  return el as Element
}

describe('isServiceClass', () => {
  test('recognizes data-line-N and data-h-HASH', () => {
    assert.equal(isServiceClass('data-line-12'), true)
    assert.equal(isServiceClass('data-h-abc123'), true)
  })

  test('does not treat roles as service classes', () => {
    assert.equal(isServiceClass('sect1'), false)
    assert.equal(isServiceClass('tableblock'), false)
    assert.equal(isServiceClass('code-line'), false)
  })
})

describe('isIgnoredAttribute', () => {
  test('ignores id, nonce, src, href, srcdoc and any data-*', () => {
    for (const name of [
      'id',
      'nonce',
      'src',
      'href',
      'srcdoc',
      'data-line',
      'data-h-abc',
      'data-shell',
    ]) {
      assert.equal(isIgnoredAttribute(name), true, name)
    }
  })

  test('keeps visual attributes', () => {
    for (const name of [
      'class',
      'style',
      'colspan',
      'rowspan',
      'width',
      'height',
      'alt',
    ]) {
      assert.equal(isIgnoredAttribute(name), false, name)
    }
  })
})

describe('visualClasses', () => {
  test('filters service classes out of the class attribute', () => {
    const el = firstElement(
      '<div class="tableblock adoc-x data-line-3 data-h-42"></div>',
    )
    assert.deepEqual(visualClasses(el), ['tableblock', 'adoc-x'])
  })
})

describe('subtreeSignature', () => {
  test('is insensitive to id, nonce and data-* attributes', () => {
    const a = firstElement(
      '<div id="x" nonce="abc" data-shell="s" class="role">Hi</div>',
    )
    const b = firstElement(
      '<div id="y" nonce="def" data-shell="t" class="role">Hi</div>',
    )
    assert.equal(subtreeSignature(a), subtreeSignature(b))
  })

  test('is insensitive to a class made up only of service classes', () => {
    const a = firstElement('<p class="data-line-1">Hi</p>')
    const b = firstElement('<p>Hi</p>')
    assert.equal(subtreeSignature(a), subtreeSignature(b))
  })

  test('is sensitive to visual text differences', () => {
    const a = firstElement('<p>Hello world</p>')
    const b = firstElement('<p>Hello AsciiDoc</p>')
    assert.notEqual(subtreeSignature(a), subtreeSignature(b))
  })

  test('collapses whitespace in text nodes', () => {
    const a = firstElement('<p>hello\n  world</p>')
    const b = firstElement('<p>hello world</p>')
    assert.equal(subtreeSignature(a), subtreeSignature(b))
  })

  test('subtreesEqual reflects visual equality', () => {
    const a = firstElement('<section><h2 data-line-1>Title</h2></section>')
    const b = firstElement('<section><h2 data-line-9>Title</h2></section>')
    assert.equal(subtreesEqual(a, b), true)
  })
})
