const imageOne = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#3b82f6"/><text x="10" y="45" fill="white">one</text></svg>`
const imageTwo = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#10b981"/><text x="10" y="45" fill="white">two</text></svg>`

export const hostFiles = {
  '/docs/images/one.svg': Buffer.from(imageOne),
  '/docs/images/two.svg': Buffer.from(imageTwo),
}

const header = `= Manual
:toc: left
:imagesdir: images
:data-uri:
:source-highlighter: highlight.js
`

function doc(body, extraHeader = '') {
  return `${header}${extraHeader}\n${body}\n`
}

function sections(count, mutate = () => '') {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1
    return `== Section ${n}\n\nParagraph ${n} with some words about topic ${n}.\n\n* item ${n}.1\n* item ${n}.2\n\n[source,json]\n----\n{"section": ${n}, "ok": true}\n----\n${mutate(n)}`
  }).join('\n')
}

/** A one-table document body; rows are arrays of cell values. */
function tableBlock(bodyRows, options = '') {
  return `== Data

[cols="1,1,1"${options}]
|===
|Name |Count |Status

${bodyRows.map((cells) => `|${cells.join(' |')}`).join('\n')}
|===
`
}

/** A table without a header row, for header-added/removed scenarios. */
function tableBodyOnly(bodyRows) {
  return `== Data

[cols="1,1,1"]
|===
${bodyRows.map((cells) => `|${cells.join(' |')}`).join('\n')}
|===
`
}

/**
 * A two-column outer table whose content cell holds an inner table. Asciidoctor
 * requires a different delimiter for a nested table, hence `!===` and `!`.
 */
function nestedTableBlock(innerRows, text = '') {
  return `== Data

[cols="1,2"]
|===
|Kind |Content

a|
* note
a|
${text === '' ? '' : `${text}\n\n`}[cols="1,1"]
!===
!Name !Value

${innerRows.map((cells) => `!${cells.join(' !')}`).join('\n')}
!===
|===
`
}

/** A table with a header, parameterised by column specs, for column diffs. */
function tableColumns(cols, rows, options = '') {
  return `== Data

[%header,cols="${cols}"${options}]
|===
${rows.map((cells) => `|${cells.join(' |')}`).join('\n')}
|===
`
}

/** The same table nested in the content cell of an outer table. */
function nestedTableColumns(cols, rows) {
  return `== Data

[cols="1,2"]
|===
|Kind |Content

a|
* note
a|
[%header,cols="${cols}"]
!===
${rows.map((cells) => `!${cells.join(' !')}`).join('\n')}
!===
|===
`
}

const richSectionBody = `Paragraph with some text.

* one
* two

[cols="1,1"]
|===
|A |B
|1 |2
|===

[source,json]
----
{"x": 1}
----`

/** A section; sections are joined with a blank line. */
function section(title, body, level = 2) {
  return `${'='.repeat(level)} ${title}\n\n${body}`
}

/** A document without the TOC, so adding a section does not also change it. */
function plainSectionDoc(...sections) {
  return doc(sections.join('\n\n'), ':toc!:\n')
}

/** A document with the TOC, for the navigation-change scenario. */
function tocSectionDoc(...sections) {
  return doc(sections.join('\n\n'))
}

/** A plain-text document body. */
function textBlock(body) {
  return `== Text

${body}
`
}

const longText =
  'The service reads the configuration file, validates every option, applies the defaults, and then starts the worker process. '

/** A list document body. */
function listBlock(lines) {
  return `== Lists

${lines.join('\n')}
`
}

/** A list inside the content cell of an outer table. */
function listInCell(lines) {
  return `== Data

[cols="1,2"]
|===
|Kind |Items

a|
* note
a|
${lines.join('\n')}
|===
`
}

const jsonBase = {
  name: 'alpha',
  version: 1,
  enabled: true,
  description:
    'A long description of the service that takes some space in the JSON object.',
  tags: ['one', 'two', 'three'],
  settings: { theme: 'dark', retries: 3, nested: { level: 1, active: true } },
  items: [
    { id: 1, name: 'first' },
    { id: 2, name: 'second' },
  ],
}
const jsonPretty = JSON.stringify(jsonBase, null, 2)
const jsonMinified = JSON.stringify(jsonBase)
const jsonStringConfig = JSON.stringify({ ...jsonBase, config: 'simple' }, null, 2)
const jsonObjectConfig = JSON.stringify(
  { ...jsonBase, config: { nested: true, mode: 'advanced' } },
  null,
  2,
)
const jsonMinifiedStringConfig = JSON.stringify({ ...jsonBase, config: 'simple' })
const jsonMinifiedObjectConfig = JSON.stringify({
  ...jsonBase,
  config: { nested: true, mode: 'advanced' },
})
const jsonArrayWithObject = JSON.stringify(
  {
    ...jsonBase,
    items: [
      ...jsonBase.items,
      { id: 3, name: 'third', meta: { active: true } },
    ],
  },
  null,
  2,
)

/** A JSON source block. */
function jsonBlock(text) {
  return `== JSON

[source,json]
----
${text}
----
`
}

export const scenarios = [
  {
    name: 'identical-rich',
    old: doc(`
== Overview

Hello *world* and _AsciiDoc_.

* one
* two

[cols="1,1"]
|===
|A |B
|1 |2
|===

[source,json]
----
{"a": 1, "b": 2}
----

image::one.svg[Diagram, 200]
`),
    new: doc(`
== Overview

Hello *world* and _AsciiDoc_.

* one
* two

[cols="1,1"]
|===
|A |B
|1 |2
|===

[source,json]
----
{"a": 1, "b": 2}
----

image::one.svg[Diagram, 200]
`),
  },
  {
    name: 'unrelated-documents',
    old: doc(`
== Old overview

Old prose about alpha with *bold* text and a link to https://example.com/old[old site].

== Old list

* alpha
* beta
* gamma

[source,ruby]
----
puts "old"
----
`),
    new: doc(`
== New introduction

Completely different prose about omega and _emphasis_.

|===
|Key |Value
|new |42
|===

image::two.svg[New diagram, 160]
`),
  },
  {
    name: 'sections-reordered',
    old: doc(sections(5)),
    new: doc(
      [3, 1, 5, 2, 4]
        .map((n) =>
          `== Section ${n}\n\nParagraph ${n} with some words about topic ${n}.\n\n* item ${n}.1\n* item ${n}.2\n\n[source,json]\n----\n{"section": ${n}, "ok": true}\n----\n`,
        )
        .join('\n'),
    ),
  },
  {
    name: 'table-cardinal',
    old: doc(`
== Data

[cols="1,1,1"]
|===
|Name |Count |Status

|alpha |1 |ready
|beta |2 |draft
|gamma |3 |ready
|===
`),
    new: doc(`
== Data

[cols="1,1,1,1,1"]
|===
|Name |Count |Severity |Status |Owner

|alpha |1 |high |ready |ann
|beta |2 |medium |ready |bob
|gamma |3 |low |published |carl
|epsilon |5 |high |new |eve
|===
`),
  },
  {
    name: 'table-cell-middle',
    old: doc(`
== Data

[cols="1,1,1,1"]
|===
|Name |Count |Status |Owner

|alpha |1 |ready |ann
|beta |2 |ready |bob
|gamma |3 |draft |carl
|delta |4 |ready |dina
|===
`),
    new: doc(`
== Data

[cols="1,1,1,1"]
|===
|Name |Count |Status |Owner

|alpha |1 |ready |ann
|beta |2 |ready |bob
|gamma |3 |published |carl
|delta |4 |ready |dina
|===
`),
  },
  {
    name: 'table-row-append',
    // 5 rendered rows become 6: the last row is appended. The old side keeps a
    // neutral placeholder; the new side highlights the added row in green.
    style: 'vscode',
    old: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
      ]),
    ),
    new: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
        ['epsilon', '5', 'new'],
      ]),
    ),
    tableChecks: {
      counts: { left: 6, right: 6 },
      markers: {
        left: [{ index: 5, kind: 'gap-ins', tint: 'gray', text: '' }],
        right: [
          { index: 5, kind: 'row-ins', tint: 'green', text: 'epsilon|5|new' },
        ],
      },
    },
  },
  {
    name: 'table-row-append-swap',
    // The same pair after the Swap button: the 6-row document is on the left,
    // so its extra last row is red and the 5-row document gets the gray gap.
    style: 'vscode',
    old: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
        ['epsilon', '5', 'new'],
      ]),
    ),
    new: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
      ]),
    ),
    tableChecks: {
      counts: { left: 6, right: 6 },
      markers: {
        left: [
          { index: 5, kind: 'row-del', tint: 'red', text: 'epsilon|5|new' },
        ],
        right: [{ index: 5, kind: 'gap-del', tint: 'gray', text: '' }],
      },
    },
  },
  {
    name: 'table-row-append-striped',
    // The same append on a table with six body rows: the added row lands on an
    // even (zebra-striped) row, where the preview's striping used to hide the
    // green highlight.
    style: 'vscode',
    old: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
        ['epsilon', '5', 'ready'],
      ]),
    ),
    new: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
        ['epsilon', '5', 'ready'],
        ['zeta', '6', 'new'],
      ]),
    ),
    tableChecks: {
      counts: { left: 7, right: 7 },
      markers: {
        left: [{ index: 6, kind: 'gap-ins', tint: 'gray', text: '' }],
        right: [
          { index: 6, kind: 'row-ins', tint: 'green', text: 'zeta|6|new' },
        ],
      },
    },
  },
  {
    name: 'table-row-append-striped-swap',
    // Swap of the striped append: the removed row is now the even (striped)
    // last row on the left, where the zebra striping used to hide the red.
    style: 'vscode',
    old: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
        ['epsilon', '5', 'ready'],
        ['zeta', '6', 'new'],
      ]),
    ),
    new: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
        ['epsilon', '5', 'ready'],
      ]),
    ),
    tableChecks: {
      counts: { left: 7, right: 7 },
      markers: {
        left: [
          { index: 6, kind: 'row-del', tint: 'red', text: 'zeta|6|new' },
        ],
        right: [{ index: 6, kind: 'gap-del', tint: 'gray', text: '' }],
      },
    },
  },
  {
    name: 'table-row-prepend',
    style: 'vscode',
    old: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
      ]),
    ),
    new: doc(
      tableBlock([
        ['zero', '0', 'new'],
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
      ]),
    ),
    tableChecks: {
      counts: { left: 6, right: 6 },
      markers: {
        left: [{ index: 1, kind: 'gap-ins', tint: 'gray', text: '' }],
        right: [
          { index: 1, kind: 'row-ins', tint: 'green', text: 'zero|0|new' },
        ],
      },
    },
  },
  {
    name: 'table-row-prepend-swap',
    style: 'vscode',
    old: doc(
      tableBlock([
        ['zero', '0', 'new'],
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
      ]),
    ),
    new: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
      ]),
    ),
    tableChecks: {
      counts: { left: 6, right: 6 },
      markers: {
        left: [{ index: 1, kind: 'row-del', tint: 'red', text: 'zero|0|new' }],
        right: [{ index: 1, kind: 'gap-del', tint: 'gray', text: '' }],
      },
    },
  },
  {
    name: 'table-column-append',
    // A column is added at the end: the old table gets a gray column gap, the
    // new table gets a green column, including its header and footer cells.
    style: 'vscode',
    old: doc(
      tableColumns('1,1', [
        ['Name', 'Count'],
        ['alpha', '1'],
        ['beta', '2'],
      ]),
    ),
    new: doc(
      tableColumns('1,1,1', [
        ['Name', 'Count', 'Status'],
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
      ]),
    ),
    columnChecks: {
      table: 0,
      counts: { left: 3, right: 3 },
      cells: {
        left: [
          { row: 0, column: 2, kind: 'gap-ins', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 2, kind: 'gap-ins', tint: 'gray', tag: 'td', text: '' },
        ],
        right: [
          {
            row: 0,
            column: 2,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'th',
            text: 'Status',
          },
          {
            row: 1,
            column: 2,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'td',
            text: 'ready',
          },
        ],
      },
    },
  },
  {
    name: 'table-column-prepend',
    style: 'vscode',
    old: doc(
      tableColumns('1,1', [
        ['Name', 'Count'],
        ['alpha', '1'],
        ['beta', '2'],
      ]),
    ),
    new: doc(
      tableColumns('1,1,1', [
        ['Owner', 'Name', 'Count'],
        ['ann', 'alpha', '1'],
        ['bob', 'beta', '2'],
      ]),
    ),
    columnChecks: {
      table: 0,
      counts: { left: 3, right: 3 },
      cells: {
        left: [
          { row: 0, column: 0, kind: 'gap-ins', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 0, kind: 'gap-ins', tint: 'gray', tag: 'td', text: '' },
        ],
        right: [
          {
            row: 0,
            column: 0,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'th',
            text: 'Owner',
          },
          {
            row: 1,
            column: 0,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'td',
            text: 'ann',
          },
        ],
      },
    },
  },
  {
    name: 'table-column-middle',
    style: 'vscode',
    old: doc(
      tableColumns('1,1,1', [
        ['Name', 'Count', 'Status'],
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
      ]),
    ),
    new: doc(
      tableColumns('1,1,1,1', [
        ['Name', 'Severity', 'Count', 'Status'],
        ['alpha', 'high', '1', 'ready'],
        ['beta', 'low', '2', 'draft'],
      ]),
    ),
    columnChecks: {
      table: 0,
      counts: { left: 4, right: 4 },
      cells: {
        left: [
          { row: 0, column: 1, kind: 'gap-ins', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 1, kind: 'gap-ins', tint: 'gray', tag: 'td', text: '' },
        ],
        right: [
          {
            row: 0,
            column: 1,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'th',
            text: 'Severity',
          },
          {
            row: 1,
            column: 1,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'td',
            text: 'high',
          },
        ],
      },
    },
  },
  {
    name: 'table-column-remove-end',
    // The swap of `table-column-append`: the removed column is red on the old
    // side and gray on the new side.
    style: 'vscode',
    old: doc(
      tableColumns('1,1,1', [
        ['Name', 'Count', 'Status'],
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
      ]),
    ),
    new: doc(
      tableColumns('1,1', [
        ['Name', 'Count'],
        ['alpha', '1'],
        ['beta', '2'],
      ]),
    ),
    columnChecks: {
      table: 0,
      counts: { left: 3, right: 3 },
      cells: {
        left: [
          {
            row: 0,
            column: 2,
            kind: 'cell-del',
            tint: 'red',
            tag: 'th',
            text: 'Status',
          },
          {
            row: 1,
            column: 2,
            kind: 'cell-del',
            tint: 'red',
            tag: 'td',
            text: 'ready',
          },
        ],
        right: [
          { row: 0, column: 2, kind: 'gap-del', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 2, kind: 'gap-del', tint: 'gray', tag: 'td', text: '' },
        ],
      },
    },
  },
  {
    name: 'table-column-add-remove',
    // A middle column is removed and a new column is appended: the column
    // count stays the same, but the structure still owns one table hunk.
    style: 'vscode',
    old: doc(
      tableColumns('1,1,1', [
        ['Name', 'Count', 'Status'],
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
      ]),
    ),
    new: doc(
      tableColumns('1,1,1', [
        ['Name', 'Status', 'Owner'],
        ['alpha', 'ready', 'ann'],
        ['beta', 'draft', 'bob'],
      ]),
    ),
    columnChecks: {
      table: 0,
      counts: { left: 4, right: 4 },
      cells: {
        left: [
          {
            row: 0,
            column: 1,
            kind: 'cell-del',
            tint: 'red',
            tag: 'th',
            text: 'Count',
          },
          {
            row: 1,
            column: 1,
            kind: 'cell-del',
            tint: 'red',
            tag: 'td',
            text: '1',
          },
          { row: 0, column: 3, kind: 'gap-ins', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 3, kind: 'gap-ins', tint: 'gray', tag: 'td', text: '' },
        ],
        right: [
          { row: 0, column: 1, kind: 'gap-del', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 1, kind: 'gap-del', tint: 'gray', tag: 'td', text: '' },
          {
            row: 0,
            column: 3,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'th',
            text: 'Owner',
          },
          {
            row: 1,
            column: 3,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'td',
            text: 'ann',
          },
        ],
      },
    },
  },
  {
    name: 'table-column-add-remove-swap',
    // Swap of `table-column-add-remove`: the added and removed columns change
    // sides and keep their hunk.
    style: 'vscode',
    old: doc(
      tableColumns('1,1,1', [
        ['Name', 'Status', 'Owner'],
        ['alpha', 'ready', 'ann'],
        ['beta', 'draft', 'bob'],
      ]),
    ),
    new: doc(
      tableColumns('1,1,1', [
        ['Name', 'Count', 'Status'],
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
      ]),
    ),
    columnChecks: {
      table: 0,
      counts: { left: 4, right: 4 },
      cells: {
        left: [
          { row: 0, column: 1, kind: 'gap-ins', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 1, kind: 'gap-ins', tint: 'gray', tag: 'td', text: '' },
          {
            row: 0,
            column: 3,
            kind: 'cell-del',
            tint: 'red',
            tag: 'th',
            text: 'Owner',
          },
          {
            row: 1,
            column: 3,
            kind: 'cell-del',
            tint: 'red',
            tag: 'td',
            text: 'ann',
          },
        ],
        right: [
          {
            row: 0,
            column: 1,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'th',
            text: 'Count',
          },
          {
            row: 1,
            column: 1,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'td',
            text: '1',
          },
          { row: 0, column: 3, kind: 'gap-del', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 3, kind: 'gap-del', tint: 'gray', tag: 'td', text: '' },
        ],
      },
    },
  },
  {
    name: 'table-column-append-footer',
    // The header and footer cells must be shaded too, not keep the preview's
    // own header/footer fill.
    style: 'vscode',
    old: doc(
      tableColumns(
        '1,1',
        [
          ['Name', 'Count'],
          ['alpha', '1'],
          ['total', '3'],
        ],
        ',options="footer"',
      ),
    ),
    new: doc(
      tableColumns(
        '1,1,1',
        [
          ['Name', 'Count', 'Status'],
          ['alpha', '1', 'ready'],
          ['total', '3', '3'],
        ],
        ',options="footer"',
      ),
    ),
    columnChecks: {
      table: 0,
      counts: { left: 3, right: 3 },
      cells: {
        left: [
          { row: 0, column: 2, kind: 'gap-ins', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 2, kind: 'gap-ins', tint: 'gray', tag: 'td', text: '' },
          { row: 2, column: 2, kind: 'gap-ins', tint: 'gray', tag: 'td', text: '' },
        ],
        right: [
          {
            row: 0,
            column: 2,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'th',
            text: 'Status',
          },
          {
            row: 1,
            column: 2,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'td',
            text: 'ready',
          },
          {
            row: 2,
            column: 2,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'td',
            text: '3',
          },
        ],
      },
    },
  },
  {
    name: 'nested-table-column-append',
    style: 'vscode',
    old: doc(
      nestedTableColumns('1,1', [
        ['Name', 'Count'],
        ['alpha', '1'],
        ['beta', '2'],
      ]),
    ),
    new: doc(
      nestedTableColumns('1,1,1', [
        ['Name', 'Count', 'Status'],
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
      ]),
    ),
    columnChecks: {
      table: 1,
      counts: { left: 3, right: 3 },
      cells: {
        left: [
          { row: 0, column: 2, kind: 'gap-ins', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 2, kind: 'gap-ins', tint: 'gray', tag: 'td', text: '' },
        ],
        right: [
          {
            row: 0,
            column: 2,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'th',
            text: 'Status',
          },
          {
            row: 1,
            column: 2,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'td',
            text: 'ready',
          },
        ],
      },
    },
  },
  {
    name: 'nested-table-column-remove',
    style: 'vscode',
    old: doc(
      nestedTableColumns('1,1,1', [
        ['Name', 'Count', 'Status'],
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
      ]),
    ),
    new: doc(
      nestedTableColumns('1,1', [
        ['Name', 'Count'],
        ['alpha', '1'],
        ['beta', '2'],
      ]),
    ),
    columnChecks: {
      table: 1,
      counts: { left: 3, right: 3 },
      cells: {
        left: [
          {
            row: 0,
            column: 2,
            kind: 'cell-del',
            tint: 'red',
            tag: 'th',
            text: 'Status',
          },
          {
            row: 1,
            column: 2,
            kind: 'cell-del',
            tint: 'red',
            tag: 'td',
            text: 'ready',
          },
        ],
        right: [
          { row: 0, column: 2, kind: 'gap-del', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 2, kind: 'gap-del', tint: 'gray', tag: 'td', text: '' },
        ],
      },
    },
  },
  {
    name: 'nested-table-column-add-remove',
    style: 'vscode',
    old: doc(
      nestedTableColumns('1,1,1', [
        ['Name', 'Count', 'Status'],
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
      ]),
    ),
    new: doc(
      nestedTableColumns('1,1,1', [
        ['Name', 'Status', 'Owner'],
        ['alpha', 'ready', 'ann'],
        ['beta', 'draft', 'bob'],
      ]),
    ),
    columnChecks: {
      table: 1,
      counts: { left: 4, right: 4 },
      cells: {
        left: [
          {
            row: 0,
            column: 1,
            kind: 'cell-del',
            tint: 'red',
            tag: 'th',
            text: 'Count',
          },
          { row: 0, column: 3, kind: 'gap-ins', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 3, kind: 'gap-ins', tint: 'gray', tag: 'td', text: '' },
        ],
        right: [
          { row: 0, column: 1, kind: 'gap-del', tint: 'gray', tag: 'th', text: '' },
          {
            row: 0,
            column: 3,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'th',
            text: 'Owner',
          },
          {
            row: 1,
            column: 3,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'td',
            text: 'ann',
          },
        ],
      },
    },
  },
  {
    name: 'table-mixed-add-end',
    // A row and a column are added at the end in the same change.
    style: 'vscode',
    old: doc(
      tableColumns('1,1', [
        ['Name', 'Count'],
        ['alpha', '1'],
        ['beta', '2'],
      ]),
    ),
    new: doc(
      tableColumns('1,1,1', [
        ['Name', 'Count', 'Status'],
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
        ['gamma', '3', 'new'],
      ]),
    ),
    tableChecks: {
      counts: { left: 4, right: 4 },
      markers: {
        left: [{ index: 3, kind: 'gap-ins', tint: 'gray', text: '' }],
        right: [
          { index: 3, kind: 'row-ins', tint: 'green', text: 'gamma|3|new' },
        ],
      },
    },
    columnChecks: {
      table: 0,
      counts: { left: 3, right: 3 },
      cells: {
        left: [
          { row: 0, column: 2, kind: 'gap-ins', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 2, kind: 'gap-ins', tint: 'gray', tag: 'td', text: '' },
        ],
        right: [
          {
            row: 0,
            column: 2,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'th',
            text: 'Status',
          },
          {
            row: 1,
            column: 2,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'td',
            text: 'ready',
          },
        ],
      },
    },
  },
  {
    name: 'table-mixed-remove-end',
    // The swap of `table-mixed-add-end`: a row and a column are removed.
    style: 'vscode',
    old: doc(
      tableColumns('1,1,1', [
        ['Name', 'Count', 'Status'],
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
        ['gamma', '3', 'new'],
      ]),
    ),
    new: doc(
      tableColumns('1,1', [
        ['Name', 'Count'],
        ['alpha', '1'],
        ['beta', '2'],
      ]),
    ),
    tableChecks: {
      counts: { left: 4, right: 4 },
      markers: {
        left: [
          { index: 3, kind: 'row-del', tint: 'red', text: 'gamma|3|new' },
        ],
        right: [{ index: 3, kind: 'gap-del', tint: 'gray', text: '' }],
      },
    },
    columnChecks: {
      table: 0,
      counts: { left: 3, right: 3 },
      cells: {
        left: [
          {
            row: 0,
            column: 2,
            kind: 'cell-del',
            tint: 'red',
            tag: 'th',
            text: 'Status',
          },
          {
            row: 1,
            column: 2,
            kind: 'cell-del',
            tint: 'red',
            tag: 'td',
            text: 'ready',
          },
        ],
        right: [
          { row: 0, column: 2, kind: 'gap-del', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 2, kind: 'gap-del', tint: 'gray', tag: 'td', text: '' },
        ],
      },
    },
  },
  {
    name: 'table-mixed-top-start',
    // A row is added at the top and a column at the start.
    style: 'vscode',
    old: doc(
      tableColumns('1,1', [
        ['Name', 'Count'],
        ['alpha', '1'],
        ['beta', '2'],
      ]),
    ),
    new: doc(
      tableColumns('1,1,1', [
        ['Owner', 'Name', 'Count'],
        ['zoe', 'zero', '0'],
        ['ann', 'alpha', '1'],
        ['bob', 'beta', '2'],
      ]),
    ),
    tableChecks: {
      counts: { left: 4, right: 4 },
      markers: {
        left: [{ index: 1, kind: 'gap-ins', tint: 'gray', text: '' }],
        right: [
          { index: 1, kind: 'row-ins', tint: 'green', text: 'zoe|zero|0' },
        ],
      },
    },
    columnChecks: {
      table: 0,
      counts: { left: 3, right: 3 },
      cells: {
        left: [
          { row: 0, column: 0, kind: 'gap-ins', tint: 'gray', tag: 'th', text: '' },
          { row: 2, column: 0, kind: 'gap-ins', tint: 'gray', tag: 'td', text: '' },
        ],
        right: [
          {
            row: 0,
            column: 0,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'th',
            text: 'Owner',
          },
          {
            row: 1,
            column: 0,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'td',
            text: 'zoe',
          },
        ],
      },
    },
  },
  {
    name: 'table-mixed-add-col-remove-rows-add-row',
    // A column is added while two rows are removed and one row is appended.
    style: 'vscode',
    old: doc(
      tableColumns('1,1,1', [
        ['Name', 'Count', 'Status'],
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
        ['gamma', '3', 'ready'],
        ['delta', '4', 'draft'],
        ['epsilon', '5', 'ready'],
      ]),
    ),
    new: doc(
      tableColumns('1,1,1,1', [
        ['Name', 'Severity', 'Count', 'Status'],
        ['alpha', 'high', '1', 'ready'],
        ['gamma', 'low', '3', 'ready'],
        ['epsilon', 'med', '5', 'ready'],
        ['zero', 'low', '0', 'new'],
      ]),
    ),
    tableChecks: {
      counts: { left: 7, right: 7 },
      markers: {
        left: [
          { index: 2, kind: 'row-del', tint: 'red', text: 'beta||2|draft' },
          { index: 4, kind: 'row-del', tint: 'red', text: 'delta||4|draft' },
          { index: 6, kind: 'gap-ins', tint: 'gray', text: '' },
        ],
        right: [
          { index: 2, kind: 'gap-del', tint: 'gray', text: '' },
          { index: 4, kind: 'gap-del', tint: 'gray', text: '' },
          {
            index: 6,
            kind: 'row-ins',
            tint: 'green',
            text: 'zero|low|0|new',
          },
        ],
      },
    },
    columnChecks: {
      table: 0,
      counts: { left: 4, right: 4 },
      cells: {
        left: [
          { row: 0, column: 1, kind: 'gap-ins', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 1, kind: 'gap-ins', tint: 'gray', tag: 'td', text: '' },
        ],
        right: [
          {
            row: 0,
            column: 1,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'th',
            text: 'Severity',
          },
          {
            row: 1,
            column: 1,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'td',
            text: 'high',
          },
        ],
      },
    },
  },
  {
    name: 'table-mixed-add-remove-cols-rows',
    // One column is removed, two are added; two rows are removed and one is
    // appended. The table hunk and each row hunk stay separate.
    style: 'vscode',
    old: doc(
      tableColumns('1,1,1', [
        ['Name', 'Count', 'Status'],
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
        ['gamma', '3', 'ready'],
        ['delta', '4', 'draft'],
        ['epsilon', '5', 'ready'],
      ]),
    ),
    new: doc(
      tableColumns('1,1,1,1', [
        ['Owner', 'Name', 'Status', 'Reviewer'],
        ['zoe', 'alpha', 'ready', 'ann'],
        ['bob', 'gamma', 'ready', 'eve'],
        ['ian', 'epsilon', 'ready', 'joe'],
        ['kim', 'zero', 'new', 'lee'],
      ]),
    ),
    tableChecks: {
      counts: { left: 7, right: 7 },
      markers: {
        left: [
          { index: 2, kind: 'row-del', tint: 'red', text: '|beta|2|draft|' },
          { index: 4, kind: 'row-del', tint: 'red', text: '|delta|4|draft|' },
          { index: 6, kind: 'gap-ins', tint: 'gray', text: '' },
        ],
        right: [
          { index: 2, kind: 'gap-del', tint: 'gray', text: '' },
          { index: 4, kind: 'gap-del', tint: 'gray', text: '' },
          {
            index: 6,
            kind: 'row-ins',
            tint: 'green',
            text: 'kim|zero||new|lee',
          },
        ],
      },
    },
    columnChecks: {
      table: 0,
      counts: { left: 5, right: 5 },
      cells: {
        left: [
          { row: 0, column: 0, kind: 'gap-ins', tint: 'gray', tag: 'th', text: '' },
          {
            row: 0,
            column: 2,
            kind: 'cell-del',
            tint: 'red',
            tag: 'th',
            text: 'Count',
          },
          { row: 0, column: 4, kind: 'gap-ins', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 0, kind: 'gap-ins', tint: 'gray', tag: 'td', text: '' },
          {
            row: 1,
            column: 2,
            kind: 'cell-del',
            tint: 'red',
            tag: 'td',
            text: '1',
          },
          { row: 1, column: 4, kind: 'gap-ins', tint: 'gray', tag: 'td', text: '' },
        ],
        right: [
          {
            row: 0,
            column: 0,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'th',
            text: 'Owner',
          },
          { row: 0, column: 2, kind: 'gap-del', tint: 'gray', tag: 'th', text: '' },
          {
            row: 0,
            column: 4,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'th',
            text: 'Reviewer',
          },
          {
            row: 1,
            column: 0,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'td',
            text: 'zoe',
          },
          { row: 1, column: 2, kind: 'gap-del', tint: 'gray', tag: 'td', text: '' },
          {
            row: 1,
            column: 4,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'td',
            text: 'ann',
          },
        ],
      },
    },
  },
  {
    name: 'table-mixed-nested',
    // The same simultaneous row/column change inside a nested table. The outer
    // table must stay untouched and the inner table owns the table hunk.
    style: 'vscode',
    old: doc(
      nestedTableColumns('1,1,1', [
        ['Name', 'Count', 'Status'],
        ['alpha', '1', 'ready'],
        ['beta', '2', 'draft'],
        ['gamma', '3', 'ready'],
        ['delta', '4', 'draft'],
        ['epsilon', '5', 'ready'],
      ]),
    ),
    new: doc(
      nestedTableColumns('1,1,1,1', [
        ['Name', 'Severity', 'Count', 'Status'],
        ['alpha', 'high', '1', 'ready'],
        ['gamma', 'low', '3', 'ready'],
        ['epsilon', 'med', '5', 'ready'],
        ['zero', 'low', '0', 'new'],
      ]),
    ),
    tableChecks: {
      table: 1,
      counts: { left: 7, right: 7 },
      markers: {
        left: [
          { index: 2, kind: 'row-del', tint: 'red', text: 'beta||2|draft' },
          { index: 4, kind: 'row-del', tint: 'red', text: 'delta||4|draft' },
          { index: 6, kind: 'gap-ins', tint: 'gray', text: '' },
        ],
        right: [
          { index: 2, kind: 'gap-del', tint: 'gray', text: '' },
          { index: 4, kind: 'gap-del', tint: 'gray', text: '' },
          {
            index: 6,
            kind: 'row-ins',
            tint: 'green',
            text: 'zero|low|0|new',
          },
        ],
      },
    },
    columnChecks: {
      table: 1,
      counts: { left: 4, right: 4 },
      cells: {
        left: [
          { row: 0, column: 1, kind: 'gap-ins', tint: 'gray', tag: 'th', text: '' },
          { row: 1, column: 1, kind: 'gap-ins', tint: 'gray', tag: 'td', text: '' },
        ],
        right: [
          {
            row: 0,
            column: 1,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'th',
            text: 'Severity',
          },
          {
            row: 1,
            column: 1,
            kind: 'cell-ins',
            tint: 'green',
            tag: 'td',
            text: 'high',
          },
        ],
      },
    },
  },
  {
    name: 'nested-list-add-child',
    style: 'vscode',
    old: doc(listBlock(['* one', '** one.one', '* two'])),
    new: doc(listBlock(['* one', '** one.one', '** one.two', '* two'])),
    listChecks: {
      cellChanged: false,
      items: {
        right: [
          { text: 'one.two', kind: 'ins', tint: 'green', depth: 2 },
        ],
      },
    },
  },
  {
    name: 'nested-list-add-child-first',
    style: 'vscode',
    old: doc(listBlock(['* one', '** one.one', '* two'])),
    new: doc(listBlock(['* one', '** one.zero', '** one.one', '* two'])),
    listChecks: {
      cellChanged: false,
      items: {
        right: [
          { text: 'one.zero', kind: 'ins', tint: 'green', depth: 2 },
        ],
      },
    },
  },
  {
    name: 'nested-list-remove-child',
    style: 'vscode',
    old: doc(listBlock(['* one', '** one.one', '** one.two', '* two'])),
    new: doc(listBlock(['* one', '** one.one', '* two'])),
    listChecks: {
      cellChanged: false,
      items: {
        left: [
          { text: 'one.two', kind: 'del', tint: 'red', depth: 2 },
        ],
      },
    },
  },
  {
    name: 'nested-list-grandchild',
    style: 'vscode',
    old: doc(listBlock(['* one', '** one.one', '* two'])),
    new: doc(listBlock(['* one', '** one.one', '*** one.one.deep', '* two'])),
    listChecks: {
      cellChanged: false,
      items: {
        right: [
          { text: 'one.one.deep', kind: 'ins', tint: 'green', depth: 3 },
        ],
      },
    },
  },
  {
    name: 'nested-list-dedent',
    // A child becomes a top-level item: one removal at the old level and one
    // addition at the new level.
    style: 'vscode',
    old: doc(listBlock(['* one', '** one.one', '* two'])),
    new: doc(listBlock(['* one', '* one.one', '* two'])),
    listChecks: {
      cellChanged: false,
      items: {
        left: [{ text: 'one.one', kind: 'del', tint: 'red', depth: 2 }],
        right: [{ text: 'one.one', kind: 'ins', tint: 'green', depth: 1 }],
      },
    },
  },
  {
    name: 'nested-list-mixed',
    style: 'vscode',
    old: doc(
      listBlock([
        '* one',
        '** one.one',
        '** one.two',
        '* two',
        '** two.one',
      ]),
    ),
    new: doc(
      listBlock([
        '* one',
        '** one.two',
        '** one.three',
        '* two',
        '** two.two',
      ]),
    ),
    listChecks: {
      cellChanged: false,
      items: {
        left: [
          { text: 'one.one', kind: 'del', tint: 'red', depth: 2 },
          { text: 'two.one', kind: 'changed', depth: 2 },
        ],
        right: [
          { text: 'one.three', kind: 'ins', tint: 'green', depth: 2 },
          { text: 'two.two', kind: 'changed', depth: 2 },
        ],
      },
    },
  },
  {
    name: 'nested-list-ordered-add',
    style: 'vscode',
    old: doc(listBlock(['. one', '.. one.one', '. two'])),
    new: doc(listBlock(['. one', '.. one.one', '.. one.two', '. two'])),
    listChecks: {
      cellChanged: false,
      items: {
        right: [
          { text: 'one.two', kind: 'ins', tint: 'green', depth: 2 },
        ],
      },
    },
  },
  {
    name: 'nested-list-in-cell-add-child',
    // A list inside a table cell owns its own hunk; the outer cell must not add
    // a second one.
    style: 'vscode',
    old: doc(listInCell(['* one', '** one.one'])),
    new: doc(listInCell(['* one', '** one.one', '** one.two'])),
    listChecks: {
      cellChanged: false,
      items: {
        right: [
          { text: 'one.two', kind: 'ins', tint: 'green', depth: 2 },
        ],
      },
    },
  },
  {
    name: 'nested-list-in-cell-text-change',
    // A text change in a list item has no inner hunk, so the outer cell still
    // owns the hunk.
    style: 'vscode',
    old: doc(listInCell(['* one.old'])),
    new: doc(listInCell(['* one.new'])),
    listChecks: {
      cellChanged: true,
    },
  },
  {
    name: 'nested-dlist-add-child',
    style: 'vscode',
    old: doc(
      listBlock([
        'term one:: definition one',
        'term two::',
        '** nested a',
        '** nested b',
      ]),
    ),
    new: doc(
      listBlock([
        'term one:: definition one',
        'term two::',
        '** nested a',
        '** nested b',
        '** nested c',
      ]),
    ),
    listChecks: {
      cellChanged: false,
      items: {
        right: [
          { text: 'nested c', kind: 'ins', tint: 'green', depth: 1 },
        ],
      },
    },
  },
  {
    name: 'json-pretty-key-change',
    style: 'vscode',
    old: doc(jsonBlock(jsonPretty)),
    new: doc(
      jsonBlock(jsonPretty.replace('"name": "alpha"', '"title": "alpha"')),
    ),
    codeChecks: {
      left: { changed: 1, add: 0, del: 0, gap: 0, wordsDel: 1, wordsIns: 0 },
      right: { changed: 1, add: 0, del: 0, gap: 0, wordsDel: 0, wordsIns: 1 },
    },
  },
  {
    name: 'json-pretty-value-change',
    style: 'vscode',
    old: doc(jsonBlock(jsonPretty)),
    new: doc(jsonBlock(jsonPretty.replace('"version": 1', '"version": 2'))),
    codeChecks: {
      left: { changed: 1, add: 0, del: 0, gap: 0, wordsDel: 1, wordsIns: 0 },
      right: { changed: 1, add: 0, del: 0, gap: 0, wordsDel: 0, wordsIns: 1 },
    },
  },
  {
    name: 'json-pretty-key-value-change',
    style: 'vscode',
    old: doc(jsonBlock(jsonPretty)),
    new: doc(
      jsonBlock(
        jsonPretty
          .replace('"name": "alpha"', '"title": "omega"')
          .replace('"version": 1', '"version": 2'),
      ),
    ),
    codeChecks: {
      left: { changed: 2, add: 0, del: 0, gap: 0, wordsDel: 3, wordsIns: 0 },
      right: { changed: 2, add: 0, del: 0, gap: 0, wordsDel: 0, wordsIns: 3 },
    },
  },
  {
    name: 'json-string-to-object',
    style: 'vscode',
    old: doc(jsonBlock(jsonStringConfig)),
    new: doc(jsonBlock(jsonObjectConfig)),
    codeChecks: {
      left: { changed: 1, add: 0, del: 0, gap: 3, wordsDel: 1, wordsIns: 0 },
      right: { changed: 1, add: 3, del: 0, gap: 0, wordsDel: 0, wordsIns: 1 },
    },
  },
  {
    name: 'json-object-to-string',
    style: 'vscode',
    old: doc(jsonBlock(jsonObjectConfig)),
    new: doc(jsonBlock(jsonStringConfig)),
    codeChecks: {
      left: { changed: 1, add: 0, del: 3, gap: 0, wordsDel: 1, wordsIns: 0 },
      right: { changed: 1, add: 0, del: 0, gap: 3, wordsDel: 0, wordsIns: 1 },
    },
  },
  {
    name: 'json-minified-key-change',
    style: 'vscode',
    old: doc(jsonBlock(jsonMinified)),
    new: doc(
      jsonBlock(
        jsonMinified.replace('"name":"alpha"', '"title":"alpha"'),
      ),
    ),
    codeChecks: {
      left: { changed: 1, add: 0, del: 0, gap: 0, wordsDel: 1, wordsIns: 0 },
      right: { changed: 1, add: 0, del: 0, gap: 0, wordsDel: 0, wordsIns: 1 },
    },
  },
  {
    name: 'json-minified-key-value-change',
    style: 'vscode',
    old: doc(jsonBlock(jsonMinified)),
    new: doc(
      jsonBlock(
        jsonMinified
          .replace('"name":"alpha"', '"title":"omega"')
          .replace('"version":1', '"version":2'),
      ),
    ),
    codeChecks: {
      left: { changed: 1, add: 0, del: 0, gap: 0, wordsDel: 3, wordsIns: 0 },
      right: { changed: 1, add: 0, del: 0, gap: 0, wordsDel: 0, wordsIns: 3 },
    },
  },
  {
    name: 'json-minified-string-to-object',
    style: 'vscode',
    old: doc(jsonBlock(jsonMinifiedStringConfig)),
    new: doc(jsonBlock(jsonMinifiedObjectConfig)),
    codeChecks: {
      left: { changed: 1, add: 0, del: 0, gap: 0, wordsDel: 1, wordsIns: 0 },
      right: { changed: 1, add: 0, del: 0, gap: 0, wordsDel: 0, wordsIns: 4 },
    },
  },
  {
    name: 'json-array-object-add',
    style: 'vscode',
    old: doc(jsonBlock(jsonPretty)),
    new: doc(jsonBlock(jsonArrayWithObject)),
    codeChecks: {
      left: { changed: 0, add: 0, del: 0, gap: 7, wordsDel: 0, wordsIns: 0 },
      right: { changed: 0, add: 7, del: 0, gap: 0, wordsDel: 0, wordsIns: 0 },
    },
  },
  {
    name: 'text-word-change',
    style: 'vscode',
    old: doc(textBlock('The quick brown fox jumps over the lazy dog.')),
    new: doc(textBlock('The quick red fox jumps over the lazy dog.')),
    textChecks: {
      stats: { changes: 1, visualChanges: 1, changedBlocks: 1 },
      left: { del: ['brown'], ins: [] },
      right: { del: [], ins: ['red'] },
    },
  },
  {
    name: 'text-insert-word',
    style: 'vscode',
    old: doc(textBlock('The quick fox jumps over the lazy dog.')),
    new: doc(textBlock('The quick brown fox jumps over the lazy dog.')),
    textChecks: {
      stats: { changes: 1, visualChanges: 1, changedBlocks: 1 },
      left: { del: [], ins: [] },
      right: { del: [], ins: ['brown'] },
    },
  },
  {
    name: 'text-long-insert-sentence',
    // A long paragraph stays paired: the added sentence is a word marker, not
    // a whole-block removal plus addition.
    style: 'vscode',
    old: doc(textBlock(`${longText}It keeps running.`)),
    new: doc(
      textBlock(
        `${longText}It keeps running. It also reports its status every minute.`,
      ),
    ),
    textChecks: {
      stats: {
        changes: 1,
        visualChanges: 1,
        changedBlocks: 1,
        addedBlocks: 0,
        removedBlocks: 0,
      },
      left: { del: [], ins: [] },
      right: { del: [], ins: ['It also reports its status every minute.'] },
    },
  },
  {
    name: 'text-long-delete-sentence',
    style: 'vscode',
    old: doc(
      textBlock(
        `${longText}It keeps running. It also reports its status every minute.`,
      ),
    ),
    new: doc(textBlock(`${longText}It keeps running.`)),
    textChecks: {
      stats: {
        changes: 1,
        visualChanges: 1,
        changedBlocks: 1,
        addedBlocks: 0,
        removedBlocks: 0,
      },
      left: { del: ['It also reports its status every minute.'], ins: [] },
      right: { del: [], ins: [] },
    },
  },
  {
    name: 'text-multiple-changes',
    style: 'vscode',
    old: doc(textBlock('The quick brown fox jumps over the lazy dog.')),
    new: doc(textBlock('The very red fox leaps over a lazy cat.')),
    textChecks: {
      stats: { changes: 1, visualChanges: 1, changedBlocks: 1 },
      left: {
        del: ['quick brown', 'jumps', 'the', 'dog'],
        ins: [],
      },
      right: {
        del: [],
        ins: ['very red', 'leaps', 'a', 'cat'],
      },
    },
  },
  {
    name: 'text-punctuation-change',
    style: 'vscode',
    old: doc(textBlock('Hello, world!')),
    new: doc(textBlock('Hello; world?')),
    textChecks: {
      stats: { changes: 1, visualChanges: 1, changedBlocks: 1 },
      left: { del: [',', '!'], ins: [] },
      right: { del: [], ins: [';', '?'] },
    },
  },
  {
    name: 'text-whitespace-only',
    // A source line break inside a paragraph is not a rendered change.
    style: 'vscode',
    old: doc(textBlock('Hello world\nand more text.')),
    new: doc(textBlock('Hello world and more text.')),
    textChecks: {
      noChanges: true,
      stats: { changes: 0, visualChanges: 0, nonVisualChanges: 0 },
      left: { del: [], ins: [] },
      right: { del: [], ins: [] },
    },
  },
  {
    name: 'text-paragraph-add',
    style: 'vscode',
    old: doc(textBlock('First paragraph.')),
    new: doc(textBlock('First paragraph.\n\nSecond paragraph.')),
    textChecks: {
      stats: {
        changes: 1,
        visualChanges: 1,
        changedBlocks: 0,
        addedBlocks: 1,
        removedBlocks: 0,
      },
      left: { del: [], ins: [] },
      right: { del: [], ins: [] },
    },
  },
  {
    name: 'text-paragraph-split',
    style: 'vscode',
    old: doc(textBlock('First sentence. Second sentence.')),
    new: doc(textBlock('First sentence.\n\nSecond sentence.')),
    textChecks: {
      stats: {
        changes: 2,
        visualChanges: 2,
        changedBlocks: 1,
        addedBlocks: 1,
      },
      left: { del: ['Second sentence.'], ins: [] },
      right: { del: [], ins: [] },
    },
  },
  {
    name: 'text-formatting-only',
    style: 'vscode',
    old: doc(textBlock('This is *bold* text.')),
    new: doc(textBlock('This is _bold_ text.')),
    textChecks: {
      stats: {
        changes: 1,
        visualChanges: 0,
        nonVisualChanges: 1,
        formattingChanges: 1,
      },
      // Both tag names change (`strong` -> `em`), so each side gets a badge.
      nonVisualKinds: ['formatting', 'formatting'],
      left: { del: [], ins: [] },
      right: { del: [], ins: [] },
    },
  },
  {
    name: 'text-hard-break',
    style: 'vscode',
    old: doc(textBlock('First line +\nsecond line.')),
    new: doc(textBlock('First line +\nsecond line changed.')),
    textChecks: {
      stats: { changes: 1, visualChanges: 1, changedBlocks: 1 },
      left: { del: [], ins: [] },
      right: { del: [], ins: ['changed'] },
    },
  },
  {
    name: 'text-inline-code-change',
    style: 'vscode',
    old: doc(textBlock('Run `alpha` now.')),
    new: doc(textBlock('Run `beta` now.')),
    textChecks: {
      stats: { changes: 1, visualChanges: 1, changedBlocks: 1 },
      left: { del: ['alpha'], ins: [] },
      right: { del: [], ins: ['beta'] },
    },
  },
  {
    name: 'section-add-top',
    style: 'vscode',
    old: plainSectionDoc(
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
    ),
    new: plainSectionDoc(
      section('New section', richSectionBody),
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
    ),
    sectionChecks: {
      stats: {
        changes: 1,
        visualChanges: 1,
        addedBlocks: 1,
        removedBlocks: 0,
      },
      left: [
        { title: 'Section A', gap: 'ins', gapCount: 1 },
      ],
      right: [
        { title: 'New section', kind: 'ins', depth: 1 },
      ],
    },
  },
  {
    name: 'section-add-middle',
    style: 'vscode',
    old: plainSectionDoc(
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
    ),
    new: plainSectionDoc(
      section('Section A', 'Text A.'),
      section('New section', richSectionBody),
      section('Section B', 'Text B.'),
    ),
    sectionChecks: {
      stats: {
        changes: 1,
        visualChanges: 1,
        addedBlocks: 1,
        removedBlocks: 0,
      },
      left: [
        { title: 'Section B', gap: 'ins', gapCount: 1 },
      ],
      right: [
        { title: 'New section', kind: 'ins', depth: 1 },
      ],
    },
  },
  {
    name: 'section-add-end',
    style: 'vscode',
    old: plainSectionDoc(
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
    ),
    new: plainSectionDoc(
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
      section('New section', richSectionBody),
    ),
    sectionChecks: {
      stats: {
        changes: 1,
        visualChanges: 1,
        addedBlocks: 1,
        removedBlocks: 0,
      },
      left: [
        { title: 'Section B', gap: 'ins', gapCount: 1 },
      ],
      right: [
        { title: 'New section', kind: 'ins', depth: 1 },
      ],
    },
  },
  {
    name: 'section-remove-top',
    style: 'vscode',
    old: plainSectionDoc(
      section('New section', richSectionBody),
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
    ),
    new: plainSectionDoc(
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
    ),
    sectionChecks: {
      stats: {
        changes: 1,
        visualChanges: 1,
        addedBlocks: 0,
        removedBlocks: 1,
      },
      left: [
        {
          title: 'New section',
          kind: 'del',
          depth: 1,
          collapsed: true,
          collapseLines: 15,
        },
      ],
      right: [
        {
          title: 'Section A',
          gap: 'del',
          gapCount: 15,
          gapObject: 'lines',
        },
      ],
    },
  },
  {
    name: 'section-remove-middle',
    style: 'vscode',
    old: plainSectionDoc(
      section('Section A', 'Text A.'),
      section('New section', richSectionBody),
      section('Section B', 'Text B.'),
    ),
    new: plainSectionDoc(
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
    ),
    sectionChecks: {
      stats: {
        changes: 1,
        visualChanges: 1,
        addedBlocks: 0,
        removedBlocks: 1,
      },
      left: [
        {
          title: 'New section',
          kind: 'del',
          depth: 1,
          collapsed: true,
          collapseLines: 15,
        },
      ],
      right: [
        {
          title: 'Section B',
          gap: 'del',
          gapCount: 15,
          gapObject: 'lines',
        },
      ],
    },
  },
  {
    name: 'section-remove-end',
    style: 'vscode',
    old: plainSectionDoc(
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
      section('New section', richSectionBody),
    ),
    new: plainSectionDoc(
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
    ),
    sectionChecks: {
      stats: {
        changes: 1,
        visualChanges: 1,
        addedBlocks: 0,
        removedBlocks: 1,
      },
      left: [
        {
          title: 'New section',
          kind: 'del',
          depth: 1,
          collapsed: true,
          collapseLines: 15,
        },
      ],
      right: [
        {
          title: 'Section B',
          gap: 'del',
          gapCount: 15,
          gapObject: 'lines',
        },
      ],
    },
  },
  {
    name: 'section-add-nested-child',
    style: 'vscode',
    old: plainSectionDoc(
      section(
        'Parent',
        `Parent text.\n\n${section('Child', 'Child text.', 3)}`,
      ),
    ),
    new: plainSectionDoc(
      section(
        'Parent',
        `Parent text.\n\n${section('Child', 'Child text.', 3)}\n\n${section('Child two', 'Child two text.', 3)}`,
      ),
    ),
    sectionChecks: {
      stats: { changes: 1, visualChanges: 1, addedBlocks: 1 },
      right: [
        { title: 'Child two', kind: 'ins', depth: 2 },
      ],
    },
  },
  {
    name: 'section-remove-nested-child',
    style: 'vscode',
    old: plainSectionDoc(
      section(
        'Parent',
        `Parent text.\n\n${section('Child', 'Child text.', 3)}\n\n${section('Child two', 'Child two text.', 3)}`,
      ),
    ),
    new: plainSectionDoc(
      section(
        'Parent',
        `Parent text.\n\n${section('Child', 'Child text.', 3)}`,
      ),
    ),
    sectionChecks: {
      stats: { changes: 1, visualChanges: 1, removedBlocks: 1 },
      left: [
        { title: 'Child two', kind: 'del', depth: 2 },
      ],
    },
  },
  {
    name: 'section-rename',
    style: 'vscode',
    old: plainSectionDoc(
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
    ),
    new: plainSectionDoc(
      section('Section A renamed', 'Text A.'),
      section('Section B', 'Text B.'),
    ),
    sectionChecks: {
      stats: { changes: 1, visualChanges: 1, changedBlocks: 1 },
      right: [
        {
          title: 'Section A renamed',
          headingChanged: true,
          depth: 1,
        },
      ],
    },
  },
  {
    name: 'section-reorder',
    style: 'vscode',
    old: plainSectionDoc(
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
      section('Section C', 'Text C.'),
    ),
    new: plainSectionDoc(
      section('Section C', 'Text C.'),
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
    ),
    sectionChecks: {
      stats: { changes: 1, visualChanges: 1, movedBlocks: 1 },
      left: [{ title: 'Section C', kind: 'moved', depth: 1 }],
      right: [{ title: 'Section C', kind: 'moved', depth: 1 }],
    },
  },
  {
    name: 'section-duplicate-title',
    style: 'vscode',
    old: plainSectionDoc(
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
    ),
    new: plainSectionDoc(
      section('Section A', richSectionBody),
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
    ),
    sectionChecks: {
      stats: { changes: 1, visualChanges: 1, addedBlocks: 1 },
      right: [{ title: 'Section A', kind: 'ins', depth: 1 }],
    },
  },
  {
    name: 'section-toc-add',
    style: 'vscode',
    old: tocSectionDoc(
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
    ),
    new: tocSectionDoc(
      section('New section', richSectionBody),
      section('Section A', 'Text A.'),
      section('Section B', 'Text B.'),
    ),
    sectionChecks: {
      stats: {
        changes: 1,
        visualChanges: 1,
        addedBlocks: 1,
        navigationChanges: 1,
      },
      right: [{ title: 'New section', kind: 'ins', depth: 1 }],
    },
  },
  {
    name: 'table-row-add-header',
    // A header row is added at the top. The old side has no thead, so the
    // placeholder must create one before the body, not after it.
    style: 'vscode',
    old: doc(
      tableBodyOnly([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
      ]),
    ),
    new: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
      ]),
    ),
    tableChecks: {
      counts: { left: 3, right: 3 },
      markers: {
        left: [
          { index: 0, kind: 'gap-ins', tint: 'gray', text: '', section: 'thead' },
        ],
        right: [
          {
            index: 0,
            kind: 'row-ins',
            tint: 'green',
            text: 'Name|Count|Status',
            section: 'thead',
          },
        ],
      },
    },
  },
  {
    name: 'table-row-remove-header',
    style: 'vscode',
    old: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
      ]),
    ),
    new: doc(
      tableBodyOnly([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
      ]),
    ),
    tableChecks: {
      counts: { left: 3, right: 3 },
      markers: {
        left: [
          {
            index: 0,
            kind: 'row-del',
            tint: 'red',
            text: 'Name|Count|Status',
            section: 'thead',
          },
        ],
        right: [
          { index: 0, kind: 'gap-del', tint: 'gray', text: '', section: 'thead' },
        ],
      },
    },
  },
  {
    name: 'table-row-middle',
    // The inserted row is the fourth body row, i.e. a zebra-striped row in the
    // default editor style: the highlight must win over the stripe.
    style: 'vscode',
    old: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
      ]),
    ),
    new: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['inserted', '9', 'new'],
        ['delta', '4', 'ready'],
      ]),
    ),
    tableChecks: {
      counts: { left: 6, right: 6 },
      markers: {
        left: [{ index: 4, kind: 'gap-ins', tint: 'gray', text: '' }],
        right: [
          {
            index: 4,
            kind: 'row-ins',
            tint: 'green',
            text: 'inserted|9|new',
          },
        ],
      },
    },
  },
  {
    name: 'table-row-add-remove',
    // Both directions in one table: beta is removed and inserted is appended.
    // Each side gets the neutral placeholder where the other side has content.
    style: 'vscode',
    old: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
      ]),
    ),
    new: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
        ['inserted', '9', 'new'],
      ]),
    ),
    tableChecks: {
      counts: { left: 6, right: 6 },
      markers: {
        left: [
          { index: 2, kind: 'row-del', tint: 'red', text: 'beta|2|ready' },
          { index: 5, kind: 'gap-ins', tint: 'gray', text: '' },
        ],
        right: [
          { index: 2, kind: 'gap-del', tint: 'gray', text: '' },
          {
            index: 5,
            kind: 'row-ins',
            tint: 'green',
            text: 'inserted|9|new',
          },
        ],
      },
    },
  },
  {
    name: 'table-row-add-remove-tall',
    // Same mixed change, but the removed row is taller than the others: the
    // placeholder on the new side must take exactly that height.
    style: 'vscode',
    old: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        [
          'beta',
          '2',
          'A long status text that wraps over several lines in a narrow table column, making this row taller than the others.',
        ],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
      ]),
    ),
    new: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
        ['inserted', '9', 'new'],
      ]),
    ),
    tableChecks: {
      counts: { left: 6, right: 6 },
      markers: {
        left: [
          { index: 2, kind: 'row-del', tint: 'red' },
          { index: 5, kind: 'gap-ins', tint: 'gray', text: '' },
        ],
        right: [
          { index: 2, kind: 'gap-del', tint: 'gray', text: '' },
          {
            index: 5,
            kind: 'row-ins',
            tint: 'green',
            text: 'inserted|9|new',
          },
        ],
      },
    },
  },
  {
    name: 'table-row-insert-before-footer',
    // A row inserted just before a footer row: the placeholder belongs to the
    // tbody, before the tfoot, not inside the footer.
    style: 'vscode',
    old: doc(
      tableBlock(
        [
          ['alpha', '1', 'ready'],
          ['beta', '2', 'ready'],
          ['delta', '4', 'ready'],
        ],
        ',options="footer"',
      ),
    ),
    new: doc(
      tableBlock(
        [
          ['alpha', '1', 'ready'],
          ['beta', '2', 'ready'],
          ['inserted', '9', 'new'],
          ['delta', '4', 'ready'],
        ],
        ',options="footer"',
      ),
    ),
    tableChecks: {
      counts: { left: 5, right: 5 },
      markers: {
        left: [
          { index: 3, kind: 'gap-ins', tint: 'gray', text: '', section: 'tbody' },
        ],
        right: [
          {
            index: 3,
            kind: 'row-ins',
            tint: 'green',
            text: 'inserted|9|new',
            section: 'tbody',
          },
        ],
      },
    },
  },
  {
    name: 'nested-table-row-append',
    // The outer table is stable; the row is added to the inner table.
    style: 'vscode',
    old: doc(nestedTableBlock([
      ['alpha', '1'],
      ['beta', '2'],
    ])),
    new: doc(nestedTableBlock([
      ['alpha', '1'],
      ['beta', '2'],
      ['gamma', '3'],
    ])),
    tableChecks: {
      table: 1,
      counts: { left: 4, right: 4 },
      markers: {
        left: [{ index: 3, kind: 'gap-ins', tint: 'gray', text: '' }],
        right: [
          { index: 3, kind: 'row-ins', tint: 'green', text: 'gamma|3' },
        ],
      },
    },
  },
  {
    name: 'nested-table-row-prepend',
    style: 'vscode',
    old: doc(nestedTableBlock([
      ['alpha', '1'],
      ['beta', '2'],
    ])),
    new: doc(nestedTableBlock([
      ['zero', '0'],
      ['alpha', '1'],
      ['beta', '2'],
    ])),
    tableChecks: {
      table: 1,
      counts: { left: 4, right: 4 },
      markers: {
        left: [{ index: 1, kind: 'gap-ins', tint: 'gray', text: '' }],
        right: [{ index: 1, kind: 'row-ins', tint: 'green', text: 'zero|0' }],
      },
    },
  },
  {
    name: 'nested-table-row-middle',
    style: 'vscode',
    old: doc(nestedTableBlock([
      ['alpha', '1'],
      ['beta', '2'],
    ])),
    new: doc(nestedTableBlock([
      ['alpha', '1'],
      ['inserted', '9'],
      ['beta', '2'],
    ])),
    tableChecks: {
      table: 1,
      counts: { left: 4, right: 4 },
      markers: {
        left: [{ index: 2, kind: 'gap-ins', tint: 'gray', text: '' }],
        right: [
          { index: 2, kind: 'row-ins', tint: 'green', text: 'inserted|9' },
        ],
      },
    },
  },
  {
    name: 'nested-table-row-add-remove',
    // Additions and removals in the inner table: only the inner table owns the
    // hunks; the outer cell must not be marked as changed a second time.
    style: 'vscode',
    old: doc(nestedTableBlock([
      ['alpha', '1'],
      ['beta', '2'],
      ['gamma', '3'],
      ['delta', '4'],
    ])),
    new: doc(nestedTableBlock([
      ['alpha', '1'],
      ['gamma', '3'],
      ['delta', '4'],
      ['inserted', '9'],
    ])),
    tableChecks: {
      table: 1,
      counts: { left: 6, right: 6 },
      markers: {
        left: [
          { index: 2, kind: 'row-del', tint: 'red', text: 'beta|2' },
          { index: 5, kind: 'gap-ins', tint: 'gray', text: '' },
        ],
        right: [
          { index: 2, kind: 'gap-del', tint: 'gray', text: '' },
          { index: 5, kind: 'row-ins', tint: 'green', text: 'inserted|9' },
        ],
      },
    },
  },
  {
    name: 'nested-table-row-add-remove-swap',
    style: 'vscode',
    old: doc(nestedTableBlock([
      ['alpha', '1'],
      ['gamma', '3'],
      ['delta', '4'],
      ['inserted', '9'],
    ])),
    new: doc(nestedTableBlock([
      ['alpha', '1'],
      ['beta', '2'],
      ['gamma', '3'],
      ['delta', '4'],
    ])),
    tableChecks: {
      table: 1,
      counts: { left: 6, right: 6 },
      markers: {
        left: [
          { index: 2, kind: 'gap-ins', tint: 'gray', text: '' },
          { index: 5, kind: 'row-del', tint: 'red', text: 'inserted|9' },
        ],
        right: [
          { index: 2, kind: 'row-ins', tint: 'green', text: 'beta|2' },
          { index: 5, kind: 'gap-del', tint: 'gray', text: '' },
        ],
      },
    },
  },
  {
    name: 'nested-table-row-append-with-text',
    // The same inner change with unchanged text next to the nested table: the
    // cell still must not add an outer hunk, so the status stays 1 / 1.
    style: 'vscode',
    old: doc(nestedTableBlock(
      [
        ['alpha', '1'],
        ['beta', '2'],
      ],
      'Static text.',
    )),
    new: doc(nestedTableBlock(
      [
        ['alpha', '1'],
        ['beta', '2'],
        ['gamma', '3'],
      ],
      'Static text.',
    )),
    tableChecks: {
      table: 1,
      counts: { left: 4, right: 4 },
      markers: {
        left: [{ index: 3, kind: 'gap-ins', tint: 'gray', text: '' }],
        right: [
          { index: 3, kind: 'row-ins', tint: 'green', text: 'gamma|3' },
        ],
      },
    },
  },
  {
    name: 'table-row-add-remove-swap',
    // Swap of `table-row-add-remove`: red and green exchange sides and the
    // placeholders follow them.
    style: 'vscode',
    old: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
        ['inserted', '9', 'new'],
      ]),
    ),
    new: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
      ]),
    ),
    tableChecks: {
      counts: { left: 6, right: 6 },
      markers: {
        left: [
          { index: 2, kind: 'gap-ins', tint: 'gray', text: '' },
          {
            index: 5,
            kind: 'row-del',
            tint: 'red',
            text: 'inserted|9|new',
          },
        ],
        right: [
          { index: 2, kind: 'row-ins', tint: 'green', text: 'beta|2|ready' },
          { index: 5, kind: 'gap-del', tint: 'gray', text: '' },
        ],
      },
    },
  },
  {
    name: 'table-row-add-remove-multiple',
    // Several additions and removals at once: inserted at the top, beta and
    // delta removed, zeta appended. The placeholders must stay at the right
    // row index on both sides.
    style: 'vscode',
    old: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
        ['epsilon', '5', 'ready'],
      ]),
    ),
    new: doc(
      tableBlock([
        ['inserted', '9', 'new'],
        ['alpha', '1', 'ready'],
        ['gamma', '3', 'draft'],
        ['epsilon', '5', 'ready'],
        ['zeta', '6', 'new'],
      ]),
    ),
    tableChecks: {
      counts: { left: 8, right: 8 },
      markers: {
        left: [
          { index: 1, kind: 'gap-ins', tint: 'gray', text: '' },
          { index: 3, kind: 'row-del', tint: 'red', text: 'beta|2|ready' },
          { index: 5, kind: 'row-del', tint: 'red', text: 'delta|4|ready' },
          { index: 7, kind: 'gap-ins', tint: 'gray', text: '' },
        ],
        right: [
          {
            index: 1,
            kind: 'row-ins',
            tint: 'green',
            text: 'inserted|9|new',
          },
          { index: 3, kind: 'gap-del', tint: 'gray', text: '' },
          { index: 5, kind: 'gap-del', tint: 'gray', text: '' },
          { index: 7, kind: 'row-ins', tint: 'green', text: 'zeta|6|new' },
        ],
      },
    },
  },
  {
    name: 'table-row-add-remove-grow',
    // A 5-row table becomes 6 rows while a middle row is removed and rows are
    // added at both ends: both kinds of placeholder appear on both sides.
    style: 'vscode',
    old: doc(
      tableBlock([
        ['alpha', '1', 'ready'],
        ['beta', '2', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
      ]),
    ),
    new: doc(
      tableBlock([
        ['inserted', '9', 'new'],
        ['alpha', '1', 'ready'],
        ['gamma', '3', 'draft'],
        ['delta', '4', 'ready'],
        ['zeta', '6', 'new'],
      ]),
    ),
    tableChecks: {
      counts: { left: 7, right: 7 },
      markers: {
        left: [
          { index: 1, kind: 'gap-ins', tint: 'gray', text: '' },
          { index: 3, kind: 'row-del', tint: 'red', text: 'beta|2|ready' },
          { index: 6, kind: 'gap-ins', tint: 'gray', text: '' },
        ],
        right: [
          {
            index: 1,
            kind: 'row-ins',
            tint: 'green',
            text: 'inserted|9|new',
          },
          { index: 3, kind: 'gap-del', tint: 'gray', text: '' },
          { index: 6, kind: 'row-ins', tint: 'green', text: 'zeta|6|new' },
        ],
      },
    },
  },
  {
    name: 'table-column-middle',
    old: doc(`
== Data

[cols="1,1,1"]
|===
|Name |Count |Status

|alpha |1 |ready
|beta |2 |ready
|gamma |3 |draft
|===
`),
    new: doc(`
== Data

[cols="1,1,1,1"]
|===
|Name |Count |Severity |Status

|alpha |1 |high |ready
|beta |2 |medium |ready
|gamma |3 |low |draft
|===
`),
  },
  {
    name: 'table-span',
    old: doc(`
== Spans

[cols="1,1,1,1"]
|===
|A |B |C |D

2+|merged |x |y
|a |b |c |d
|e |f |g |h
|===
`),
    new: doc(`
== Spans

[cols="1,1,1,1"]
|===
|A |B |C |D

|a |b |c |d
2+|changed |x |y
|e |f |g |h
|===
`),
  },
  {
    name: 'code-json',
    old: doc(`
== JSON

[source,json]
----
{
  "name": "alpha",
  "version": 1,
  "enabled": true,
  "tags": ["one", "two"]
}
----
`),
    new: doc(`
== JSON

[source,json]
----
{
  "name": "alpha",
  "version": 2,
  "enabled": false,
  "tags": ["one", "three"]
}
----
`),
  },
  {
    name: 'code-huge',
    old: doc(`
== Huge

[source,text]
----
${Array.from({ length: 2200 }, (_, i) => `line ${i + 1}`).join('\n')}
----
`),
    new: doc(`
== Huge

[source,text]
----
${Array.from({ length: 2200 }, (_, i) => (i === 1100 ? 'line CHANGED' : `line ${i + 1}`)).join('\n')}
----
`),
  },
  {
    name: 'lists',
    old: doc(`
== Lists

* one
* two
** nested two
* three

. first
. second
. third

term one:: definition one
term two:: definition two

* [x] done
* [ ] todo
`),
    new: doc(`
== Lists

* one
* inserted
* two
** nested two changed
* three

. first
. second changed
. third

term one:: definition one changed
term two:: definition two
term three:: definition three

* [x] done
* [ ] todo
* [ ] added
`),
  },
  {
    name: 'blocks',
    old: doc(`
== Blocks

NOTE: note text

TIP: tip text

WARNING: warning text

CAUTION: caution text

IMPORTANT: important text

.Example title
====
example text
====

.Sidebar title
****
sidebar text
****

[quote, Someone]
____
quote text
____

[verse]
____
verse text
____

[literal]
....
literal text
....
`),
    new: doc(`
== Blocks

NOTE: changed note text

TIP: tip text

WARNING: changed warning text

CAUTION: caution text

IMPORTANT: changed important text

.Example title changed
====
example text changed
====

.Sidebar title
****
changed sidebar text
****

[quote, Someone Else]
____
changed quote text
____

[verse]
____
changed verse text
____

[literal]
....
changed literal text
....
`),
  },
  {
    name: 'diagrams',
    old: doc(`
== Diagrams

[mermaid]
----
graph TD; A-->B; B-->C;
----

[plantuml]
----
Alice -> Bob: old message
----

image::one.svg[Diagram, 200]
`),
    new: doc(`
== Diagrams

[mermaid]
----
graph TD; A-->D; D-->C;
----

[plantuml]
----
Alice -> Bob: new message
Bob -> Alice: reply
----

image::two.svg[Diagram, 200]
`),
  },
  {
    name: 'media-attrs',
    old: doc(`
== Media

image::one.svg[Diagram, 200]

image::one.svg[Other, 100]
`),
    new: doc(`
== Media

image::one.svg[Diagram, 300]

image::two.svg[Other, 100]
`),
  },
  {
    name: 'xref-links',
    old: doc(`
== Links

See <<target>> and https://example.com/one[the site].

[[target]]
=== Target

Target text.
`),
    new: doc(`
== Links

See <<target2>> and https://example.com/two[the site].

[[target2]]
=== Target

Target text.
`),
  },
  {
    name: 'top-heavy',
    old: doc(sections(12)),
    new: doc(`== Brand new top\n\nA long new section.\n\n* a\n* b\n\n${sections(12)}`),
  },
  {
    name: 'empty-vs-full',
    old: `= Empty\n`,
    new: doc(`
== Content

Some content.

* one
* two

[source,json]
----
{"x": 1}
----
`),
  },
  {
    name: 'toc-shell',
    old: doc(`
== One

text one

== Two

text two
`, ':toc: right'),
    new: doc(`
== One

text one

== Two

text two changed
`),
  },
  {
    name: 'unicode',
    old: doc(`
== Unicode

Привет, мир! 日本語のテキスト。 עברית.

* 😀 emoji
* 中文
`),
    new: doc(`
== Unicode

Привет, изменённый мир! 日本語のテキスト。 עברית.

* 😀 emoji changed
* 中文新增
`),
  },
  {
    name: 'nested-cell',
    old: doc(`
== Nested

[cols="1,2"]
|===
|Kind |Content

a|
* one
* two
a|
[source,json]
----
{"x": 1}
----
|===
`),
    new: doc(`
== Nested

[cols="1,2"]
|===
|Kind |Content

a|
* one
* three
a|
[source,json]
----
{"x": 2}
----
|===
`),
  },
  {
    name: 'callouts',
    old: doc(`
== Callouts

[source,ruby]
----
puts "one" # <1>
puts "two" # <2>
----
<1> first
<2> second
`),
    new: doc(`
== Callouts

[source,ruby]
----
puts "one"   # <1>
puts "two"   # <2>
puts "three" # <3>
----
<1> first changed
<2> second
<3> third
`),
  },
  {
    name: 'math',
    old: doc(
      `
== Math

[stem]
++++
E = mc^2
++++

Inline stem:[x^2 + y^2] here.
`,
      ':stem: latexmath',
    ),
    new: doc(
      `
== Math

[stem]
++++
E = mc^3
++++

Inline stem:[x^2 + z^2] here.
`,
      ':stem: latexmath',
    ),
  },
  {
    name: 'footnotes',
    old: doc(`
== Footnotes

Text with a footnote.footnote:[First note.]

Another sentence.
`),
    new: doc(`
== Footnotes

Text with a changed footnote.footnote:[Second note.]

Another sentence.
`),
  },
  {
    name: 'pass-block',
    old: doc(`
== Pass

pass:[<span class="custom">raw one</span>]

++++
<div class="raw">block one</div>
++++
`),
    new: doc(`
== Pass

pass:[<span class="custom">raw two</span>]

++++
<div class="raw">block two</div>
++++
`),
  },
  {
    name: 'doctype-shell',
    old: `= Book
:doctype: book
:toc: left
:source-highlighter: highlight.js

== One

text one

== Two

text two
`,
    new: `= Article
:toc: right
:source-highlighter: highlight.js

== One

text one changed

== Two

text two
`,
  },
  {
    name: 'table-no-header',
    old: doc(`
== No header

[cols="1,1"]
|===
|alpha |1
|beta |2
|gamma |3
|===
`),
    new: doc(`
== No header

[cols="1,1,1"]
|===
|alpha |high |1
|beta |medium |2
|gamma |low |3
|===
`),
  },
  {
    name: 'csv-table',
    old: doc(`
== CSV

[format=csv,cols="2*"]
|===
Name,Value
alpha,1
beta,2
|===
`),
    new: doc(`
== CSV

[format=csv,cols="2*"]
|===
Name,Value
alpha,10
beta,2
|===
`),
  },
  {
    name: 'formatting-classes',
    old: doc(`
== Classes

[.text-left]
A paragraph with the same text.

*Important:* something.
`),
    new: doc(`
== Classes

[.text-center]
A paragraph with the same text.

_Important:_ something.
`),
  },
  {
    name: 'inline',
    old: doc(`
== Inline

**bold** and *italic* and \`mono\` and kbd:[Ctrl+C] and btn:[OK].

A link to https://example.com/one[example] and an inline image image:one.svg[icon,16,16].
`),
    new: doc(`
== Inline

**bold changed** and _italic_ and \`mono\` and kbd:[Ctrl+V] and btn:[Cancel].

A link to https://example.com/two[example] and an inline image image:two.svg[icon,16,16].
`),
  },
  {
    name: 'admonition-types',
    old: doc(`
== Admonitions

NOTE: note

TIP: tip

WARNING: warning

CAUTION: caution

IMPORTANT: important
`),
    new: doc(`
== Admonitions

WARNING: warning

CAUTION: caution changed

IMPORTANT: important

NOTE: note changed

TIP: tip changed
`),
  },
  {
    name: 'big-doc',
    old: doc(sections(100)),
    new: doc(
      sections(100, (n) =>
        n === 60 ? '\nA new paragraph in section 60, inserted in the middle.\n' : '',
      ),
    ),
  },
  {
    name: 'shift-above',
    old: doc(`
== Intro

Line one.

Line two.

== Target

Old target text.
`),
    new: doc(`
== Intro

Line one.

Line inserted above.

Line two.

== Target

New target text.
`),
  },
]
