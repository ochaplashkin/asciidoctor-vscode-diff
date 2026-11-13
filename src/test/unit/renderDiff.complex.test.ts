import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { DiffRenderOptions } from '../../features/diff/blockDiff.js'
import { renderDiff } from '../../features/diff/renderDiff.js'

/**
 * Complex, realistic rendered-document pairs.
 *
 * The simple per-feature tests live in `renderDiff.test.ts`; these ones diff two
 * whole "files" with sections, lists, admonitions, tables, code, images and
 * anchors, and change them in the middle, several times, or in a column — the
 * cases where an off-by-one alignment or a double-counted marker shows up.
 */

function doc(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><base href="https://host/docs/v1/index.adoc"><script nonce="deadbeef" src="pre.js"></script></head><body class="vscode-body"><div id="preview-root">${body}</div></body></html>`
}

function diff(leftBody: string, rightBody: string) {
  return renderDiff(doc(leftBody), doc(rightBody))
}

function diffWithOptions(
  leftBody: string,
  rightBody: string,
  options: DiffRenderOptions,
) {
  return renderDiff(doc(leftBody), doc(rightBody), options)
}

function hunkIds(html: string): string[] {
  return [
    ...new Set(
      [...html.matchAll(/data-adoc-diff-hunk="([^"]+)"/g)].map(
        (match) => match[1],
      ),
    ),
  ]
}

function allHunkIds(html: string): string[] {
  return [...html.matchAll(/data-adoc-diff-hunk="([^"]+)"/g)].map(
    (match) => match[1],
  )
}

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

function paragraph(line: number, text: string): string {
  return `<div class="paragraph data-line-${line}"><p class="data-line-${line}">${text}</p></div>`
}

function table(
  options: {
    widths?: string[]
    header?: string[]
    rows?: string[][]
    line?: number
  } = {},
): string {
  const widths = options.widths ?? ['25%', '25%', '25%', '25%']
  const header = options.header ?? ['Name', 'Count', 'Status', 'Owner']
  const rows = options.rows ?? [
    ['alpha', '1', 'ready', 'ann'],
    ['beta', '2', 'ready', 'bob'],
    ['gamma', '3', 'draft', 'carl'],
    ['delta', '4', 'ready', 'dina'],
  ]
  const line = options.line ?? 40
  const cols = widths.map((width) => `<col width="${width}">`).join('')
  const head = header.map((cell) => `<th>${cell}</th>`).join('')
  const body = rows
    .map(
      (row, index) =>
        `<tr class="data-line-${line + index + 2}">${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`,
    )
    .join('')
  return `<table class="tableblock data-line-${line}"><colgroup>${cols}</colgroup><thead class="data-line-${line + 1}"><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

function code(lines: readonly string[], line = 20): string {
  return `<div class="listingblock data-line-${line}"><div class="content"><pre class="highlight"><code>${lines.join('\n')}</code></pre></div></div>`
}

function image(src: string, alt = 'Diagram', line = 60): string {
  return `<div class="imageblock data-line-${line}"><div class="content"><img src="${src}" alt="${alt}"></div></div>`
}

const TABLE_HEADER = ['Name', 'Count', 'Status', 'Owner']
const TABLE_ROWS = [
  ['alpha', '1', 'ready', 'ann'],
  ['beta', '2', 'ready', 'bob'],
  ['gamma', '3', 'draft', 'carl'],
  ['delta', '4', 'ready', 'dina'],
]

function section(id: string, title: string, body: string, line: number) {
  return `<div class="sect1 data-line-${line}"><h2 id="${id}">${title}</h2><div class="sectionbody">${body}</div></div>`
}

/**
 * A "real" document with several sections, each exercising a different kind of
 * alignment: prose, lists, a table with a header, code and an image.
 */
function baselineDocument(): string {
  return [
    section(
      'overview',
      'Overview',
      [
        paragraph(2, 'The product overview describes the supported platforms.'),
        `<div class="ulist data-line-4"><ul><li><p>Linux</p></li><li><p>macOS</p></li><li><p>Windows</p></li><li><p>Web</p></li></ul></div>`,
        `<div class="admonitionblock note data-line-9"><table><tr><td class="icon"><div class="title">Note</div></td><td class="content">Read the security section first.</td></tr></table></div>`,
      ].join(''),
      1,
    ),
    section(
      'configuration',
      'Configuration',
      [
        paragraph(12, 'The configuration file lists every supported option.'),
        table({ line: 14, header: TABLE_HEADER, rows: TABLE_ROWS }),
      ].join(''),
      11,
    ),
    section(
      'examples',
      'Examples',
      [
        code(
          [
            'def configure(path)',
            '  options = parse(path)',
            '  validate(options)',
            '  apply(options)',
            '  log("done")',
            'end',
          ],
          30,
        ),
        image('images/diagram-one.png'),
      ].join(''),
      29,
    ),
    section(
      'appendix',
      'Appendix',
      paragraph(70, 'Contact the maintainers for further information.'),
      69,
    ),
  ].join('')
}

describe('renderDiff with complex documents', () => {
  test('marks only the changed row for one cell change in the middle of a table', () => {
    const left = baselineDocument()
    const right = baselineDocument().replace(
      '<td>3</td><td>draft</td>',
      '<td>3</td><td>published</td>',
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.visualChanges, 1)
    assert.equal(result.stats.nonVisualChanges, 0)
    assert.equal(result.stats.changedCells, 1)
    assert.equal(result.stats.changedTables, 1)
    // A cell is not a block change of its own: the row owns the hunk.
    assert.equal(result.stats.changedBlocks, 0)
    assert.equal(count(result.leftHtml, /adoc-diff-cell-changed/g), 1)
    assert.equal(count(result.rightHtml, /adoc-diff-cell-changed/g), 1)
    // The hunk is attached to a row, once on each side.
    const leftHunks = hunkIds(result.leftHtml)
    assert.deepEqual(leftHunks, hunkIds(result.rightHtml))
    assert.equal(leftHunks.length, 1)
    assert.match(
      result.rightHtml,
      /<tr[^>]*data-adoc-diff-hunk="h\d+"[^>]*>[\s\S]*published/,
    )
    assert.doesNotMatch(result.leftHtml, /adoc-diff-table-del/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-table-ins/)
  })

  test('counts one hunk per changed row when several rows change', () => {
    const left = baselineDocument()
    const right = baselineDocument()
      .replace('<td>1</td><td>ready</td>', '<td>10</td><td>ready</td>')
      .replace('<td>4</td><td>ready</td>', '<td>40</td><td>ready</td>')
    const result = diff(left, right)
    assert.equal(result.stats.changedCells, 2)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(result.stats.changes, 2)
    assert.equal(hunkIds(result.leftHtml).length, 2)
    assert.deepEqual(hunkIds(result.leftHtml), hunkIds(result.rightHtml))
  })

  test('adds a column in the middle as one table hunk, not one per row', () => {
    const header = ['Name', 'Count', 'Severity', 'Status', 'Owner']
    const rows = TABLE_ROWS.map((row) => [
      row[0],
      row[1],
      'high',
      row[2],
      row[3],
    ])
    const leftTable = table({
      line: 14,
      header: TABLE_HEADER,
      rows: TABLE_ROWS,
    })
    const rightTable = table({
      line: 14,
      widths: ['20%', '20%', '20%', '20%', '20%'],
      header,
      rows,
    })
    const left = baselineDocument()
    const right = baselineDocument().replace(leftTable, rightTable)
    const result = diff(left, right)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(result.stats.changes, 1)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.equal(count(result.leftHtml, /<col /g), 5)
    assert.equal(count(result.rightHtml, /<col /g), 5)
    assert.match(result.leftHtml, /adoc-diff-col-gap/)
    assert.match(result.rightHtml, /adoc-diff-cell-ins/)
  })

  test('adds a row in the middle: the row and its placeholder share one hunk', () => {
    const row =
      '<tr class="data-line-19"><td>epsilon</td><td>5</td><td>new</td><td>eve</td></tr>'
    const left = baselineDocument()
    const right = baselineDocument().replace(
      '<tr class="data-line-19"><td>delta</td>',
      `${row}<tr class="data-line-20"><td>delta</td>`,
    )
    const result = diff(left, right)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(result.stats.changes, 1)
    const hunks = hunkIds(result.leftHtml)
    assert.equal(hunks.length, 1)
    assert.equal(hunks[0], hunkIds(result.rightHtml)[0])
    assert.match(result.leftHtml, /data-adoc-diff-row-gap="ins"/)
    assert.match(result.rightHtml, /adoc-diff-row-ins/)
    // The placeholder and the added row are both navigation targets of the hunk.
    assert.match(
      result.leftHtml,
      /<tr[^>]*adoc-diff-row-gap[^>]*data-adoc-diff-hunk/,
    )
    assert.match(
      result.rightHtml,
      /<tr[^>]*adoc-diff-row-ins[^>]*data-adoc-diff-hunk/,
    )
  })

  test('a changed table width is one visible hunk, not a phantom count', () => {
    const left = baselineDocument()
    const right = baselineDocument().replace(
      '<colgroup><col width="25%"><col width="25%"><col width="25%"><col width="25%"></colgroup>',
      '<colgroup><col width="40%"><col width="20%"><col width="20%"><col width="20%"></colgroup>',
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.visualChanges, 1)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    // The counter is backed by a marker the reader can see.
    assert.match(result.leftHtml, /class="[^"]*adoc-diff-block-changed/)
    assert.match(result.rightHtml, /class="[^"]*adoc-diff-block-changed/)
  })

  test('splits a code block into one hunk per continuous changed run', () => {
    const before = [
      'line one',
      'line two',
      'line three',
      'line four',
      'line five',
      'line six',
      'line seven',
      'line eight',
      'line nine',
      'line ten',
    ]
    const after = [
      'line one',
      'line TWO CHANGED',
      'line three',
      'line four',
      'line EIGHT?',
      'line seven',
      'line eight',
      'line nine',
      'line ten',
      'line eleven',
    ]
    const result = diff(code(before), code(after))
    assert.equal(result.stats.changedBlocks, 1)
    // line two + lines five/six + the appended line: three runs.
    assert.equal(result.stats.changes, 3)
    assert.equal(hunkIds(result.leftHtml).length, 3)
    assert.deepEqual(hunkIds(result.leftHtml), hunkIds(result.rightHtml))
    assert.match(result.leftHtml, /adoc-diff-code-line-changed/)
    assert.match(result.leftHtml, /adoc-diff-code-line-del/)
    assert.match(result.rightHtml, /adoc-diff-code-line-add/)
    // The two deleted lines share one hunk.
    const deletedHunks = [
      ...result.leftHtml.matchAll(
        /adoc-diff-code-line-del[^"]*"[^>]*data-adoc-diff-hunk="([^"]+)"/g,
      ),
    ].map((match) => match[1])
    assert.equal(new Set(deletedHunks).size, 1)
  })

  test('collapses a long deleted listing in the middle and marks both sides', () => {
    const lines = Array.from(
      { length: 20 },
      (_, index) => `puts "line ${index + 1}"`,
    )
    const deleted = code(lines, 33)
    const left = baselineDocument().replace(
      '<div class="imageblock data-line-60">',
      `${deleted}<div class="imageblock data-line-60">`,
    )
    const result = diff(left, baselineDocument())
    assert.match(result.leftHtml, /adoc-diff-collapsed/)
    assert.match(result.leftHtml, /data-adoc-diff-collapse-lines="20"/)
    assert.match(
      result.leftHtml,
      /data-adoc-diff-collapse-excerpt="puts &quot;line 1&quot;[^"]*…"/,
    )
    assert.match(result.rightHtml, /data-adoc-diff-gap="del"/)
    assert.match(result.rightHtml, /data-adoc-diff-gap-object="lines"/)
    assert.match(result.rightHtml, /data-adoc-diff-gap-count="20"/)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.removedBlocks, 1)
    // The deleted block and the gap on the new side share the hunk id, so the
    // navigator can show both sides of the deletion.
    const leftHunk = allHunkIds(result.leftHtml).find((id) => id !== '')
    assert.ok(leftHunk)
    assert.match(
      result.rightHtml,
      new RegExp(
        `data-adoc-diff-gap="del"[^>]*data-adoc-diff-hunk="${leftHunk}"`,
      ),
    )
  })

  test('keeps a long deleted block visible with a labelled gap when expanding', () => {
    const lines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`)
    const deleted = code(lines, 33)
    const left = baselineDocument().replace(
      '<div class="imageblock data-line-60">',
      `${deleted}<div class="imageblock data-line-60">`,
    )
    const result = diffWithOptions(left, baselineDocument(), {
      align: true,
      deletedBlocks: 'expand',
      codeBlocks: 'line',
      collapseLines: 5,
      showStats: true,
    })
    assert.doesNotMatch(result.leftHtml, /adoc-diff-collapsed/)
    assert.match(result.rightHtml, /data-adoc-diff-gap="del"/)
    assert.match(result.rightHtml, /data-adoc-diff-gap-count="12"/)
  })

  test('reports formatting, link and id changes without visual markers', () => {
    const left = [
      '<div class="sect1"><p class="data-line-1"><strong>same text</strong></p></div>',
      '<p class="data-line-2"><a href="old-target.html">documentation</a></p>',
      '<div id="old-anchor" class="data-line-3"><p>anchor</p></div>',
    ].join('')
    const right = [
      '<div class="sect1"><p class="data-line-1"><em>same text</em></p></div>',
      '<p class="data-line-2"><a href="new-target.html">documentation</a></p>',
      '<div id="new-anchor" class="data-line-3"><p>anchor</p></div>',
    ].join('')
    const result = diff(left, right)
    assert.equal(result.stats.visualChanges, 0)
    assert.equal(result.stats.nonVisualChanges, 3)
    assert.equal(result.stats.changes, 3)
    assert.equal(result.stats.formattingChanges, 1)
    assert.equal(result.stats.linkChanges, 1)
    assert.equal(result.stats.idChanges, 1)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-word/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-word/)
    assert.match(result.leftHtml, /data-adoc-diff-nonvisual="formatting"/)
    assert.match(result.leftHtml, /data-adoc-diff-nonvisual="link"/)
    assert.match(result.leftHtml, /data-adoc-diff-nonvisual="id"/)
    assert.equal(hunkIds(result.leftHtml).length, 3)
  })

  test('detects a link change when the whole document is visually identical', () => {
    const left =
      '<p class="data-line-1"><a href="v1/index.html">See the guide</a></p>'
    const right =
      '<p class="data-line-1"><a href="v2/index.html">See the guide</a></p>'
    const result = diff(left, right)
    assert.equal(result.stats.visualChanges, 0)
    assert.equal(result.stats.nonVisualChanges, 1)
    assert.equal(result.stats.linkChanges, 1)
    assert.equal(result.stats.changes, 1)
    assert.match(result.leftHtml, /data-adoc-diff-nonvisual="link"/)
    // Anchors are still added so the panel can align the navigation target.
    assert.match(result.leftHtml, /data-adoc-diff-anchor="root"/)
  })

  test('does not report a difference for a truly identical document', () => {
    const result = diff(baselineDocument(), baselineDocument())
    assert.equal(result.stats.changes, 0)
    assert.deepEqual(hunkIds(result.leftHtml), [])
    // `data-adoc-diff-key` is the media identity used for comparison; it is not
    // a marker and does not count as a difference.
    assert.doesNotMatch(
      result.leftHtml,
      /adoc-diff-(?:anchor|hunk|block|word|cell|table|collapsed|nonvisual|media)/,
    )
  })

  test('inserts several blocks in the middle and keeps the hunk order', () => {
    const left = baselineDocument()
    const right = baselineDocument()
      // New paragraph between the overview paragraph and the list.
      .replace(
        '<div class="ulist data-line-4">',
        `${paragraph(3, 'A newly added paragraph in the middle of the section.')}<div class="ulist data-line-4">`,
      )
      // A fourth list item inserted in the middle of the list.
      .replace(
        '<li><p>Windows</p></li>',
        '<li><p>Windows</p></li><li><p>BSD</p></li>',
      )
      // A changed image in a later section.
      .replace('images/diagram-one.png', 'images/diagram-two.png')
    const result = diff(left, right)
    assert.equal(result.stats.changes, 3)
    const hunks = hunkIds(result.leftHtml)
    assert.equal(hunks.length, 3)
    // The kernel numbers hunks in document order, so the navigator visits them
    // from the top of the document to the bottom.
    assert.deepEqual(hunks, ['h0', 'h1', 'h2'].slice(0, hunks.length))
    assert.deepEqual(hunks, hunkIds(result.rightHtml))
    // The added paragraph and list item are visible on the new side.
    assert.match(result.rightHtml, /A newly added paragraph/)
    assert.match(result.rightHtml, /adoc-diff-block-ins/)
    assert.match(result.leftHtml, /data-adoc-diff-gap="ins"/)
    // The image change is visible even without a word to wrap.
    assert.match(result.rightHtml, /adoc-diff-media-changed/)
  })

  test('does not double count a table change nested in a changed section', () => {
    const left = baselineDocument()
    const right = baselineDocument()
      .replace(
        'The configuration file lists every supported option.',
        'The configuration file lists all supported options.',
      )
      .replace('<td>2</td><td>ready</td>', '<td>2</td><td>verified</td>')
    const result = diff(left, right)
    // One prose change and one table row change: two hunks, not four.
    assert.equal(result.stats.changes, 2)
    assert.equal(hunkIds(result.leftHtml).length, 2)
    assert.equal(count(result.leftHtml, /adoc-diff-block-changed/g), 1)
    assert.equal(count(result.leftHtml, /adoc-diff-cell-changed/g), 1)
  })

  test('pairs list items by content when an item is inserted in the middle', () => {
    const list = (items: string) => `<div class="ulist"><ul>${items}</ul></div>`
    const item = (text: string) => `<li><p>${text}</p></li>`
    const left = list(
      item('one') +
        `<li><p>two</p>${list(item('nested two'))}</li>` +
        item('three'),
    )
    const right = list(
      item('one') +
        item('inserted') +
        `<li><p>two</p>${list(item('nested two changed'))}</li>` +
        item('three'),
    )
    const result = diff(left, right)
    // The inserted item is the only one-sided block; it must not shift "two"
    // and "three" into a changed pairing.
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(result.stats.removedBlocks, 0)
    assert.equal(result.stats.changes, 2)
    assert.match(result.rightHtml, /adoc-diff-block-ins/)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-collapsed/)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-block-del/)
    // "nested two" -> "nested two changed": the added word is an insertion.
    assert.match(result.rightHtml, /adoc-diff-word adoc-diff-word-ins/)
    // "two" is paired on both sides, so its nested list is diffed inside it.
    assert.match(
      result.leftHtml,
      /<li[^>]*>\s*<p[^>]*>two<\/p>[\s\S]*nested two/,
    )
    assert.match(
      result.rightHtml,
      /<li[^>]*>\s*<p[^>]*>two<\/p>[\s\S]*nested two[\s\S]*changed/,
    )
  })

  test('pairs a code block with the code block, not with a neighbouring paragraph', () => {
    const shortCode = (bar: string) => code(['def foo', `  ${bar}`, 'end'], 5)
    const longCode = code(
      Array.from({ length: 20 }, (_, index) => `puts "line ${index + 1}"`),
      12,
    )
    const left = `<div class="sect1"><div class="sectionbody">${shortCode('bar')}${longCode}${paragraph(40, 'A')}</div></div>`
    const right = `<div class="sect1"><div class="sectionbody">${paragraph(3, 'new prose')}${shortCode('bar!')}${paragraph(40, 'A')}</div></div>`
    const result = diff(left, right)
    // The long listing has no counterpart: it must be collapsed, not line-diffed
    // against the short one.
    assert.match(result.leftHtml, /adoc-diff-collapsed/)
    assert.match(result.rightHtml, /data-adoc-diff-gap="del"/)
    assert.equal(result.stats.removedBlocks, 1)
    // The short listing is compared as code, not replaced wholesale.
    assert.match(result.leftHtml, /adoc-diff-code-line-changed/)
    assert.doesNotMatch(
      result.leftHtml,
      /<div class="listingblock data-line-5"[^>]*adoc-diff-block-del/,
    )
  })

  test('keeps the same hunk ids on both sides for paired changes', () => {
    const left = baselineDocument()
    const right = baselineDocument()
      .replace('supported platforms', 'supported operating systems')
      .replace('<td>1</td>', '<td>11</td>')
      .replace('images/diagram-one.png', 'images/diagram-three.png')
    const result = diff(left, right)
    assert.deepEqual(hunkIds(result.leftHtml), hunkIds(result.rightHtml))
    assert.equal(hunkIds(result.leftHtml).length, 3)
  })

  test('reports reordered sections as moved, not as an addition and a removal', () => {
    const section = (n: number, line: number) =>
      `<div class="sect1 data-line-${line}"><h2 id="_s${n}">Section ${n}</h2><div class="sectionbody"><p>Paragraph ${n} with some words about topic ${n}.</p></div></div>`
    const left = [1, 2, 3, 4, 5]
      .map((n, index) => section(n, 18 + index * 12))
      .join('')
    const right = [3, 1, 5, 2, 4]
      .map((n, index) => section(n, 18 + index * 12))
      .join('')
    const result = diff(left, right)
    // Two sections changed position; each is one navigable move, and neither is
    // an addition or a removal.
    assert.equal(result.stats.movedBlocks, 2)
    assert.equal(result.stats.addedBlocks, 0)
    assert.equal(result.stats.removedBlocks, 0)
    assert.equal(result.stats.changes, 2)
    assert.equal(count(result.leftHtml, /adoc-diff-moved"/g), 2)
    assert.equal(count(result.rightHtml, /adoc-diff-moved"/g), 2)
    assert.match(result.leftHtml, /data-adoc-diff-moved="h0"/)
    assert.match(result.rightHtml, /data-adoc-diff-moved="h0"/)
    // A moved section must stay visible, with no gap and no collapsed strip.
    assert.doesNotMatch(result.leftHtml, /adoc-diff-block-del/)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-collapsed/)
    assert.doesNotMatch(result.leftHtml, /data-adoc-diff-gap/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-block-ins/)
  })

  test('keeps the media marker on the container that survives client rendering', () => {
    const left = image('images/one.png', 'Diagram', 5)
    const right = image('images/two.png', 'Diagram', 5)
    const result = diff(left, right)
    // The image itself is replaced by Mermaid/PlantUML after the diff is built;
    // the block that wraps it is not, so it carries the icon for the media.
    assert.match(
      result.leftHtml,
      /<div class="content[^"]*"[^>]*data-adoc-diff-media-changed/,
    )
    assert.match(
      result.rightHtml,
      /<div class="content[^"]*"[^>]*data-adoc-diff-media-changed/,
    )
    // A media change has no word markup, so the block keeps the icon.
    assert.match(result.leftHtml, /data-adoc-diff-icon/)
    assert.match(result.rightHtml, /data-adoc-diff-icon/)
    // The shell must never become the host of the icon.
    assert.doesNotMatch(
      result.leftHtml,
      /<html[^>]*data-adoc-diff-media-changed/,
    )
    assert.match(result.leftHtml, /adoc-diff-media-changed/)
  })
})
