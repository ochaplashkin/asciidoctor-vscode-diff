import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { tokenize } from '../../features/diff/textTokens.js'

function values(text: string): string[] {
  return tokenize(text).map((token) => token.value)
}

describe('tokenize', () => {
  test('splits words, punctuation and whitespace', () => {
    assert.deepEqual(values('Hello, world!'), ['Hello', ',', ' ', 'world', '!'])
  })

  test('keeps internal hyphens and apostrophes inside a word', () => {
    assert.deepEqual(values("state-of-the-art l'utilisateur"), [
      'state-of-the-art',
      ' ',
      "l'utilisateur",
    ])
  })

  test('collapses a run of whitespace into one token', () => {
    assert.deepEqual(values('a  \t b'), ['a', '  \t ', 'b'])
  })

  test('treats each punctuation character as its own token', () => {
    assert.deepEqual(values('...'), ['.', '.', '.'])
  })

  test('records stable offsets into the input', () => {
    const text = 'Hi world!'
    const tokens = tokenize(text)
    assert.equal(tokens[0].start, 0)
    assert.equal(tokens[0].end, 2)
    assert.equal(tokens[1].start, 2)
    assert.equal(tokens[1].end, 3)
    assert.equal(tokens[2].start, 3)
    assert.equal(tokens[2].end, 8)
    assert.equal(tokens[3].start, 8)
    assert.equal(tokens[3].end, 9)
  })

  test('handles Unicode letters', () => {
    assert.deepEqual(values('Привет мир'), ['Привет', ' ', 'мир'])
  })

  test('handles empty input', () => {
    assert.deepEqual(values(''), [])
  })
})
