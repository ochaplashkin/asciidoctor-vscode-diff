/**
 * What the render diff ignores when comparing two DOM subtrees.
 *
 * The comparison is *visual*: it must not flag differences that the user cannot
 * see, and must not depend on document identity. The preview HTML carries a lot
 * of non-visual state (`data-line-N` / `data-h-HASH` service classes, `id`,
 * `nonce`, `data-*` attributes, and URI-bearing attributes such as `src`/`href`
 * that encode the document path and therefore always differ between two files).
 *
 * These helpers compute a canonical "signature" of a subtree after dropping
 * everything non-visual, which the block diff uses both to skip unchanged
 * subtrees and to align changed children. The live DOM is never mutated by this
 * module — normalization is a pure view over the tree.
 */

import {
  type ChildNode,
  collectText,
  type Element,
  getAttribute,
  getClasses,
  isComment,
  isElement,
  isText,
} from './htmlTree.js'

/** Service classes added by the preview pipeline and invisible to the user. */
const SERVICE_CLASS_RE = /^(?:data-line-\d+|data-h-[0-9a-z]+)$/

/**
 * Whether a class is a preview service class (not a visual role).
 */
export function isServiceClass(className: string): boolean {
  return SERVICE_CLASS_RE.test(className)
}

/**
 * The visual classes of an element: all classes except the preview service
 * classes. Order is preserved.
 */
export function visualClasses(el: Element): string[] {
  return getClasses(el).filter((className) => !isServiceClass(className))
}

/**
 * Whether an attribute is ignored for comparison because it is non-visual or
 * encodes document identity (URI).
 */
export function isIgnoredAttribute(name: string): boolean {
  const lower = name.toLowerCase()
  // The normalized media identity (see `renderDiff.annotateMediaKeys`) is the
  // only `data-*` attribute that participates in the comparison: the raw
  // `src`/`poster` values are webview URIs of the two documents and would
  // differ even for the same image.
  if (lower === 'data-adoc-diff-key') {
    return false
  }
  return (
    lower === 'id' ||
    lower === 'nonce' ||
    lower === 'src' ||
    lower === 'srcset' ||
    lower === 'poster' ||
    lower === 'data' ||
    lower === 'href' ||
    lower === 'srcdoc' ||
    lower.startsWith('data-')
  )
}

/**
 * The visual attribute pairs of an element, as sorted `name=value` strings, so
 * order-insensitive attribute comparison is stable.
 */
export function visualAttributePairs(el: Element): string[] {
  const pairs: string[] = []
  for (const attr of el.attrs) {
    if (isIgnoredAttribute(attr.name)) {
      continue
    }
    if (attr.name === 'class') {
      const classes = visualClasses(el)
      // A `class` made up entirely of service classes contributes nothing
      // visual; drop it so `<p class="data-line-1">` and `<p>` compare equal.
      if (classes.length === 0) {
        continue
      }
      pairs.push(`class=${classes.sort().join(' ')}`)
      continue
    }
    pairs.push(`${attr.name}=${attr.value}`)
  }
  return pairs.sort()
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ')
}

/**
 * The canonical signature of a subtree: a string that is equal for two subtrees
 * that render identically (after dropping non-visual state and URI attributes)
 * and differs otherwise. Text node whitespace is collapsed because the browser
 * collapses whitespace when rendering.
 */
export function subtreeSignature(node: ChildNode, verbatim = false): string {
  if (isText(node)) {
    // Whitespace is not visual outside verbatim content, but inside `pre` it is
    // content: an indentation change is a real, visible change.
    return `t:${verbatim ? node.value : collapseWhitespace(node.value)}`
  }
  if (isComment(node)) {
    return `c:${node.data}`
  }
  if (!isElement(node)) {
    return node.nodeName
  }
  // Script/style content is not visible; compare it as an opaque text blob.
  if (node.tagName === 'script' || node.tagName === 'style') {
    return `${node.tagName}:${collapseWhitespace(collectText(node))}`
  }
  const attrs = visualAttributePairs(node).join(',')
  const childVerbatim = verbatim || node.tagName === 'pre'
  const children = node.childNodes
    .map((child) => subtreeSignature(child, childVerbatim))
    .join('|')
  return `<${node.tagName}[${attrs}]>${children}`
}

/**
 * Whether two nodes render identically, after normalization.
 */
export function subtreesEqual(left: ChildNode, right: ChildNode): boolean {
  return subtreeSignature(left) === subtreeSignature(right)
}
