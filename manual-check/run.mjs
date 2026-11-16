import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import { chromium } from 'playwright'
import { hostFiles, scenarios } from './scenarios.mjs'

const require = createRequire(import.meta.url)
const { convertForPreview, resolveWebviewResources } = require(
  '../build/src/features/preview/previewConversion.js',
)
const { previewRequest, fakeHost, asTestWebviewUri } = require(
  '../build/src/test/unit/previewFixtures.js',
)
const { renderDiff } = require('../build/src/features/diff/renderDiff.js')
const { buildDiffDocument } = require('../build/src/features/diff/diffDocument.js')
const { defaultDiffRenderOptions } = require('../build/src/features/diff/blockDiff.js')

const strings = {
  rendering: 'Rendering…',
  noDifferences: 'No differences',
  noVisualDifferences: 'No visual text differences',
  error: 'Unable to render the diff',
  old: 'old',
  new: 'new',
  swap: 'Swap',
  nonVisualFormatting: 'Formatting was changed here',
  nonVisualLink: 'Link target was changed here',
  nonVisualId: 'Anchor id was changed here',
  blockChanged: 'Changed block',
  mediaChanged: 'Changed image or diagram',
  shellDiffers: 'The documents use different preview shells; some styles may not match.',
  statusSummary: '{0} change regions · +{1} added blocks · −{2} removed blocks',
  statusNonVisual: '{0} formatting / {1} link / {2} id changes',
  statusJump: 'Click for the next change, Shift+click for the previous',
  collapseExpand: 'Click to expand deleted block',
  collapseCollapse: 'Click to collapse deleted block',
  collapseLabel: '{0} lines',
  collapseLabelWithExcerpt: '{0} lines · {1}',
  gapAddedBlocks: '{0} added blocks',
  gapAddedTable: '{0} added table rows',
  gapAddedLines: '{0} added lines',
  gapRemovedBlocks: '{0} removed blocks',
  gapRemovedTable: '{0} removed table rows',
  gapRemovedLines: '{0} removed lines',
  gapChangedBlocks: '{0} changed blocks',
  gapChangedTable: '{0} changed table rows',
  gapChangedLines: '{0} changed lines',
  gapAddedBlock: '1 added block',
  gapAddedTableRow: '1 added table row',
  gapAddedLine: '1 added line',
  gapRemovedBlock: '1 removed block',
  gapRemovedTableRow: '1 removed table row',
  gapRemovedLine: '1 removed line',
  gapChangedBlock: '1 changed block',
  gapChangedTableRow: '1 changed table row',
  gapChangedLine: '1 changed line',
  statusNonVisualSummaryOne: '1 change',
  statusNavigationSummary: '{0} navigation changes',
  statusNavigationSummaryOne: '1 navigation change',
  navigationChanged: 'Table of contents changed',
}

const options = { ...defaultDiffRenderOptions }

await mkdir(path.join('manual-check', 'html'), { recursive: true })
await mkdir(path.join('manual-check', 'screens'), { recursive: true })

async function convert(text, style) {
  const request = previewRequest(text, { attributes: { 'data-uri': '' } })
  if (style !== undefined) {
    request.config = {
      ...request.config,
      defaultStyle: style,
      defaultStyleExplicit: true,
    }
  }
  const result = await convertForPreview(
    request,
    fakeHost(hostFiles).host,
  )
  return resolveWebviewResources(result.html, result.resources, asTestWebviewUri)
}

const diffJs = await readFile(path.join('dist', 'diff.js'), 'utf8')
const diffCss = await readFile(path.join('media', 'diff.css'), 'utf8')
const diffContentCss = await readFile(
  path.join('media', 'diff-content.css'),
  'utf8',
)

async function inlineAssets(html) {
  let out = html.replace(
    /<meta http-equiv="Content-Security-Policy"[^>]*>/gi,
    '',
  )
  out = out.replace(
    /<link rel="stylesheet" type="text\/css" href="([^"]+)">/g,
    (match, href) => {
      if (href === 'diff.css') {
        return `<style>${diffCss}</style>`
      }
      const prefix = 'webview:/extension/'
      if (href.startsWith(prefix)) {
        const relative = href.slice(prefix.length)
        const file = path.join('media', relative.replace(/^media\//, ''))
        try {
          const css = require('node:fs').readFileSync(file, 'utf8')
          return `<style>${css}</style>`
        } catch {
          return ''
        }
      }
      return ''
    },
  )
  out = out.replace(
    /<script src="([^"]+)"><\/script>/g,
    (match, src) => {
      if (src === 'diff.js') {
        return `<script>${diffJs}</script>`
      }
      return ''
    },
  )
  return out
}

function hunkIds(html) {
  return [
    ...new Set(
      [...html.matchAll(/data-adoc-diff-hunk="([^"]+)"/g)].map((m) => m[1]),
    ),
  ]
}

const problems = []
function problem(scenario, message) {
  problems.push(`${scenario}: ${message}`)
  console.log(`  PROBLEM ${scenario}: ${message}`)
}

const tableTints = {
  green: /^rgba?\(0,\s*128,\s*0\b/,
  red: /^rgba?\(255,\s*0,\s*0\b/,
  gray: /^rgba?\(128,\s*128,\s*128\b/,
}

const tableRowMarkers = {
  'row-ins': ['adoc-diff-row-ins'],
  'row-del': ['adoc-diff-row-del'],
  'gap-ins': ['adoc-diff-row-gap', 'adoc-diff-gap-ins'],
  'gap-del': ['adoc-diff-row-gap', 'adoc-diff-gap-del'],
}

function tableCellText(row) {
  return row.cells.map((cell) => cell.text).join('|')
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = []

const only = process.env.SCENARIO
for (const scenario of scenarios) {
  if (only !== undefined && only !== '' && scenario.name !== only) continue
  process.stdout.write(`\n=== ${scenario.name}\n`)
  const [oldHtml, newHtml] = await Promise.all([
    convert(scenario.old, scenario.style),
    convert(scenario.new, scenario.style),
  ])
  const diff = renderDiff(oldHtml, newHtml, options)
  const leftIds = hunkIds(diff.leftHtml)
  const rightIds = hunkIds(diff.rightHtml)
  const union = [...new Set([...leftIds, ...rightIds])]
  const markerRegex =
    /adoc-diff-(?:block|word|cell|table|collapsed|nonvisual|media)/
  console.log('stats', diff.stats, 'hunks', union.length)
  if (diff.stats.changes !== union.length) {
    problem(
      scenario.name,
      `stats.changes=${diff.stats.changes} but DOM union hunks=${union.length}`,
    )
  }
  if (
    diff.stats.changes !==
    diff.stats.visualChanges + diff.stats.nonVisualChanges
  ) {
    problem(
      scenario.name,
      `changes != visualChanges + nonVisualChanges (${diff.stats.changes} vs ${diff.stats.visualChanges}+${diff.stats.nonVisualChanges})`,
    )
  }
  if (diff.stats.changes === 0 && markerRegex.test(diff.leftHtml)) {
    problem(scenario.name, 'no changes counted but visual markers are present')
  }
  if (diff.stats.changes > 0 && union.length === 0) {
    problem(scenario.name, 'changes counted but no hunk target exists')
  }
  if (diff.stats.changes > 0) {
    const missingLeft = union.filter((id) => !leftIds.includes(id))
    const missingRight = union.filter((id) => !rightIds.includes(id))
    if (missingLeft.length > 0) {
      console.log('  hunk ids only on right', missingLeft)
    }
    if (missingRight.length > 0) {
      console.log('  hunk ids only on left', missingRight)
    }
  }

  const documentOptions = {
    leftHtml: diff.leftHtml,
    rightHtml: diff.rightHtml,
    diffScriptUri: 'diff.js',
    diffCssUri: 'diff.css',
    diffContentCss,
    leftTitle: 'v1/index.adoc',
    rightTitle: 'v2/index.adoc',
    leftTitleTooltip: '/workspace/v1/index.adoc',
    rightTitleTooltip: '/workspace/v2/index.adoc',
    strings,
    lineMap: diff.lineMap,
    leftLineCount: diff.leftLineCount,
    rightLineCount: diff.rightLineCount,
    version: 1,
    stats: diff.stats,
    options,
  }
  const html = await inlineAssets(buildDiffDocument(documentOptions))
  await writeFile(
    path.join('manual-check', 'html', `${scenario.name}.html`),
    html,
  )

  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  await page.setContent(html, { waitUntil: 'load' })
  await page.waitForTimeout(1900)

  const metrics = await page.evaluate(() => {
    const left = document.getElementById('diff-left')
    const right = document.getElementById('diff-right')
    const status = document.getElementById('diff-status')
    const settings = JSON.parse(
      document
        .getElementById('vscode-asciidoc-diff-data')
        ?.getAttribute('data-settings') ?? '{}',
    )
    const anchorDeltas = []
    const leftAnchors = new Map()
    for (const element of left.querySelectorAll('[data-adoc-diff-anchor]')) {
      if (element.getClientRects().length === 0) continue
      leftAnchors.set(element.getAttribute('data-adoc-diff-anchor'), element)
    }
    for (const element of right.querySelectorAll('[data-adoc-diff-anchor]')) {
      if (element.getClientRects().length === 0) continue
      const id = element.getAttribute('data-adoc-diff-anchor')
      const other = leftAnchors.get(id)
      if (!other) continue
      const delta = Math.abs(
        other.getBoundingClientRect().top -
          left.getBoundingClientRect().top -
          (element.getBoundingClientRect().top -
            right.getBoundingClientRect().top),
      )
      anchorDeltas.push({ id, delta })
    }
    anchorDeltas.sort((a, b) => b.delta - a.delta)
    const grids = []
    const leftTables = new Map()
    for (const table of left.querySelectorAll('table[data-adoc-diff-grid]')) {
      leftTables.set(table.getAttribute('data-adoc-diff-grid'), table)
    }
    for (const table of right.querySelectorAll('table[data-adoc-diff-grid]')) {
      const id = table.getAttribute('data-adoc-diff-grid')
      const other = leftTables.get(id)
      grids.push({
        id,
        rowsLeft: other ? other.rows.length : 0,
        rowsRight: table.rows.length,
        colsLeft: other ? other.querySelectorAll('colgroup col').length : 0,
        colsRight: table.querySelectorAll('colgroup col').length,
        rowHeights: [...table.rows].map((row, index) =>
          Math.abs(
            row.getBoundingClientRect().height -
              (other?.rows[index]?.getBoundingClientRect().height ?? 0),
          ),
        ),
      })
    }
    const hunkIds = [
      ...new Set(
        [...document.querySelectorAll('[data-adoc-diff-hunk]')].map((el) =>
          el.getAttribute('data-adoc-diff-hunk'),
        ),
      ),
    ]
    const missingTargets = []
    for (const id of hunkIds) {
      const elements = [
        ...document.querySelectorAll(`[data-adoc-diff-hunk="${id}"]`),
      ]
      if (!elements.some((el) => el.getClientRects().length > 0)) {
        missingTargets.push(id)
      }
    }
    const tableRows = {}
    for (const [side, pane] of [
      ['left', left],
      ['right', right],
    ]) {
      tableRows[side] = [
        ...pane.querySelectorAll('table.tableblock'),
      ].map((table) =>
        [...table.rows].map((row) => ({
          className: row.className,
          section: (row.parentElement?.tagName ?? '').toLowerCase(),
          gap: row.getAttribute('data-adoc-diff-row-gap') ?? '',
          background: getComputedStyle(row).backgroundColor,
          cells: [...row.cells].map((cell) => ({
            tag: (cell.tagName ?? '').toLowerCase(),
            className: cell.className,
            background: getComputedStyle(cell).backgroundColor,
            text: (cell.textContent ?? '').trim(),
          })),
        })),
      )
    }
    const tableColumnCounts = {}
    const listItems = {}
    for (const [side, pane] of [
      ['left', left],
      ['right', right],
    ]) {
      tableColumnCounts[side] = [
        ...pane.querySelectorAll('table.tableblock'),
      ].map((table) => table.querySelectorAll('colgroup col').length)
      listItems[side] = [...pane.querySelectorAll('li')].map((item) => {
        let depth = 0
        let parent = item.parentElement
        while (parent) {
          if (parent.tagName === 'UL' || parent.tagName === 'OL') {
            depth++
          }
          parent = parent.parentElement
        }
        const paragraph = [...item.children].find(
          (child) => child.tagName === 'P',
        )
        const list = item.closest('.ulist, .olist, .dlist')
        return {
          text: (paragraph?.textContent ?? '').trim(),
          className: item.className,
          paragraphClassName: paragraph?.className ?? '',
          listClassName: list?.className ?? '',
          hunk: item.getAttribute('data-adoc-diff-hunk') ?? '',
          background: getComputedStyle(item).backgroundColor,
          listBackground: list
            ? getComputedStyle(list).backgroundColor
            : '',
          depth,
        }
      })
    }
    const codeLines = {}
    const wordTexts = {}
    const sections = {}
    for (const [side, pane] of [
      ['left', left],
      ['right', right],
    ]) {
      sections[side] = [
        ...pane.querySelectorAll('.sect1, .sect2, .sect3, .sect4'),
      ].map((section) => {
        const heading = [...section.children].find((child) =>
          /^H[1-6]$/.test(child.tagName),
        )
        let depth = 1
        let parent = section.parentElement
        while (parent) {
          if (parent.matches('.sect1, .sect2, .sect3, .sect4')) {
            depth++
          }
          parent = parent.parentElement
        }
        return {
          title: (heading?.textContent ?? '').trim(),
          className: section.className,
          headingClassName: heading?.className ?? '',
          hunk: section.getAttribute('data-adoc-diff-hunk') ?? '',
          collapsed: section.classList.contains('adoc-diff-collapsed'),
          collapseLines:
            section.getAttribute('data-adoc-diff-collapse-lines') ?? '',
          gap: section.getAttribute('data-adoc-diff-gap') ?? '',
          gapAfter: section.getAttribute('data-adoc-diff-gap-after') ?? '',
          gapCount: section.getAttribute('data-adoc-diff-gap-count') ?? '',
          gapObject: section.getAttribute('data-adoc-diff-gap-object') ?? '',
          depth,
          text: section.textContent.replace(/\s+/g, ' ').trim().slice(0, 120),
        }
      })
      wordTexts[side] = {
        del: [...pane.querySelectorAll('.adoc-diff-word-del')].map((el) =>
          (el.textContent ?? '').trim(),
        ),
        ins: [...pane.querySelectorAll('.adoc-diff-word-ins')].map((el) =>
          (el.textContent ?? '').trim(),
        ),
      }
      codeLines[side] = {
        changed: pane.querySelectorAll('.adoc-diff-code-line-changed').length,
        add: pane.querySelectorAll(
          '.adoc-diff-code-line-add:not(.adoc-diff-code-line-gap)',
        ).length,
        del: pane.querySelectorAll(
          '.adoc-diff-code-line-del:not(.adoc-diff-code-line-gap)',
        ).length,
        gap: pane.querySelectorAll('.adoc-diff-code-line-gap').length,
        wordsDel: pane.querySelectorAll('.adoc-diff-word-del').length,
        wordsIns: pane.querySelectorAll('.adoc-diff-word-ins').length,
      }
    }
    const cellChanged = document.querySelectorAll(
      '.adoc-diff-cell-changed',
    ).length
    return {
      status: status?.textContent,
      className: status?.className,
      stats: settings.stats,
      anchors: anchorDeltas.length,
      maxAnchorDelta: anchorDeltas[0]?.delta ?? 0,
      worstAnchors: anchorDeltas.slice(0, 3),
      grids,
      tableRows,
      tableColumnCounts,
      listItems,
      codeLines,
      wordTexts,
      sections,
      cellChanged,
      hunkCount: hunkIds.length,
      missingTargets,
      gapLabels: [
        ...document.querySelectorAll('[data-adoc-diff-gap-label]'),
      ].map((el) => el.getAttribute('data-adoc-diff-gap-label')),
      collapseLabels: [
        ...document.querySelectorAll('[data-adoc-diff-collapse-label]'),
      ].map((el) => el.getAttribute('data-adoc-diff-collapse-label')),
      nonVisual: [
        ...document.querySelectorAll('[data-adoc-diff-nonvisual]'),
      ].map((el) => [el.getAttribute('data-adoc-diff-nonvisual'), el.title]),
      blockChanged: document.querySelectorAll('.adoc-diff-block-changed').length,
      mediaChanged: document.querySelectorAll('.adoc-diff-media-changed').length,
      words: document.querySelectorAll('.adoc-diff-word').length,
      leftTop: left.scrollTop,
      rightTop: right.scrollTop,
    }
  })

  if (pageErrors.length > 0) {
    problem(scenario.name, `page errors: ${pageErrors.join(' | ')}`)
  }
  if (metrics.hunkCount !== diff.stats.changes) {
    problem(
      scenario.name,
      `DOM hunks=${metrics.hunkCount} but stats.changes=${diff.stats.changes}`,
    )
  }
  if (metrics.missingTargets.length > 0) {
    problem(
      scenario.name,
      `hunks without a visible target: ${metrics.missingTargets.join(', ')}`,
    )
  }
  if (metrics.maxAnchorDelta > 3) {
    problem(
      scenario.name,
      `max anchor delta ${metrics.maxAnchorDelta.toFixed(2)}px (worst ${JSON.stringify(metrics.worstAnchors)})`,
    )
  }
  for (const grid of metrics.grids) {
    if (grid.rowsLeft !== grid.rowsRight) {
      problem(
        scenario.name,
        `table ${grid.id} row count ${grid.rowsLeft}/${grid.rowsRight}`,
      )
    }
    if (grid.colsLeft !== grid.colsRight) {
      problem(
        scenario.name,
        `table ${grid.id} col count ${grid.colsLeft}/${grid.colsRight}`,
      )
    }
    const worstRow = Math.max(0, ...grid.rowHeights)
    if (worstRow > 3) {
      problem(
        scenario.name,
        `table ${grid.id} row height delta ${worstRow.toFixed(2)}px`,
      )
    }
  }

  if (scenario.tableChecks !== undefined) {
    const { table: tableIndex = 0, counts = {}, markers = {} } =
      scenario.tableChecks
    for (const [side, expected] of Object.entries(counts)) {
      const table = (metrics.tableRows[side] ?? [])[tableIndex]
      const actual = table?.length ?? 0
      if (actual !== expected) {
        problem(
          scenario.name,
          `${side} table row count ${actual}, expected ${expected}`,
        )
      }
    }
    for (const [side, checks] of Object.entries(markers)) {
      const table = (metrics.tableRows[side] ?? [])[tableIndex] ?? []
      for (const check of checks) {
        const row = table[check.index]
        if (row === undefined) {
          problem(
            scenario.name,
            `${side} table has no row ${check.index}`,
          )
          continue
        }
        const classes = row.className.split(/\s+/).filter(Boolean)
        const expectedClasses = tableRowMarkers[check.kind]
        if (expectedClasses === undefined) {
          problem(
            scenario.name,
            `unknown table row kind ${check.kind}`,
          )
          continue
        }
        for (const className of expectedClasses) {
          if (!classes.includes(className)) {
            problem(
              scenario.name,
              `${side} row ${check.index} is missing ${className} (${row.className || 'no class'})`,
            )
          }
        }
        const expectedGap =
          check.kind === 'gap-ins'
            ? 'ins'
            : check.kind === 'gap-del'
              ? 'del'
              : ''
        if (row.gap !== expectedGap) {
          problem(
            scenario.name,
            `${side} row ${check.index} gap ${row.gap || 'none'}, expected ${expectedGap || 'none'}`,
          )
        }
        if (check.section !== undefined && row.section !== check.section) {
          problem(
            scenario.name,
            `${side} row ${check.index} is in ${row.section || 'no section'}, expected ${check.section}`,
          )
        }
        const text = tableCellText(row)
        if (check.text !== undefined && text !== check.text) {
          problem(
            scenario.name,
            `${side} row ${check.index} text ${JSON.stringify(text)}, expected ${JSON.stringify(check.text)}`,
          )
        }
        const tint = tableTints[check.tint]
        if (tint === undefined) {
          problem(scenario.name, `unknown table row tint ${check.tint}`)
        } else {
          const colors = [
            row.background,
            ...row.cells.map((cell) => cell.background),
          ]
          if (!colors.some((color) => tint.test(color))) {
            problem(
              scenario.name,
              `${side} row ${check.index} is not ${check.tint}: ${colors.join(', ')}`,
            )
          }
        }
      }
    }
  }

  if (scenario.columnChecks !== undefined) {
    const {
      table: tableIndex = 0,
      counts = {},
      cells: cellChecks = {},
    } = scenario.columnChecks
    for (const [side, expected] of Object.entries(counts)) {
      const actual = metrics.tableColumnCounts[side]?.[tableIndex] ?? 0
      if (actual !== expected) {
        problem(
          scenario.name,
          `${side} table ${tableIndex} column count ${actual}, expected ${expected}`,
        )
      }
    }
    const columnMarkers = {
      'gap-ins': ['adoc-diff-col-gap', 'adoc-diff-gap-ins'],
      'gap-del': ['adoc-diff-col-gap', 'adoc-diff-gap-del'],
      'cell-ins': ['adoc-diff-cell-ins'],
      'cell-del': ['adoc-diff-cell-del'],
    }
    for (const [side, checks] of Object.entries(cellChecks)) {
      const table = metrics.tableRows[side]?.[tableIndex] ?? []
      for (const check of checks) {
        const row = table[check.row]
        const cell = row?.cells?.[check.column]
        if (cell === undefined) {
          problem(
            scenario.name,
            `${side} table ${tableIndex} has no cell ${check.row}:${check.column}`,
          )
          continue
        }
        const classes = cell.className.split(/\s+/).filter(Boolean)
        const expectedClasses = columnMarkers[check.kind]
        if (expectedClasses === undefined) {
          problem(scenario.name, `unknown column cell kind ${check.kind}`)
          continue
        }
        for (const className of expectedClasses) {
          if (!classes.includes(className)) {
            problem(
              scenario.name,
              `${side} cell ${check.row}:${check.column} is missing ${className} (${cell.className || 'no class'})`,
            )
          }
        }
        if (check.tag !== undefined && cell.tag !== check.tag) {
          problem(
            scenario.name,
            `${side} cell ${check.row}:${check.column} is ${cell.tag}, expected ${check.tag}`,
          )
        }
        if (check.text !== undefined && cell.text !== check.text) {
          problem(
            scenario.name,
            `${side} cell ${check.row}:${check.column} text ${JSON.stringify(cell.text)}, expected ${JSON.stringify(check.text)}`,
          )
        }
        const tint = tableTints[check.tint]
        if (tint === undefined) {
          problem(scenario.name, `unknown column cell tint ${check.tint}`)
        } else if (!tint.test(cell.background)) {
          problem(
            scenario.name,
            `${side} cell ${check.row}:${check.column} is not ${check.tint}: ${cell.background}`,
          )
        }
      }
    }
  }

  if (scenario.listChecks !== undefined) {
    const { items: itemChecks = {}, cellChanged } = scenario.listChecks
    if (
      cellChanged !== undefined &&
      (metrics.cellChanged > 0) !== cellChanged
    ) {
      problem(
        scenario.name,
        `cell-changed marker ${cellChanged ? 'missing' : 'unexpected'} (${metrics.cellChanged})`,
      )
    }
    const listKinds = {
      ins: ['adoc-diff-block-ins'],
      del: ['adoc-diff-block-del'],
      moved: ['adoc-diff-moved'],
      changed: ['adoc-diff-block-changed'],
    }
    for (const [side, checks] of Object.entries(itemChecks)) {
      const items = metrics.listItems[side] ?? []
      for (const check of checks) {
        const item = items.find(
          (candidate) =>
            candidate.text === check.text &&
            (check.depth === undefined || candidate.depth === check.depth),
        )
        if (item === undefined) {
          problem(
            scenario.name,
            `${side} has no list item ${JSON.stringify(check.text)} at depth ${check.depth ?? '*'}`,
          )
          continue
        }
        const expectedClasses = listKinds[check.kind]
        if (expectedClasses === undefined) {
          problem(scenario.name, `unknown list item kind ${check.kind}`)
          continue
        }
        const classes =
          check.kind === 'changed'
            ? item.paragraphClassName.split(/\s+/).filter(Boolean)
            : `${item.className} ${item.listClassName}`
                .split(/\s+/)
                .filter(Boolean)
        for (const className of expectedClasses) {
          if (!classes.includes(className)) {
            problem(
              scenario.name,
              `${side} list item ${JSON.stringify(check.text)} is missing ${className} (${classes.join(' ') || 'no class'})`,
            )
          }
        }
        if (check.depth !== undefined && item.depth !== check.depth) {
          problem(
            scenario.name,
            `${side} list item ${JSON.stringify(check.text)} is at depth ${item.depth}, expected ${check.depth}`,
          )
        }
        const tint = tableTints[check.tint]
        if (check.tint !== undefined) {
          if (tint === undefined) {
            problem(scenario.name, `unknown list item tint ${check.tint}`)
          } else if (
            !tint.test(item.background) &&
            !tint.test(item.listBackground)
          ) {
            problem(
              scenario.name,
              `${side} list item ${JSON.stringify(check.text)} is not ${check.tint}: ${item.background} / ${item.listBackground}`,
            )
          }
        }
      }
    }
  }

  if (scenario.codeChecks !== undefined) {
    for (const [side, expected] of Object.entries(scenario.codeChecks)) {
      const actual = metrics.codeLines[side]
      for (const key of [
        'changed',
        'add',
        'del',
        'gap',
        'wordsDel',
        'wordsIns',
      ]) {
        if (expected[key] === undefined) {
          continue
        }
        if (actual[key] !== expected[key]) {
          problem(
            scenario.name,
            `${side} code ${key} ${actual[key]}, expected ${expected[key]}`,
          )
        }
      }
    }
  }

  if (scenario.textChecks !== undefined) {
    const {
      left = {},
      right = {},
      stats = {},
      noChanges = false,
      nonVisualKinds = [],
    } = scenario.textChecks
    if (noChanges && diff.stats.changes !== 0) {
      problem(
        scenario.name,
        `expected no changes, got ${diff.stats.changes}`,
      )
    }
    for (const [key, expected] of Object.entries(stats)) {
      if (diff.stats[key] !== expected) {
        problem(
          scenario.name,
          `stats.${key}=${diff.stats[key]}, expected ${expected}`,
        )
      }
    }
    for (const [side, expected] of [
      ['left', left],
      ['right', right],
    ]) {
      for (const key of ['del', 'ins']) {
        if (expected[key] === undefined) {
          continue
        }
        const actual = metrics.wordTexts[side][key]
        if (JSON.stringify(actual) !== JSON.stringify(expected[key])) {
          problem(
            scenario.name,
            `${side} word ${key} ${JSON.stringify(actual)}, expected ${JSON.stringify(expected[key])}`,
          )
        }
      }
    }
    if (nonVisualKinds.length > 0) {
      const actualKinds = metrics.nonVisual.map((entry) => entry[0])
      if (JSON.stringify(actualKinds) !== JSON.stringify(nonVisualKinds)) {
        problem(
          scenario.name,
          `non-visual kinds ${JSON.stringify(actualKinds)}, expected ${JSON.stringify(nonVisualKinds)}`,
        )
      }
    }
  }

  if (scenario.sectionChecks !== undefined) {
    const { stats = {}, left = [], right = [] } = scenario.sectionChecks
    for (const [key, expected] of Object.entries(stats)) {
      if (diff.stats[key] !== expected) {
        problem(
          scenario.name,
          `stats.${key}=${diff.stats[key]}, expected ${expected}`,
        )
      }
    }
    const sectionKinds = {
      ins: 'adoc-diff-block-ins',
      del: 'adoc-diff-block-del',
      moved: 'adoc-diff-moved',
    }
    for (const [side, checks] of [
      ['left', left],
      ['right', right],
    ]) {
      const list = metrics.sections[side]
      for (const check of checks) {
        const expectedClass =
          check.kind === undefined ? undefined : sectionKinds[check.kind]
        const section = list.find(
          (candidate) =>
            candidate.title === check.title &&
            (check.depth === undefined || candidate.depth === check.depth) &&
            (expectedClass === undefined ||
              candidate.className.split(/\s+/).includes(expectedClass)),
        )
        if (section === undefined) {
          problem(
            scenario.name,
            `${side} has no section ${JSON.stringify(check.title)}` +
              (check.kind ? ` with kind ${check.kind}` : '') +
              (check.depth ? ` at depth ${check.depth}` : ''),
          )
          continue
        }
        if (
          check.collapsed !== undefined &&
          section.collapsed !== check.collapsed
        ) {
          problem(
            scenario.name,
            `${side} section ${JSON.stringify(check.title)} collapsed=${section.collapsed}, expected ${check.collapsed}`,
          )
        }
        if (
          check.collapseLines !== undefined &&
          section.collapseLines !== String(check.collapseLines)
        ) {
          problem(
            scenario.name,
            `${side} section ${JSON.stringify(check.title)} collapse lines ${section.collapseLines}, expected ${check.collapseLines}`,
          )
        }
        if (
          check.headingChanged !== undefined &&
          section.headingClassName
            .split(/\s+/)
            .includes('adoc-diff-block-changed') !== check.headingChanged
        ) {
          problem(
            scenario.name,
            `${side} section ${JSON.stringify(check.title)} heading changed ${section.headingClassName || 'no'}, expected ${check.headingChanged}`,
          )
        }
        if (check.gap !== undefined) {
          const actualGap = section.gap || section.gapAfter
          if (actualGap !== check.gap) {
            problem(
              scenario.name,
              `${side} section ${JSON.stringify(check.title)} gap ${actualGap || 'none'}, expected ${check.gap}`,
            )
          }
        }
        if (
          check.gapCount !== undefined &&
          section.gapCount !== String(check.gapCount)
        ) {
          problem(
            scenario.name,
            `${side} section ${JSON.stringify(check.title)} gap count ${section.gapCount}, expected ${check.gapCount}`,
          )
        }
        if (
          check.gapObject !== undefined &&
          section.gapObject !== check.gapObject
        ) {
          problem(
            scenario.name,
            `${side} section ${JSON.stringify(check.title)} gap object ${section.gapObject || 'none'}, expected ${check.gapObject}`,
          )
        }
      }
    }
  }

  // Navigate through all hunks and record the status text.
  const navigation = await page.evaluate(async () => {
    const status = document.getElementById('diff-status')
    const seen = []
    // A non-visual-only diff shows "No visual text differences — N changes"
    // instead of an `i / N` counter, so read the hunk count from the DOM.
    const total = new Set(
      [...document.querySelectorAll('[data-adoc-diff-hunk]')].map((el) =>
        el.getAttribute('data-adoc-diff-hunk'),
      ),
    ).size
    for (let index = 0; index < total; index++) {
      status.click()
      await new Promise((resolve) => setTimeout(resolve, 90))
      seen.push(status.textContent)
    }
    return { seen, total }
  })
  if (navigation.total !== metrics.hunkCount) {
    problem(
      scenario.name,
      `status total ${navigation.total} but DOM hunks ${metrics.hunkCount}`,
    )
  }

  await page.screenshot({
    path: path.join('manual-check', 'screens', `${scenario.name}.png`),
  })
  await page.close()

  results.push({
    name: scenario.name,
    stats: diff.stats,
    union: union.length,
    metrics,
    navigation,
  })
}

await browser.close()

const report = {
  generatedAt: new Date().toISOString(),
  results,
  problems,
}
await writeFile(
  path.join('manual-check', 'report.json'),
  JSON.stringify(report, null, 2),
)
console.log('\n=== PROBLEMS ===')
for (const item of problems) console.log(item)
console.log('\nreport written to manual-check/report.json')
