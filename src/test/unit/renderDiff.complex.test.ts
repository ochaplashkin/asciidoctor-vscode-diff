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

/** Count non-gap code lines of a kind (add/del/changed). */
function codeLineCount(html: string, kind: string): number {
  return count(
    html,
    new RegExp(`class="adoc-diff-code-line adoc-diff-code-line-${kind}"`, 'g'),
  )
}

/** Count code gap lines that reserve space for an added/removed line. */
function codeGapCount(html: string, kind: string): number {
  return count(
    html,
    new RegExp(
      `class="adoc-diff-code-line adoc-diff-code-line-gap adoc-diff-code-line-${kind}"`,
      'g',
    ),
  )
}

function paragraph(line: number, text: string): string {
  return `<div class="paragraph data-line-${line}"><p class="data-line-${line}">${text}</p></div>`
}

function table(
  options: {
    widths?: string[]
    header?: string[]
    rows?: string[][]
    footer?: string[]
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
  const head =
    header.length === 0
      ? ''
      : `<thead class="data-line-${line + 1}"><tr>${header.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead>`
  const body = rows
    .map(
      (row, index) =>
        `<tr class="data-line-${line + index + 2}">${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`,
    )
    .join('')
  const footer = options.footer
    ? `<tfoot><tr class="data-line-${line + rows.length + 2}">${options.footer.map((cell) => `<td>${cell}</td>`).join('')}</tr></tfoot>`
    : ''
  return `<table class="tableblock data-line-${line}"><colgroup>${cols}</colgroup>${head}<tbody>${body}</tbody>${footer}</table>`
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

function jsonCode(value: string): string {
  return code(value.split('\n'))
}

function listItem(text: string, children = ''): string {
  return `<li><p>${text}</p>${children}</li>`
}

function ulist(items: string): string {
  return `<div class="ulist"><ul>${items}</ul></div>`
}

function listDocument(items: string): string {
  return section('data', 'Lists', ulist(items), 1)
}

/** A two-column table whose content cell holds a list. */
function listInCellDocument(listHtml: string): string {
  return section(
    'data',
    'Data',
    table({
      line: 4,
      widths: ['33%', '66%'],
      header: ['Kind', 'Items'],
      rows: [['note', `<div class="content">${listHtml}</div>`]],
    }),
    1,
  )
}

/**
 * A document whose content is one section with a table. The row fixtures below
 * change this table, so the alignment of the surrounding section is exercised
 * too.
 */
function tableDocument(rows: string[][]): string {
  return section('data', 'Data', table({ line: 4, rows }), 1)
}

/** The outer table emitted for a nested table; `text` sits next to it. */
function nestedTableWithInner(inner: string, text = ''): string {
  const paragraph = text === '' ? '' : `<p class="tableblock">${text}</p>`
  return `<table class="tableblock data-line-4"><colgroup><col width="33%"><col width="66%"></colgroup><thead><tr><th>Kind</th><th>Content</th></tr></thead><tbody><tr class="data-line-6"><td>note</td><td><div class="content">${paragraph}${inner}</div></td></tr></tbody></table>`
}

function nestedTable(rows: string[][], text = ''): string {
  return nestedTableWithInner(
    table({
      line: 8,
      header: ['Name', 'Value'],
      widths: ['50%', '50%'],
      rows,
    }),
    text,
  )
}

function nestedTableDocument(rows: string[][], text = ''): string {
  return section('data', 'Data', nestedTable(rows, text), 1)
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

  test('appends a row at the end: a last-row placeholder and one inserted row', () => {
    const rightRows = [...TABLE_ROWS, ['epsilon', '5', 'new', 'eve']]
    const result = diff(tableDocument(TABLE_ROWS), tableDocument(rightRows))
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(result.stats.removedBlocks, 0)
    assert.equal(result.stats.changedCells, 0)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.deepEqual(hunkIds(result.leftHtml), hunkIds(result.rightHtml))
    // The old side reserves the space at the end of its tbody.
    assert.match(
      result.leftHtml,
      /<\/tr>\s*<tr[^>]*adoc-diff-row-gap[^>]*data-adoc-diff-row-gap="ins"[^>]*><td[^>]*colspan="4"/,
    )
    assert.match(
      result.rightHtml,
      /<tr[^>]*adoc-diff-row-ins[^>]*>[\s\S]*epsilon/,
    )
  })

  test('prepends a row: the placeholder is the first body row', () => {
    const rightRows = [['zero', '0', 'new', 'zoe'], ...TABLE_ROWS]
    const result = diff(tableDocument(TABLE_ROWS), tableDocument(rightRows))
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(result.stats.removedBlocks, 0)
    assert.match(
      result.leftHtml,
      /<tbody><tr[^>]*adoc-diff-row-gap[^>]*data-adoc-diff-row-gap="ins"/,
    )
    assert.match(
      result.rightHtml,
      /<tbody><tr[^>]*adoc-diff-row-ins[^>]*>[\s\S]*zero/,
    )
  })

  test('inserts a row before a footer: the placeholder stays in the tbody', () => {
    const footer = ['delta', '4', 'ready', 'dina']
    const left = section(
      'data',
      'Data',
      table({ line: 4, rows: [TABLE_ROWS[0], TABLE_ROWS[1]], footer }),
      1,
    )
    const right = section(
      'data',
      'Data',
      table({
        line: 4,
        rows: [TABLE_ROWS[0], TABLE_ROWS[1], ['inserted', '9', 'new', 'ian']],
        footer,
      }),
      1,
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(result.stats.removedBlocks, 0)
    const leftBody = /<tbody>([\s\S]*?)<\/tbody>/.exec(result.leftHtml)?.[1]
    const leftFoot = /<tfoot>([\s\S]*?)<\/tfoot>/.exec(result.leftHtml)?.[1]
    assert.match(
      leftBody ?? '',
      /adoc-diff-row-gap[^>]*data-adoc-diff-row-gap="ins"/,
    )
    assert.doesNotMatch(leftFoot ?? '', /adoc-diff-row-gap/)
    const rightBody = /<tbody>([\s\S]*?)<\/tbody>/.exec(result.rightHtml)?.[1]
    assert.match(rightBody ?? '', /adoc-diff-row-ins[^>]*>[\s\S]*inserted/)
  })

  test('adds a header row: the placeholder is a thead before the body', () => {
    const rows = [TABLE_ROWS[0], TABLE_ROWS[1]]
    const left = section(
      'data',
      'Data',
      table({ line: 4, header: [], rows }),
      1,
    )
    const right = section('data', 'Data', table({ line: 4, rows }), 1)
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.addedBlocks, 1)
    assert.match(
      result.leftHtml,
      /<thead[^>]*><tr[^>]*adoc-diff-row-gap[^>]*data-adoc-diff-row-gap="ins"[^>]*><th/,
    )
    assert.doesNotMatch(result.leftHtml, /<\/tbody><thead/)
    assert.match(
      result.rightHtml,
      /<thead[^>]*><tr[^>]*adoc-diff-row-ins[^>]*>[\s\S]*Name/,
    )
  })

  test('removes a header row: the placeholder thead is still before the body', () => {
    const rows = [TABLE_ROWS[0], TABLE_ROWS[1]]
    const left = section('data', 'Data', table({ line: 4, rows }), 1)
    const right = section(
      'data',
      'Data',
      table({ line: 4, header: [], rows }),
      1,
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.removedBlocks, 1)
    assert.match(
      result.leftHtml,
      /<thead[^>]*><tr[^>]*adoc-diff-row-del[^>]*>[\s\S]*Name/,
    )
    assert.match(
      result.rightHtml,
      /<thead[^>]*><tr[^>]*adoc-diff-row-gap[^>]*data-adoc-diff-row-gap="del"[^>]*><th/,
    )
    assert.doesNotMatch(result.rightHtml, /<\/tbody><thead/)
  })

  test('adds a row inside a nested table without a second outer hunk', () => {
    const rows = [
      ['alpha', '1'],
      ['beta', '2'],
    ]
    const result = diff(
      nestedTableDocument(rows),
      nestedTableDocument([...rows, ['gamma', '3']]),
    )
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.visualChanges, 1)
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(result.stats.removedBlocks, 0)
    assert.equal(result.stats.changedCells, 0)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.equal(hunkIds(result.rightHtml).length, 1)
    // The outer cell/table is not a second change region.
    assert.doesNotMatch(result.leftHtml, /adoc-diff-cell-changed/)
    assert.doesNotMatch(result.leftHtml, /<table[^>]*data-adoc-diff-hunk/)
    const hunk = hunkIds(result.leftHtml)[0]
    assert.match(
      result.leftHtml,
      new RegExp(
        `<tr[^>]*adoc-diff-row-gap[^>]*data-adoc-diff-row-gap="ins"[^>]*data-adoc-diff-hunk="${hunk}"`,
      ),
    )
    assert.match(result.rightHtml, /adoc-diff-row-ins[^>]*>[\s\S]*gamma/)
  })

  test('removes and adds rows inside a nested table as two inner hunks', () => {
    const oldRows = [
      ['alpha', '1'],
      ['beta', '2'],
      ['gamma', '3'],
      ['delta', '4'],
    ]
    const newRows = [
      ['alpha', '1'],
      ['gamma', '3'],
      ['delta', '4'],
      ['inserted', '9'],
    ]
    const result = diff(
      nestedTableDocument(oldRows),
      nestedTableDocument(newRows),
    )
    assert.equal(result.stats.changes, 2)
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(result.stats.removedBlocks, 1)
    assert.equal(result.stats.changedCells, 0)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(hunkIds(result.leftHtml).length, 2)
    assert.deepEqual(hunkIds(result.leftHtml), hunkIds(result.rightHtml))
    assert.doesNotMatch(result.leftHtml, /adoc-diff-cell-changed/)
    assert.match(result.leftHtml, /<tr[^>]*adoc-diff-row-del[^>]*>[\s\S]*beta/)
    assert.match(
      result.rightHtml,
      /<tr[^>]*adoc-diff-row-ins[^>]*>[\s\S]*inserted/,
    )
  })

  test('does not add an outer hunk when only the nested table changes', () => {
    const rows = [
      ['alpha', '1'],
      ['beta', '2'],
    ]
    const result = diff(
      nestedTableDocument(rows, 'Static text.'),
      nestedTableDocument([...rows, ['gamma', '3']], 'Static text.'),
    )
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(result.stats.changedCells, 0)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-cell-changed/)
    assert.match(result.rightHtml, /adoc-diff-row-ins[^>]*>[\s\S]*gamma/)
  })

  test('reports a text change and a nested row change separately', () => {
    const rows = [
      ['alpha', '1'],
      ['beta', '2'],
    ]
    const result = diff(
      nestedTableDocument(rows, 'Old text.'),
      nestedTableDocument([...rows, ['gamma', '3']], 'New text.'),
    )
    assert.equal(result.stats.changes, 2)
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(result.stats.changedCells, 1)
    assert.equal(hunkIds(result.leftHtml).length, 2)
    assert.match(result.leftHtml, /adoc-diff-cell-changed/)
    assert.match(result.leftHtml, /adoc-diff-word adoc-diff-word-del/)
    assert.match(
      result.leftHtml,
      /adoc-diff-row-gap[^>]*data-adoc-diff-row-gap="ins"/,
    )
  })

  test('reports a same-count column replacement as one table hunk', () => {
    const widths = ['33%', '33%', '34%']
    const left = section(
      'data',
      'Data',
      table({
        line: 4,
        widths,
        header: ['Name', 'Count', 'Status'],
        rows: [
          ['alpha', '1', 'ready'],
          ['beta', '2', 'draft'],
        ],
      }),
      1,
    )
    const right = section(
      'data',
      'Data',
      table({
        line: 4,
        widths,
        header: ['Name', 'Status', 'Reviewer'],
        rows: [
          ['alpha', 'ready', 'ann'],
          ['beta', 'draft', 'bob'],
        ],
      }),
      1,
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.visualChanges, 1)
    assert.equal(result.stats.nonVisualChanges, 0)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(result.stats.changedCells, 0)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.deepEqual(hunkIds(result.leftHtml), hunkIds(result.rightHtml))
    assert.match(result.leftHtml, /adoc-diff-col-gap/)
    assert.match(result.leftHtml, /adoc-diff-cell-del/)
    assert.match(result.rightHtml, /adoc-diff-cell-ins/)
  })

  test('reports several added and removed columns as one table hunk', () => {
    const oldTable = table({
      line: 4,
      widths: ['33%', '33%', '34%'],
      header: ['A', 'B', 'C'],
      rows: [['a1', 'b1', 'c1']],
    })
    const newTable = table({
      line: 4,
      widths: ['20%', '20%', '20%', '20%', '20%'],
      header: ['X', 'A', 'C', 'Y', 'Z'],
      rows: [['x1', 'a1', 'c1', 'y1', 'z1']],
    })
    const result = diff(
      section('data', 'Data', oldTable, 1),
      section('data', 'Data', newTable, 1),
    )
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.visualChanges, 1)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.match(result.leftHtml, /adoc-diff-col-gap/)
    assert.match(result.leftHtml, /adoc-diff-cell-del/)
    assert.match(result.rightHtml, /adoc-diff-cell-ins/)
  })

  test('adds a column inside a nested table without a second outer hunk', () => {
    const leftInner = table({
      line: 8,
      header: ['Name', 'Count'],
      widths: ['50%', '50%'],
      rows: [
        ['alpha', '1'],
        ['beta', '2'],
      ],
    })
    const rightInner = table({
      line: 8,
      header: ['Name', 'Count', 'Status'],
      widths: ['33%', '33%', '34%'],
      rows: [
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
      ],
    })
    const result = diff(
      section('data', 'Data', nestedTableWithInner(leftInner), 1),
      section('data', 'Data', nestedTableWithInner(rightInner), 1),
    )
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.visualChanges, 1)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(result.stats.changedCells, 0)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.match(result.leftHtml, /adoc-diff-col-gap/)
    assert.match(result.rightHtml, /adoc-diff-cell-ins/)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-cell-changed/)
  })

  test('renders a row and a column added in the same change', () => {
    const oldTable = table({
      line: 4,
      widths: ['50%', '50%'],
      header: ['Name', 'Count'],
      rows: [
        ['alpha', '1'],
        ['beta', '2'],
      ],
    })
    const newTable = table({
      line: 4,
      widths: ['33%', '33%', '34%'],
      header: ['Name', 'Count', 'Status'],
      rows: [
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
        ['gamma', '3', 'new'],
      ],
    })
    const result = diff(
      section('data', 'Data', oldTable, 1),
      section('data', 'Data', newTable, 1),
    )
    assert.equal(result.stats.changes, 2)
    assert.equal(result.stats.visualChanges, 2)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(result.stats.changedCells, 0)
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(hunkIds(result.leftHtml).length, 2)
    assert.match(result.leftHtml, /adoc-diff-col-gap/)
    assert.match(result.leftHtml, /adoc-diff-row-gap/)
    assert.match(result.rightHtml, /adoc-diff-cell-ins/)
    assert.match(result.rightHtml, /adoc-diff-row-ins/)
  })

  test('renders row and column removals and additions together', () => {
    const oldTable = table({
      line: 4,
      widths: ['33%', '33%', '34%'],
      header: ['Name', 'Count', 'Status'],
      rows: [
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
        ['gamma', '3', 'ready'],
        ['delta', '4', 'draft'],
        ['epsilon', '5', 'ready'],
      ],
    })
    const newTable = table({
      line: 4,
      widths: ['25%', '25%', '25%', '25%'],
      header: ['Name', 'Severity', 'Count', 'Status'],
      rows: [
        ['alpha', 'high', '1', 'ready'],
        ['gamma', 'low', '3', 'ready'],
        ['epsilon', 'med', '5', 'ready'],
        ['zero', 'low', '0', 'new'],
      ],
    })
    const result = diff(
      section('data', 'Data', oldTable, 1),
      section('data', 'Data', newTable, 1),
    )
    assert.equal(result.stats.changes, 4)
    assert.equal(result.stats.visualChanges, 4)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(result.stats.changedCells, 0)
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(result.stats.removedBlocks, 2)
    assert.equal(hunkIds(result.leftHtml).length, 4)
    // Two removed rows are red; the appended row is green with a placeholder.
    assert.equal(
      count(result.leftHtml, /<tr[^>]*class="[^"]*\badoc-diff-row-del\b/g),
      2,
    )
    assert.equal(
      count(result.rightHtml, /class="adoc-diff-row-gap adoc-diff-gap-del"/g),
      2,
    )
    assert.match(
      result.leftHtml,
      /adoc-diff-row-gap[^>]*data-adoc-diff-row-gap="ins"/,
    )
    assert.match(result.rightHtml, /adoc-diff-row-ins[^>]*>[\s\S]*zero/)
    // The added column keeps its own table-level marker.
    assert.match(result.leftHtml, /adoc-diff-col-gap/)
    assert.match(result.rightHtml, /adoc-diff-cell-ins/)
  })

  test('keeps a mixed row and column change on the nested table', () => {
    const oldInner = table({
      line: 8,
      widths: ['33%', '33%', '34%'],
      header: ['Name', 'Count', 'Status'],
      rows: [
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
        ['gamma', '3', 'ready'],
        ['delta', '4', 'draft'],
        ['epsilon', '5', 'ready'],
      ],
    })
    const newInner = table({
      line: 8,
      widths: ['25%', '25%', '25%', '25%'],
      header: ['Name', 'Severity', 'Count', 'Status'],
      rows: [
        ['alpha', 'high', '1', 'ready'],
        ['gamma', 'low', '3', 'ready'],
        ['epsilon', 'med', '5', 'ready'],
        ['zero', 'low', '0', 'new'],
      ],
    })
    const result = diff(
      section('data', 'Data', nestedTableWithInner(oldInner), 1),
      section('data', 'Data', nestedTableWithInner(newInner), 1),
    )
    assert.equal(result.stats.changes, 4)
    assert.equal(result.stats.visualChanges, 4)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(result.stats.changedCells, 0)
    assert.equal(hunkIds(result.leftHtml).length, 4)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-cell-changed/)
    assert.match(result.leftHtml, /adoc-diff-col-gap/)
    assert.match(result.leftHtml, /adoc-diff-row-gap/)
    assert.match(result.rightHtml, /adoc-diff-cell-ins/)
    assert.match(result.rightHtml, /adoc-diff-row-ins/)
  })

  test('adds a child to a nested list', () => {
    const left = listDocument(
      listItem('one', ulist(listItem('one.one'))) + listItem('two'),
    )
    const right = listDocument(
      listItem('one', ulist(listItem('one.one') + listItem('one.two'))) +
        listItem('two'),
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(result.stats.removedBlocks, 0)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.match(
      result.rightHtml,
      /<li[^>]*adoc-diff-block-ins[^>]*>[\s\S]*one\.two/,
    )
  })

  test('removes a child from a nested list', () => {
    const left = listDocument(
      listItem('one', ulist(listItem('one.one') + listItem('one.two'))) +
        listItem('two'),
    )
    const right = listDocument(
      listItem('one', ulist(listItem('one.one'))) + listItem('two'),
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.addedBlocks, 0)
    assert.equal(result.stats.removedBlocks, 1)
    assert.match(
      result.leftHtml,
      /<li[^>]*adoc-diff-block-del[^>]*>[\s\S]*one\.two/,
    )
  })

  test('renders a dedented child at both hierarchy levels', () => {
    const left = listDocument(
      listItem('one', ulist(listItem('one.one'))) + listItem('two'),
    )
    const right = listDocument(
      listItem('one') + listItem('one.one') + listItem('two'),
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 2)
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(result.stats.removedBlocks, 1)
    assert.equal(hunkIds(result.leftHtml).length, 2)
    assert.match(result.leftHtml, /adoc-diff-block-del[^>]*>[\s\S]*one\.one/)
    assert.match(result.rightHtml, /adoc-diff-block-ins[^>]*>[\s\S]*one\.one/)
  })

  test('reports a reordered nested list item as moved', () => {
    const left = listDocument(
      listItem('one', ulist(listItem('one.a') + listItem('one.b'))),
    )
    const right = listDocument(
      listItem('one', ulist(listItem('one.b') + listItem('one.a'))),
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.movedBlocks, 1)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.match(result.leftHtml, /adoc-diff-moved/)
    assert.match(result.rightHtml, /adoc-diff-moved/)
  })

  test('adds a child to a list inside a table cell without an outer hunk', () => {
    const left = listInCellDocument(
      ulist(listItem('one', ulist(listItem('one.one')))),
    )
    const right = listInCellDocument(
      ulist(listItem('one', ulist(listItem('one.one') + listItem('one.two')))),
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(result.stats.changedCells, 0)
    assert.equal(result.stats.changedTables, 0)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-cell-changed/)
    assert.match(result.rightHtml, /adoc-diff-block-ins[^>]*>[\s\S]*one\.two/)
  })

  test('keeps a list item text change in a cell on the outer row hunk', () => {
    const left = listInCellDocument(ulist(listItem('one.old')))
    const right = listInCellDocument(ulist(listItem('one.new')))
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.changedCells, 1)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.match(result.leftHtml, /adoc-diff-cell-changed/)
    assert.match(result.leftHtml, /<tr[^>]*data-adoc-diff-hunk=/)
  })

  test('diffs a changed JSON key without replacing the whole line', () => {
    const base = {
      name: 'alpha',
      version: 1,
      enabled: true,
      tags: ['one', 'two'],
    }
    const pretty = JSON.stringify(base, null, 2)
    const left = jsonCode(pretty)
    const right = jsonCode(
      pretty.replace('"name": "alpha"', '"title": "alpha"'),
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.changedBlocks, 1)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.equal(codeLineCount(result.leftHtml, 'changed'), 1)
    assert.equal(codeLineCount(result.rightHtml, 'changed'), 1)
    assert.equal(codeLineCount(result.leftHtml, 'add'), 0)
    assert.equal(codeLineCount(result.rightHtml, 'add'), 0)
    assert.equal(codeLineCount(result.leftHtml, 'del'), 0)
    assert.match(result.leftHtml, /adoc-diff-word-del[^>]*>name</)
    assert.match(result.rightHtml, /adoc-diff-word-ins[^>]*>title</)
  })

  test('diffs a changed JSON value and a minified JSON line', () => {
    const leftObject = { name: 'alpha', version: 1, enabled: true }
    const rightObject = { name: 'alpha', version: 2, enabled: false }
    const prettyLeft = jsonCode(JSON.stringify(leftObject, null, 2))
    const prettyRight = jsonCode(JSON.stringify(rightObject, null, 2))
    const pretty = diff(prettyLeft, prettyRight)
    assert.equal(pretty.stats.changes, 1)
    assert.equal(codeLineCount(pretty.leftHtml, 'changed'), 2)
    assert.equal(codeLineCount(pretty.rightHtml, 'changed'), 2)

    const minified = diff(
      jsonCode(JSON.stringify(leftObject)),
      jsonCode(JSON.stringify(rightObject)),
    )
    assert.equal(minified.stats.changes, 1)
    assert.equal(codeLineCount(minified.leftHtml, 'changed'), 1)
    assert.equal(codeLineCount(minified.rightHtml, 'changed'), 1)
    assert.match(minified.leftHtml, /adoc-diff-word-del[^>]*>1</)
    assert.match(minified.leftHtml, /adoc-diff-word-del[^>]*>true</)
    assert.match(minified.rightHtml, /adoc-diff-word-ins[^>]*>2</)
    assert.match(minified.rightHtml, /adoc-diff-word-ins[^>]*>false</)
  })

  test('shows a JSON string becoming an object as one hunk', () => {
    const left = jsonCode(
      JSON.stringify({ name: 'alpha', config: 'simple' }, null, 2),
    )
    const right = jsonCode(
      JSON.stringify(
        { name: 'alpha', config: { nested: true, mode: 'advanced' } },
        null,
        2,
      ),
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.visualChanges, 1)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.equal(codeLineCount(result.leftHtml, 'changed'), 1)
    assert.equal(codeGapCount(result.leftHtml, 'add'), 3)
    assert.equal(codeLineCount(result.rightHtml, 'add'), 3)
    assert.match(result.leftHtml, /adoc-diff-word-del[^>]*>"simple"</)
    assert.match(result.rightHtml, /adoc-diff-word-ins[^>]*>\{</)
  })

  test('shows a JSON object becoming a string as one hunk', () => {
    const left = jsonCode(
      JSON.stringify(
        { name: 'alpha', config: { nested: true, mode: 'advanced' } },
        null,
        2,
      ),
    )
    const right = jsonCode(
      JSON.stringify({ name: 'alpha', config: 'simple' }, null, 2),
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.equal(codeLineCount(result.leftHtml, 'del'), 3)
    assert.equal(codeGapCount(result.rightHtml, 'del'), 3)
  })

  test('shows a new JSON object in an array as added lines', () => {
    const base = { items: [{ id: 1, name: 'first' }] }
    const left = jsonCode(JSON.stringify(base, null, 2))
    const right = jsonCode(
      JSON.stringify(
        {
          items: [
            ...base.items,
            { id: 2, name: 'second', meta: { active: true } },
          ],
        },
        null,
        2,
      ),
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.visualChanges, 1)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.equal(codeLineCount(result.leftHtml, 'add'), 0)
    assert.equal(codeLineCount(result.rightHtml, 'add'), 7)
    assert.equal(codeGapCount(result.leftHtml, 'add'), 7)
  })

  test('keeps a long paragraph paired when one sentence is added', () => {
    const long =
      'The service reads the configuration file, validates every option, applies the defaults, and then starts the worker process. '
    const left = paragraph(2, `${long}It keeps running.`)
    const right = paragraph(
      2,
      `${long}It keeps running. It also reports its status every minute.`,
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.visualChanges, 1)
    assert.equal(result.stats.changedBlocks, 1)
    assert.equal(result.stats.addedBlocks, 0)
    assert.equal(result.stats.removedBlocks, 0)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-block-del/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-block-ins/)
    assert.match(
      result.rightHtml,
      /adoc-diff-word-ins[^>]*>It also reports its status every minute\.</,
    )
  })

  test('replaces an unrelated long paragraph as a whole block', () => {
    const left = paragraph(
      2,
      'The service reads the configuration file, validates every option, applies the defaults, and then starts the worker process. It keeps running and reports its status.',
    )
    const right = paragraph(
      2,
      'A completely different paragraph about the weather, the garden, and weekend plans. It shares almost none of the service configuration words.',
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(result.stats.removedBlocks, 1)
    assert.equal(result.stats.changedBlocks, 0)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-word/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-word/)
  })

  test('removes and appends a row in the same table: both placeholders appear', () => {
    const rightRows = [
      TABLE_ROWS[0],
      TABLE_ROWS[2],
      TABLE_ROWS[3],
      ['inserted', '9', 'new', 'eve'],
    ]
    const result = diff(tableDocument(TABLE_ROWS), tableDocument(rightRows))
    assert.equal(result.stats.changes, 2)
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(result.stats.removedBlocks, 1)
    assert.equal(result.stats.changedCells, 0)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(hunkIds(result.leftHtml).length, 2)
    assert.deepEqual(hunkIds(result.leftHtml), hunkIds(result.rightHtml))
    // The removed beta row is red on the old side; the new side has its gap.
    assert.match(result.leftHtml, /<tr[^>]*adoc-diff-row-del[^>]*>[\s\S]*beta/)
    assert.match(
      result.rightHtml,
      /<tr[^>]*adoc-diff-row-gap[^>]*data-adoc-diff-row-gap="del"/,
    )
    // The appended inserted row is green on the new side; the old side has its gap.
    assert.match(
      result.leftHtml,
      /<tr[^>]*adoc-diff-row-gap[^>]*data-adoc-diff-row-gap="ins"/,
    )
    assert.match(
      result.rightHtml,
      /<tr[^>]*adoc-diff-row-ins[^>]*>[\s\S]*inserted/,
    )
  })

  test('swaps a mixed add/remove table: red and green exchange sides', () => {
    const oldRows = [
      TABLE_ROWS[0],
      TABLE_ROWS[2],
      TABLE_ROWS[3],
      ['inserted', '9', 'new', 'eve'],
    ]
    const result = diff(tableDocument(oldRows), tableDocument(TABLE_ROWS))
    assert.equal(result.stats.changes, 2)
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(result.stats.removedBlocks, 1)
    assert.match(
      result.leftHtml,
      /<tr[^>]*adoc-diff-row-del[^>]*>[\s\S]*inserted/,
    )
    assert.match(result.rightHtml, /<tr[^>]*adoc-diff-row-ins[^>]*>[\s\S]*beta/)
    // The placeholders follow the rows: beta is reserved on the left, inserted
    // on the right.
    assert.match(
      result.leftHtml,
      /<tr[^>]*adoc-diff-row-gap[^>]*data-adoc-diff-row-gap="ins"/,
    )
    assert.match(
      result.rightHtml,
      /<tr[^>]*adoc-diff-row-gap[^>]*data-adoc-diff-row-gap="del"/,
    )
  })

  test('handles several added and removed rows in one table', () => {
    const epsilon = ['epsilon', '5', 'ready', 'eve']
    const oldRows = [...TABLE_ROWS, epsilon]
    const newRows = [
      ['inserted', '9', 'new', 'ian'],
      TABLE_ROWS[0],
      TABLE_ROWS[2],
      epsilon,
      ['zeta', '6', 'new', 'zoe'],
    ]
    const result = diff(tableDocument(oldRows), tableDocument(newRows))
    assert.equal(result.stats.changes, 4)
    assert.equal(result.stats.addedBlocks, 2)
    assert.equal(result.stats.removedBlocks, 2)
    assert.equal(result.stats.changedCells, 0)
    assert.equal(hunkIds(result.leftHtml).length, 4)
    assert.equal(
      count(result.leftHtml, /<tr[^>]*class="[^"]*\badoc-diff-row-del\b/g),
      2,
    )
    assert.equal(
      count(
        result.leftHtml,
        /<tr[^>]*class="[^"]*\badoc-diff-row-gap\b[^"]*\badoc-diff-gap-ins\b/g,
      ),
      2,
    )
    assert.equal(
      count(result.rightHtml, /<tr[^>]*class="[^"]*\badoc-diff-row-ins\b/g),
      2,
    )
    assert.equal(
      count(
        result.rightHtml,
        /<tr[^>]*class="[^"]*\badoc-diff-row-gap\b[^"]*\badoc-diff-gap-del\b/g,
      ),
      2,
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

  test('adds a whole section with mixed content as one hunk', () => {
    const a = section('a', 'Section A', paragraph(2, 'Text A.'), 1)
    const b = section('b', 'Section B', paragraph(8, 'Text B.'), 7)
    const added = section(
      'new',
      'New section',
      [
        paragraph(3, 'Paragraph with some text.'),
        ulist(listItem('one') + listItem('two')),
        table({
          line: 7,
          rows: [
            ['A', 'B'],
            ['1', '2'],
          ],
        }),
        code(['{"x": 1}'], 14),
      ].join(''),
      2,
    )
    const result = diff(a + b, a + added + b)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.visualChanges, 1)
    assert.equal(result.stats.addedBlocks, 1)
    assert.equal(result.stats.removedBlocks, 0)
    assert.equal(result.stats.changedBlocks, 0)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.match(
      result.rightHtml,
      /<div class="sect1[^>]*adoc-diff-block-ins[^>]*>[\s\S]*New section/,
    )
  })

  test('removes a whole section as one collapsed hunk', () => {
    const a = section('a', 'Section A', paragraph(2, 'Text A.'), 1)
    const b = section('b', 'Section B', paragraph(8, 'Text B.'), 7)
    const removed = section(
      'old',
      'Old section',
      [
        paragraph(3, 'First paragraph.'),
        paragraph(5, 'Second paragraph.'),
        paragraph(7, 'Third paragraph.'),
      ].join(''),
      2,
    )
    const result = diff(a + removed + b, a + b)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.addedBlocks, 0)
    assert.equal(result.stats.removedBlocks, 1)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.match(
      result.leftHtml,
      /<div class="sect1[^>]*adoc-diff-block-del[^>]*adoc-diff-collapsed/,
    )
    assert.match(result.rightHtml, /data-adoc-diff-gap="del"/)
    assert.match(result.rightHtml, /data-adoc-diff-gap-object="lines"/)
  })

  test('renames a section heading without replacing the section', () => {
    const left = section('a', 'Section A', paragraph(2, 'Text A.'), 1)
    const right = section('a', 'Section A renamed', paragraph(2, 'Text A.'), 1)
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.changedBlocks, 1)
    assert.equal(result.stats.addedBlocks, 0)
    assert.equal(result.stats.removedBlocks, 0)
    assert.equal(hunkIds(result.leftHtml).length, 1)
    assert.match(result.leftHtml, /adoc-diff-block-changed[^>]*>Section/)
    // Only the new title word is a word-level insertion; the old title has no
    // deleted word, so the left heading gets the change icon instead.
    assert.match(result.rightHtml, /adoc-diff-word-ins[^>]*>renamed</)
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

  test('marks a changed PlantUML data URI as changed media', () => {
    const left = image(
      'data:text/vnd.plantuml;base64,QUxpY2UgLT4gQm9iOiBvbGQ=',
      'Diagram',
      5,
    )
    const right = image(
      'data:text/vnd.plantuml;base64,QUxpY2UgLT4gQm9iOiBuZXc=',
      'Diagram',
      5,
    )
    const result = diff(left, right)
    assert.equal(result.stats.changes, 1)
    assert.equal(result.stats.changedBlocks, 1)
    assert.match(result.leftHtml, /adoc-diff-media-changed/)
    assert.match(result.rightHtml, /adoc-diff-media-changed/)
    assert.match(
      result.leftHtml,
      /<div class="content[^"]*"[^>]*data-adoc-diff-media-changed/,
    )
    assert.match(result.leftHtml, /data-adoc-diff-icon/)
    // The diagram source is an image resource: the kernel has no text nodes to
    // word-diff, so only the media marker/icon marks the change.
    assert.doesNotMatch(result.leftHtml, /adoc-diff-word/)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-code-line/)
  })
})
