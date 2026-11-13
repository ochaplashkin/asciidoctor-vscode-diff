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
export function subtreeSignature(
  node: ChildNode,
  verbatim = false,
  ignoreGeneratedNavigation = true,
): string {
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
  // The table of contents is generated navigation, not content: an included
  // signature would count every heading change twice, add gap markers inside
  // the navigation, and take part in the alignment. It is compared separately
  // (`navigationSignature`) so a TOC-only change is not a false "No
  // differences".
  if (ignoreGeneratedNavigation && getAttribute(node, 'id') === 'toc') {
    return ''
  }
  const attrs = visualAttributePairs(node).join(',')
  const childVerbatim = verbatim || node.tagName === 'pre'
  const children = node.childNodes
    .map((child) =>
      subtreeSignature(child, childVerbatim, ignoreGeneratedNavigation),
    )
    .join('|')
  return `<${node.tagName}[${attrs}]>${children}`
}

/**
 * Whether two nodes render identically, after normalization.
 */
export function subtreesEqual(left: ChildNode, right: ChildNode): boolean {
  return subtreeSignature(left) === subtreeSignature(right)
}

/**
 * The signature of a subtree including its generated navigation. Used only to
 * compare the two tables of contents: a changed TOC is a real (navigation)
 * difference even when every heading is the same, for instance after changing
 * `:toclevels:`.
 */
export function navigationSignature(node: ChildNode): string {
  return subtreeSignature(node, false, false)
}

/**
 * The kind of a difference that is real but invisible in the rendered text.
 *
 * - `formatting`: the same text rendered with another tag or attribute (for
 *   example `<strong>` vs `<em>`, or a changed `class`/`style`);
 * - `link`: the target of a link changed, so a cross-reference now points
 *   elsewhere while the visible text stayed the same;
 * - `id`: an anchor id changed, which breaks incoming `#fragment` links.
 */
export type NonVisualChangeKind = 'formatting' | 'link' | 'id'

/**
 * The identity of a link target, comparable between two documents.
 *
 * `renderDiff` annotates every `href` with a document-relative
 * `data-adoc-diff-link-key` (the raw `href` carries the document path, like
 * `src` does for images), so the annotated key wins when present.
 */
export function linkTargetKey(el: Element): string | undefined {
  return getAttribute(el, 'data-adoc-diff-link-key') ?? getAttribute(el, 'href')
}

function idOf(el: Element): string {
  return getAttribute(el, 'id') ?? ''
}

/**
 * The kind of a difference between an element and its counterpart, ignoring
 * the descendants: tag, `id`, link target and visual attributes.
 */
export function ownNonVisualKinds(
  left: Element,
  right: Element,
): NonVisualChangeKind[] {
  const kinds = new Set<NonVisualChangeKind>()
  if (left.tagName !== right.tagName) {
    kinds.add('formatting')
  }
  if (idOf(left) !== idOf(right)) {
    kinds.add('id')
  }
  if ((linkTargetKey(left) ?? '') !== (linkTargetKey(right) ?? '')) {
    kinds.add('link')
  }
  if (
    visualAttributePairs(left).join(',') !==
    visualAttributePairs(right).join(',')
  ) {
    kinds.add('formatting')
  }
  return [...kinds]
}

function collectNonVisualKinds(
  left: Element,
  right: Element,
  kinds: Set<NonVisualChangeKind>,
): void {
  for (const kind of ownNonVisualKinds(left, right)) {
    kinds.add(kind)
  }
  const leftChildren = left.childNodes
  const rightChildren = right.childNodes
  if (leftChildren.length !== rightChildren.length) {
    kinds.add('formatting')
    return
  }
  for (let index = 0; index < leftChildren.length; index++) {
    const leftChild = leftChildren[index]
    const rightChild = rightChildren[index]
    if (isElement(leftChild) && isElement(rightChild)) {
      collectNonVisualKinds(leftChild, rightChild, kinds)
    } else if (isElement(leftChild) !== isElement(rightChild)) {
      kinds.add('formatting')
    }
  }
}

/**
 * Every kind of non-visual difference between two subtrees.
 *
 * The caller only uses this for subtrees whose *visible* signature is equal:
 * otherwise the visual diff already reports the change and a formatting badge
 * on the same block would count it twice.
 */
export function nonVisualKinds(
  left: Element,
  right: Element,
): Set<NonVisualChangeKind> {
  const kinds = new Set<NonVisualChangeKind>()
  collectNonVisualKinds(left, right, kinds)
  return kinds
}
