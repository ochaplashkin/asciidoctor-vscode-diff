/**
 * Thin, dependency-free wrappers over the parse5 default tree adapter.
 *
 * These are the only helpers the diff kernel uses to build and mutate the DOM;
 * keeping them in one place isolates the kernel from parse5's low-level node
 * representation and makes the intent of each mutation explicit.
 */

import type { DefaultTreeAdapterMap } from 'parse5'
import {
  defaultTreeAdapter,
  html,
  parse as parse5Parse,
  parseFragment as parse5ParseFragment,
  serialize as parse5Serialize,
  serializeOuter as parse5SerializeOuter,
} from 'parse5'

// parse5's root module only re-exports `DefaultTreeAdapterMap`, so derive the
// concrete node types from it rather than importing deep (non-exported) paths.
export type Element = DefaultTreeAdapterMap['element']
export type TextNode = DefaultTreeAdapterMap['textNode']
export type CommentNode = DefaultTreeAdapterMap['commentNode']
export type ChildNode = DefaultTreeAdapterMap['childNode']
export type ParentNode = DefaultTreeAdapterMap['parentNode']
export type Document = DefaultTreeAdapterMap['document']
export type DocumentFragment = DefaultTreeAdapterMap['documentFragment']
export type Attribute = Element['attrs'][number]

/** A simple text range expressed as [start, end) offsets. */
export interface TextRange {
  readonly start: number
  readonly end: number
}

export function isElement(node: ChildNode): node is Element {
  return (
    node.nodeName !== '#text' &&
    node.nodeName !== '#comment' &&
    node.nodeName !== '#documentType'
  )
}

export function isText(node: ChildNode): node is TextNode {
  return node.nodeName === '#text'
}

export function isComment(node: ChildNode): node is CommentNode {
  return node.nodeName === '#comment'
}

export function getAttribute(el: Element, name: string): string | undefined {
  const attr = el.attrs.find((a) => a.name === name)
  return attr?.value
}

export function setAttribute(el: Element, name: string, value: string): void {
  const attr = el.attrs.find((a) => a.name === name)
  if (attr) {
    attr.value = value
  } else {
    el.attrs.push({ name, value })
  }
}

export function removeAttribute(el: Element, name: string): void {
  el.attrs = el.attrs.filter((a) => a.name !== name)
}

export function getClasses(el: Element): string[] {
  return (getAttribute(el, 'class') ?? '').split(/\s+/).filter(Boolean)
}

export function hasClass(el: Element, name: string): boolean {
  return getClasses(el).includes(name)
}

export function addClass(el: Element, name: string): void {
  const classes = getClasses(el)
  if (!classes.includes(name)) {
    classes.push(name)
    setAttribute(el, 'class', classes.join(' '))
  }
}

export function createElement(
  tagName: string,
  attrs: Attribute[] = [],
): Element {
  return defaultTreeAdapter.createElement(tagName, html.NS.HTML, attrs)
}

export function createTextNode(value: string): TextNode {
  return defaultTreeAdapter.createTextNode(value)
}

export function appendChild(parent: ParentNode, child: ChildNode): void {
  defaultTreeAdapter.appendChild(parent, child)
}

export function parse(htmlText: string): Document {
  return parse5Parse(htmlText)
}

export function parseFragment(htmlText: string): DocumentFragment {
  return parse5ParseFragment(htmlText)
}

export function serialize(node: ParentNode): string {
  return parse5Serialize(node)
}

export function serializeOuter(node: ChildNode): string {
  return parse5SerializeOuter(node)
}

/**
 * Walks a subtree in document order, invoking `visit` on each node.
 */
export function walk(root: ChildNode, visit: (node: ChildNode) => void): void {
  visit(root)
  if (isElement(root)) {
    for (const child of root.childNodes) {
      walk(child, visit)
    }
  }
}

/**
 * Finds the first element with the given `id` attribute in a subtree.
 */
export function findElementById(
  root: ChildNode,
  id: string,
): Element | undefined {
  let found: Element | undefined
  walk(root, (node) => {
    if (
      found === undefined &&
      isElement(node) &&
      getAttribute(node, 'id') === id
    ) {
      found = node
    }
  })
  return found
}

/**
 * Replaces a text node with a sequence of text nodes and `<span>`-wrapped
 * fragments, keeping everything else (the parent and its siblings) intact.
 *
 * `ranges` are local [start, end) offsets within `node.value`; the fragments
 * they cover are wrapped in a span carrying `className`.
 */
export function wrapTextNodeRanges(
  node: TextNode,
  ranges: TextRange[],
  className: string,
): void {
  const parent = node.parentNode
  if (!parent) {
    return
  }
  const value = node.value
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  // Coalesce overlapping/adjacent ranges so a single span wraps the whole run.
  const merged: TextRange[] = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end) {
      merged[merged.length - 1] = {
        start: last.start,
        end: Math.max(last.end, range.end),
      }
    } else {
      merged.push(range)
    }
  }

  const replacements: ChildNode[] = []
  let pos = 0
  for (const range of merged) {
    if (range.start > pos) {
      replacements.push(createTextNode(value.slice(pos, range.start)))
    }
    const span = createElement('span', [{ name: 'class', value: className }])
    appendChild(span, createTextNode(value.slice(range.start, range.end)))
    replacements.push(span)
    pos = range.end
  }
  if (pos < value.length) {
    replacements.push(createTextNode(value.slice(pos)))
  }
  if (replacements.length === 0) {
    return
  }

  const index = parent.childNodes.indexOf(node)
  for (const replacement of replacements) {
    replacement.parentNode = parent
  }
  parent.childNodes.splice(index, 1, ...replacements)
}

/**
 * Wraps a node (typically a text node that has no element wrapper to attach a
 * class to) in a span carrying `className`, replacing it in place.
 */
export function wrapNodeInSpan(node: ChildNode, className: string): void {
  const parent = node.parentNode
  if (!parent) {
    return
  }
  const span = createElement('span', [{ name: 'class', value: className }])
  const index = parent.childNodes.indexOf(node)
  span.parentNode = parent
  parent.childNodes.splice(index, 1, span)
  node.parentNode = span
  span.childNodes = [node]
}

/**
 * The concatenated text of all text nodes in a subtree, in document order,
 * without descending into `script`/`style` elements.
 */
export function collectText(root: ChildNode): string {
  let out = ''
  walk(root, (node) => {
    if (isText(node)) {
      out += node.value
    }
  })
  return out
}
