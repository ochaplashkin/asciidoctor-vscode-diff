import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { renderDiff } from '../../features/diff/renderDiff.js'

function doc(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><script nonce="deadbeef" src="pre.js"></script></head><body><div id="preview-root">${body}</div></body></html>`
}

function diff(leftBody: string, rightBody: string) {
  return renderDiff(doc(leftBody), doc(rightBody))
}

function diffWithOptions(
  leftBody: string,
  rightBody: string,
  options: Parameters<typeof renderDiff>[2],
) {
  return renderDiff(doc(leftBody), doc(rightBody), options)
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
      changes: 0,
      visualChanges: 0,
      nonVisualChanges: 0,
      addedBlocks: 0,
      removedBlocks: 0,
      movedBlocks: 0,
      changedBlocks: 0,
      changedTables: 0,
      changedCells: 0,
      formattingChanges: 0,
      linkChanges: 0,
      idChanges: 0,
      navigationChanges: 0,
    })
  })

  test('highlights a replaced word but not the whole block', () => {
    const result = diff(
      '<p class="data-line-1">Hello world</p>',
      '<p class="data-line-1">Hello AsciiDoc</p>',
    )
    assert.match(result.leftHtml, /adoc-diff-word adoc-diff-word-del/)
    assert.match(result.rightHtml, /adoc-diff-word adoc-diff-word-ins/)
    assert.match(result.leftHtml, /adoc-diff-block-changed/)
    assert.match(result.rightHtml, /adoc-diff-block-changed/)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-block-del/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-block-ins/)
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

  test('marks only the changed cell when a table value changes', () => {
    const result = diff(
      '<table class="tableblock"><tbody><tr><td class="tableblock"><p class="tableblock">old value</p></td></tr></tbody></table>',
      '<table class="tableblock"><tbody><tr><td class="tableblock"><p class="tableblock">new value</p></td></tr></tbody></table>',
    )
    assert.doesNotMatch(result.leftHtml, /adoc-diff-table/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-table/)
    assert.match(result.leftHtml, /adoc-diff-cell-changed/)
    assert.match(result.rightHtml, /adoc-diff-cell-changed/)
    assert.match(result.leftHtml, /adoc-diff-word adoc-diff-word-del/)
    assert.match(result.rightHtml, /adoc-diff-word adoc-diff-word-ins/)
    assert.equal(result.stats.changedTables, 1)
    assert.equal(result.stats.changedCells, 1)
  })

  test('diffs a short table cell inside the cell', () => {
    const table = (value: string) =>
      `<table class="tableblock"><tbody><tr><td class="tableblock"><p class="tableblock">${value}</p></td></tr></tbody></table>`
    const result = diff(table('2'), table('3'))
    assert.match(result.leftHtml, /adoc-diff-cell-changed/)
    assert.match(result.rightHtml, /adoc-diff-cell-changed/)
    assert.match(result.leftHtml, /adoc-diff-word adoc-diff-word-del/)
    assert.match(result.rightHtml, /adoc-diff-word adoc-diff-word-ins/)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-block-del/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-block-ins/)
    assert.equal(result.stats.changedCells, 1)
  })

  test('outlines a table only for structural changes', () => {
    const result = diff(
      '<table class="tableblock"><tbody><tr><td class="tableblock">A</td></tr></tbody></table>',
      '<table class="tableblock"><tbody><tr><td class="tableblock">A</td></tr><tr><td class="tableblock">B</td></tr></tbody></table>',
    )
    assert.match(result.leftHtml, /adoc-diff-table-del/)
    assert.match(result.rightHtml, /adoc-diff-table-ins/)
    assert.match(result.rightHtml, /adoc-diff-row-ins/)
    assert.equal(result.stats.changedTables, 1)
  })

  test('does not paint a whole container for a short paragraph change', () => {
    const result = diff(
      '<div id="content"><div class="paragraph"><p>2</p></div></div>',
      '<div id="content"><div class="paragraph"><p>3</p></div></div>',
    )
    assert.doesNotMatch(result.leftHtml, /adoc-diff-block-del/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-block-ins/)
    assert.match(result.leftHtml, /adoc-diff-block-changed/)
    assert.match(result.leftHtml, /adoc-diff-word adoc-diff-word-del/)
    assert.match(result.rightHtml, /adoc-diff-word adoc-diff-word-ins/)
    assert.equal(result.stats.changedBlocks, 1)
  })

  test('diffs a short list item inside the item, not the whole list', () => {
    const result = diff(
      '<div class="ulist"><ul><li><p>one</p></li><li><p>keep</p></li></ul></div>',
      '<div class="ulist"><ul><li><p>two</p></li><li><p>keep</p></li></ul></div>',
    )
    assert.doesNotMatch(result.leftHtml, /<li[^>]*adoc-diff-block/)
    assert.doesNotMatch(result.rightHtml, /<li[^>]*adoc-diff-block/)
    assert.match(result.leftHtml, /adoc-diff-word adoc-diff-word-del/)
    assert.match(result.rightHtml, /adoc-diff-word adoc-diff-word-ins/)
  })

  test('marks a whitespace-only code change as a changed line', () => {
    const left =
      '<div class="listingblock"><div class="content"><pre class="highlight"><code>def foo\n  bar\nend</code></pre></div></div>'
    const right =
      '<div class="listingblock"><div class="content"><pre class="highlight"><code>def foo\n    bar\nend</code></pre></div></div>'
    const result = diff(left, right)
    assert.match(result.leftHtml, /adoc-diff-code-line-changed/)
    assert.match(result.rightHtml, /adoc-diff-code-line-changed/)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-word/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-word/)
    assert.equal(result.stats.changedBlocks, 1)
  })

  test('diffs changed code lines and the words inside them', () => {
    const left =
      '<div class="listingblock"><div class="content"><pre class="highlight"><code>puts "hello"</code></pre></div></div>'
    const right =
      '<div class="listingblock"><div class="content"><pre class="highlight"><code>puts "goodbye"</code></pre></div></div>'
    const result = diff(left, right)
    assert.match(result.leftHtml, /adoc-diff-code-line-changed/)
    assert.match(result.rightHtml, /adoc-diff-code-line-changed/)
    assert.match(result.leftHtml, /adoc-diff-word adoc-diff-word-del/)
    assert.match(result.rightHtml, /adoc-diff-word adoc-diff-word-ins/)
  })

  test('inserts a gap line for an added code line', () => {
    const pre = (lines: string) =>
      `<div class="listingblock"><div class="content"><pre class="highlight"><code>${lines}</code></pre></div></div>`
    const result = diff(pre('one\ntwo'), pre('one\nnew line\ntwo'))
    assert.match(result.rightHtml, /adoc-diff-code-line-add/)
    assert.match(result.leftHtml, /adoc-diff-code-line-gap/)
    assert.equal(
      (result.leftHtml.match(/class="adoc-diff-code-line/g) ?? []).length,
      3,
    )
    assert.equal(
      (result.rightHtml.match(/class="adoc-diff-code-line/g) ?? []).length,
      3,
    )
  })

  test('inserts a gap line for a removed code line', () => {
    const pre = (lines: string) =>
      `<div class="listingblock"><div class="content"><pre class="highlight"><code>${lines}</code></pre></div></div>`
    const result = diff(pre('one\nold\ntwo'), pre('one\ntwo'))
    assert.match(result.leftHtml, /adoc-diff-code-line-del/)
    assert.match(result.rightHtml, /adoc-diff-code-line-gap/)
  })

  test('keeps highlight.js spans on every code line', () => {
    const pre = (body: string) =>
      `<div class="listingblock"><div class="content"><pre class="highlight"><code>${body}</code></pre></div></div>`
    const result = diff(
      pre('<span class="hljs-keyword">def</span> foo\n  bar'),
      pre('<span class="hljs-keyword">def</span> foo\n  baz'),
    )
    assert.match(result.leftHtml, /hljs-keyword/)
    assert.match(result.rightHtml, /hljs-keyword/)
    assert.match(result.leftHtml, /adoc-diff-code-line-changed/)
  })

  test('marks a changed image even when its alt text is unchanged', () => {
    const left =
      '<div class="imageblock"><div class="content"><img src="one.png" alt="Alt"></div></div>'
    const right =
      '<div class="imageblock"><div class="content"><img src="two.png" alt="Alt"></div></div>'
    const result = diff(left, right)
    assert.match(result.leftHtml, /adoc-diff-block-changed/)
    assert.match(result.rightHtml, /adoc-diff-block-changed/)
    assert.equal(result.stats.changedBlocks, 1)
  })

  test('keeps an unchanged image while marking the modified paragraph', () => {
    const paragraph = (text: string) =>
      `<div class="paragraph"><p>${text} <span class="image"><img src="pic.png" alt="Alt"></span> end</p></div>`
    const result = diff(paragraph('Hello'), paragraph('Goodbye'))
    assert.match(result.leftHtml, /adoc-diff-word adoc-diff-word-del/)
    assert.match(result.rightHtml, /adoc-diff-word adoc-diff-word-ins/)
    assert.match(result.leftHtml, /adoc-diff-block-changed/)
    assert.match(result.rightHtml, /adoc-diff-block-changed/)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-block-del/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-block-ins/)
  })

  test('compares images relative to each document base', () => {
    const preview = (src: string, base: string) =>
      `<!DOCTYPE html><html><head><meta charset="utf-8"><base href="${base}"></head><body><div id="preview-root"><div class="imageblock"><div class="content"><img src="${src}" alt="Alt"></div></div></div></body></html>`
    const same = renderDiff(
      preview('img/one.png', 'https://host/docs/a.adoc'),
      preview('img/one.png', 'https://host/docs/b.adoc'),
    )
    assert.doesNotMatch(same.leftHtml, /adoc-diff-(block|word|table|cell)/)
    assert.doesNotMatch(same.rightHtml, /adoc-diff-(block|word|table|cell)/)
    const changed = renderDiff(
      preview('img/one.png', 'https://host/docs/a.adoc'),
      preview('img/two.png', 'https://host/docs/b.adoc'),
    )
    assert.match(changed.leftHtml, /adoc-diff-block-changed/)
    assert.match(changed.rightHtml, /adoc-diff-block-changed/)
  })

  test('treats an admonition table as a block, not as a data table', () => {
    const admonition = (title: string) =>
      `<div class="admonitionblock note"><table><tr><td class="icon"><div class="title">${title}</div></td><td class="content">Text</td></tr></table></div>`
    const result = diff(admonition('Note'), admonition('Warning'))
    assert.doesNotMatch(result.leftHtml, /adoc-diff-table/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-table/)
    assert.match(result.leftHtml, /adoc-diff-word adoc-diff-word-del/)
    assert.match(result.rightHtml, /adoc-diff-word adoc-diff-word-ins/)
  })

  test('adds a gap marker on the other side of an inserted block', () => {
    const result = diff(
      '<p class="data-line-1">A</p><p class="data-line-2">C</p>',
      '<p class="data-line-1">A</p><p class="data-line-2">B</p><p class="data-line-3">C</p>',
    )
    assert.match(result.leftHtml, /data-adoc-diff-gap="ins"/)
    assert.match(result.leftHtml, /data-adoc-diff-anchor="root"/)
    assert.match(result.leftHtml, /data-adoc-diff-anchor="__start"/)
    assert.match(result.leftHtml, /data-adoc-diff-anchor="__end"/)
  })

  test('adds a gap marker on the other side of a short removed block', () => {
    const result = diff(
      '<p class="data-line-1">A</p><p class="data-line-2">B</p><p class="data-line-3">C</p>',
      '<p class="data-line-1">A</p><p class="data-line-2">C</p>',
    )
    assert.match(result.rightHtml, /data-adoc-diff-gap="del"/)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-collapsed/)
  })

  test('collapses a long removed block into a zero-height marker', () => {
    const longText = 'word '.repeat(200).trim()
    const result = diff(
      `<p class="data-line-1">A</p><p class="data-line-2">${longText}</p><p class="data-line-3">C</p>`,
      '<p class="data-line-1">A</p><p class="data-line-2">C</p>',
    )
    assert.match(result.leftHtml, /adoc-diff-collapsed/)
    assert.match(result.leftHtml, /data-adoc-diff-collapse-lines="\d+"/)
    assert.match(result.leftHtml, /data-adoc-diff-collapse-key="/)
    assert.match(result.leftHtml, /data-adoc-diff-collapse-excerpt="/)
    // The reader of the new version must see that something was deleted there.
    assert.match(result.rightHtml, /data-adoc-diff-gap="del"/)
    assert.match(result.rightHtml, /data-adoc-diff-gap-count="\d+"/)
  })

  test('assigns matching anchors to both sides of a change', () => {
    const result = diff(
      '<p class="data-line-1">A</p><p class="data-line-2">old</p>',
      '<p class="data-line-1">A</p><p class="data-line-2">new</p>',
    )
    const left = [
      ...result.leftHtml.matchAll(/data-adoc-diff-anchor="([^"]+)"/g),
    ].map((m) => m[1])
    const right = [
      ...result.rightHtml.matchAll(/data-adoc-diff-anchor="([^"]+)"/g),
    ].map((m) => m[1])
    assert.deepEqual(left, right)
    assert.ok(left.includes('root'))
    assert.ok(left.includes('__start'))
    assert.ok(left.includes('__end'))
  })

  test('inserts a placeholder column for a column added in the middle', () => {
    const table = (cells: string, cols: number) =>
      `<table class="tableblock"><colgroup>${'<col width="25%">'.repeat(cols)}</colgroup><tbody><tr>${cells}</tr></tbody></table>`
    const result = diff(
      table('<td>A</td><td>B</td><td>C</td>', 3),
      table('<td>A</td><td>B</td><td>NEW</td><td>C</td>', 4),
    )
    assert.match(result.leftHtml, /data-adoc-diff-grid="g0"/)
    assert.match(result.rightHtml, /data-adoc-diff-grid="g0"/)
    assert.match(result.leftHtml, /adoc-diff-col-gap/)
    assert.match(result.rightHtml, /adoc-diff-cell-ins/)
    assert.match(result.leftHtml, /adoc-diff-table-del/)
    assert.match(result.rightHtml, /adoc-diff-table-ins/)
    assert.equal((result.leftHtml.match(/<col /g) ?? []).length, 4)
    assert.equal((result.rightHtml.match(/<col /g) ?? []).length, 4)
  })

  test('inserts a placeholder row for an added row', () => {
    const table = (rows: string) =>
      `<table class="tableblock"><colgroup><col width="50%"><col width="50%"></colgroup><tbody>${rows}</tbody></table>`
    const result = diff(
      table('<tr><td>A</td><td>B</td></tr>'),
      table('<tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr>'),
    )
    assert.match(result.leftHtml, /adoc-diff-row-gap/)
    assert.match(result.leftHtml, /colspan="2"/)
    assert.match(result.leftHtml, /adoc-diff-table-del/)
    assert.match(result.rightHtml, /adoc-diff-row-ins/)
    assert.equal((result.leftHtml.match(/<tr/g) ?? []).length, 2)
    assert.equal((result.rightHtml.match(/<tr/g) ?? []).length, 2)
  })

  test('does not add table placeholders for a cell text change', () => {
    const table = (value: string) =>
      `<table class="tableblock"><colgroup><col width="50%"><col width="50%"></colgroup><tbody><tr><td>A</td><td>${value}</td></tr></tbody></table>`
    const result = diff(table('old'), table('new'))
    assert.match(result.leftHtml, /adoc-diff-grid/)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-col-gap|adoc-diff-row-gap/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-col-gap|adoc-diff-row-gap/)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-table-del/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-table-ins/)
    assert.match(result.leftHtml, /adoc-diff-cell-changed/)
  })

  test('can disable alignment without losing the markers', () => {
    const result = diffWithOptions(
      '<p class="data-line-1">A</p><p class="data-line-3">C</p>',
      '<p class="data-line-1">A</p><p class="data-line-2">B</p><p class="data-line-3">C</p>',
      {
        align: false,
        deletedBlocks: 'collapse',
        codeBlocks: 'line',
        collapseLines: 5,
        showStats: true,
      },
    )
    assert.match(result.rightHtml, /adoc-diff-block-ins/)
    assert.doesNotMatch(result.leftHtml, /data-adoc-diff-anchor/)
    assert.doesNotMatch(result.leftHtml, /data-adoc-diff-gap/)
  })

  test('pairs an existing table column with itself when a column is inserted before it', () => {
    const table = (widths: string, header: string, rows: string) =>
      `<table class="tableblock"><colgroup>${widths}</colgroup><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`
    const result = diff(
      table(
        '<col width="33%"><col width="33%"><col width="33%">',
        '<th>Name</th><th>Count</th><th>Status</th>',
        '<tr><td>alpha</td><td>1</td><td>ready</td></tr><tr><td>beta</td><td>2</td><td>draft</td></tr>',
      ),
      table(
        '<col width="20%"><col width="20%"><col width="20%"><col width="20%"><col width="20%">',
        '<th>Name</th><th>Count</th><th>Severity</th><th>Status</th><th>Owner</th>',
        '<tr><td>alpha</td><td>1</td><td>high</td><td>ready</td><td>ann</td></tr><tr><td>beta</td><td>2</td><td>low</td><td>published</td><td>bob</td></tr>',
      ),
    )
    const headers = (html: string) =>
      [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((match) =>
        match[1].replace(/<[^>]+>/g, '').trim(),
      )
    // The old `Status` must stay aligned with the new `Status`; `Severity` and
    // `Owner` are the one-sided columns, not a shifted `Status`.
    assert.deepEqual(headers(result.leftHtml), [
      'Name',
      'Count',
      '',
      'Status',
      '',
    ])
    assert.deepEqual(headers(result.rightHtml), [
      'Name',
      'Count',
      'Severity',
      'Status',
      'Owner',
    ])
    // A changed cell in the aligned `Status` column is a word diff, not a
    // wholesale column removal/addition.
    assert.match(result.leftHtml, /draft/)
    assert.match(result.rightHtml, /published/)
    assert.match(result.leftHtml, /adoc-diff-word adoc-diff-word-del/)
    assert.match(result.rightHtml, /adoc-diff-word adoc-diff-word-ins/)
    assert.equal(result.stats.changedTables, 1)
  })

  test('reports a TOC-only change as navigation, not as "No differences"', () => {
    const withToc = (entry: string) =>
      `<div id="header"><h1>Manual</h1><div id="toc" class="toc2"><ul><li><a href="#_one">${entry}</a></li></ul></div></div><div id="content"><p>A</p></div>`
    const result = diff(withToc('Old heading'), withToc('New heading'))
    // The TOC itself is not a content hunk (it is generated and would double
    // every heading change), but a TOC-only difference is still reported.
    assert.equal(result.stats.changes, 0)
    assert.equal(result.stats.navigationChanges, 1)
    assert.equal(result.stats.addedBlocks, 0)
    assert.equal(result.stats.removedBlocks, 0)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-(block|word|hunk)/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-(block|word|hunk)/)
    assert.match(result.leftHtml, /data-adoc-diff-navigation="changed"/)
    assert.match(result.rightHtml, /data-adoc-diff-navigation="changed"/)
  })

  test('does not build a table grid when alignment is disabled', () => {
    const table = (cells: string) =>
      `<table class="tableblock"><tbody><tr>${cells}</tr></tbody></table>`
    const result = diffWithOptions(
      table('<td>A</td><td>B</td>'),
      table('<td>A</td><td>B</td><td>C</td>'),
      {
        align: false,
        deletedBlocks: 'collapse',
        codeBlocks: 'line',
        collapseLines: 5,
        showStats: true,
      },
    )
    assert.doesNotMatch(result.leftHtml, /data-adoc-diff-grid/)
    assert.doesNotMatch(result.leftHtml, /adoc-diff-col-gap/)
  })

  test('can keep a long deleted block visible', () => {
    const longText = 'word '.repeat(200).trim()
    const result = diffWithOptions(
      `<p class="data-line-1">A</p><p class="data-line-2">${longText}</p><p class="data-line-3">C</p>`,
      '<p class="data-line-1">A</p><p class="data-line-2">C</p>',
      {
        align: true,
        deletedBlocks: 'expand',
        codeBlocks: 'line',
        collapseLines: 5,
        showStats: true,
      },
    )
    assert.doesNotMatch(result.leftHtml, /adoc-diff-collapsed/)
    assert.match(result.rightHtml, /data-adoc-diff-gap="del"/)
  })

  test('can compare a code block as a whole', () => {
    const code = (lines: string) =>
      `<div class="listingblock"><div class="content"><pre class="highlight"><code>${lines}</code></pre></div></div>`
    const result = diffWithOptions(code('one\ntwo'), code('one\nnew\ntwo'), {
      align: true,
      deletedBlocks: 'collapse',
      codeBlocks: 'block',
      collapseLines: 5,
      showStats: true,
    })
    assert.doesNotMatch(result.leftHtml, /adoc-diff-code-line/)
    assert.match(result.rightHtml, /adoc-diff-word adoc-diff-word-ins/)
  })

  test('keeps rowspans in the union grid', () => {
    const table = (rows: string, cols: number) =>
      `<table class="tableblock"><colgroup>${'<col width="25%">'.repeat(cols)}</colgroup><tbody>${rows}</tbody></table>`
    const result = diff(
      table(
        '<tr><td rowspan="2">A</td><td>B</td><td>C</td></tr><tr><td>D</td><td>E</td></tr>',
        3,
      ),
      table(
        '<tr><td rowspan="2">A</td><td>B</td><td>NEW</td><td>C</td></tr><tr><td>D</td><td>x</td><td>E</td></tr>',
        4,
      ),
    )
    assert.match(result.leftHtml, /rowspan="2"/)
    assert.match(result.rightHtml, /rowspan="2"/)
    assert.match(result.leftHtml, /adoc-diff-col-gap/)
    assert.equal((result.leftHtml.match(/<col /g) ?? []).length, 4)
    assert.equal((result.rightHtml.match(/<col /g) ?? []).length, 4)
    assert.match(result.leftHtml, /adoc-diff-table-del/)
    assert.match(result.rightHtml, /adoc-diff-table-ins/)
  })

  test('keeps a colspan when a column is inserted inside it', () => {
    const table = (cell: string, cols: number) =>
      `<table class="tableblock"><colgroup>${'<col width="25%">'.repeat(cols)}</colgroup><tbody><tr>${cell}<td>C</td></tr></tbody></table>`
    const result = diff(
      table('<td colspan="2">merged</td>', 3),
      table('<td colspan="3">merged</td>', 4),
    )
    assert.match(result.leftHtml, /colspan="2"/)
    assert.match(result.rightHtml, /colspan="3"/)
    assert.match(result.leftHtml, /adoc-diff-col-gap/)
    assert.equal((result.leftHtml.match(/<col /g) ?? []).length, 4)
    assert.equal((result.rightHtml.match(/<col /g) ?? []).length, 4)
  })

  test('records the source line of a changed table', () => {
    const table = (value: string) =>
      `<table class="tableblock data-line-3"><tbody class="data-line-4"><tr class="data-line-5"><td class="data-line-6"><p class="data-line-7">${value}</p></td></tr></tbody></table>`
    const result = diff(table('old'), table('new'))
    assert.ok(result.lineMap.some((entry) => entry.leftLine === 3))
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

  test('does not split a formula with word markers', () => {
    const formula = (value: string) =>
      `<div class="stemblock data-line-1"><div class="content">\\(a^2 + b^2 = ${value}\\)</div></div>`
    const result = diff(formula('c^2'), formula('c^3'))
    // MathJax finds a formula by its delimiters in one text node: wrapping a
    // character inside it would leave the formula unrendered.
    assert.doesNotMatch(result.leftHtml, /adoc-diff-word/)
    assert.doesNotMatch(result.rightHtml, /adoc-diff-word/)
    assert.match(result.leftHtml, /adoc-diff-block-changed/)
    assert.match(result.rightHtml, /adoc-diff-block-changed/)
    assert.equal(result.stats.changes, 1)
  })

  test('adds the block icon only when no word marker shows the change', () => {
    const words = diff(
      '<p class="data-line-1">Hello world</p>',
      '<p class="data-line-1">Hello AsciiDoc</p>',
    )
    assert.doesNotMatch(words.leftHtml, /data-adoc-diff-icon/)
    assert.doesNotMatch(words.rightHtml, /data-adoc-diff-icon/)

    const formula = diff(
      '<div class="stemblock data-line-1"><div class="content">\\(a^2\\)</div></div>',
      '<div class="stemblock data-line-1"><div class="content">\\(a^3\\)</div></div>',
    )
    assert.match(formula.leftHtml, /data-adoc-diff-icon/)
    assert.match(formula.rightHtml, /data-adoc-diff-icon/)
  })

  test('still highlights prose next to an unchanged formula', () => {
    const paragraph = (value: string) =>
      `<p class="data-line-1">See \\(a^2\\) for the ${value} value</p>`
    const result = diff(paragraph('old'), paragraph('new'))
    assert.match(result.leftHtml, /adoc-diff-word adoc-diff-word-del/)
    assert.match(result.rightHtml, /adoc-diff-word adoc-diff-word-ins/)
    // The formula itself stays untouched in a single text node.
    const formulaHtml = /\\\([\s\S]*?\\\)/.exec(result.leftHtml)?.[0] ?? ''
    assert.match(formulaHtml, /a\^2/)
    assert.doesNotMatch(formulaHtml, /<span/)
  })
})
