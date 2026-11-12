/**
 * Pure tokenization of the *visible* text of a rendered block.
 *
 * The tokenizer splits text into three kinds of tokens, each carrying its
 * [start, end) offsets into the input string so callers can map a diff back to
 * the original text nodes:
 *
 * - `word` — a run of Unicode letters/digits, optionally joined by internal
 *   hyphens or apostrophes (`state-of-the-art`, `l'utilisateur`);
 * - `space` — a run of whitespace;
 * - `punct` — a single punctuation character.
 *
 * Whitespace tokens are never highlighted (a change like `a b` → `a  b` is not a
 * visual difference), and punctuation is highlighted only when it falls inside
 * a changed range. Keeping punctuation and whitespace as explicit tokens (rather
 * than dropping them) is what preserves the offsets needed to split the DOM text
 * nodes and wrap only the changed fragments.
 */

export type TextTokenType = 'word' | 'space' | 'punct'

export interface TextToken {
  readonly type: TextTokenType
  readonly value: string
  /** Offset of the first character in the visible text. */
  readonly start: number
  /** Offset one past the last character. */
  readonly end: number
}

// Words may contain internal hyphens/apostrophes so "state-of-the-art" and
// "l'utilisateur" diff as a single token rather than three.
const WORD_RE = /[\p{L}\p{N}]+(?:['’ʼ-][\p{L}\p{N}]+)*/gu

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch)
}

function pushNonWord(text: string, base: number, tokens: TextToken[]): void {
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (isWhitespace(ch)) {
      let j = i + 1
      while (j < text.length && isWhitespace(text[j])) {
        j++
      }
      tokens.push({
        type: 'space',
        value: text.slice(i, j),
        start: base + i,
        end: base + j,
      })
      i = j
    } else {
      tokens.push({
        type: 'punct',
        value: ch,
        start: base + i,
        end: base + i + 1,
      })
      i++
    }
  }
}

/**
 * Splits `text` into word / space / punctuation tokens with stable offsets.
 */
export function tokenize(text: string): TextToken[] {
  const tokens: TextToken[] = []
  let pos = 0
  WORD_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = WORD_RE.exec(text)) !== null) {
    const start = match.index
    const end = start + match[0].length
    pushNonWord(text.slice(pos, start), pos, tokens)
    tokens.push({ type: 'word', value: match[0], start, end })
    pos = end
  }
  pushNonWord(text.slice(pos), pos, tokens)
  return tokens
}
