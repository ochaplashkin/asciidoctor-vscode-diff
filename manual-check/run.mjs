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

async function convert(text) {
  const result = await convertForPreview(
    previewRequest(text, { attributes: { 'data-uri': '' } }),
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

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = []

const only = process.env.SCENARIO
for (const scenario of scenarios) {
  if (only !== undefined && only !== '' && scenario.name !== only) continue
  process.stdout.write(`\n=== ${scenario.name}\n`)
  const [oldHtml, newHtml] = await Promise.all([
    convert(scenario.old),
    convert(scenario.new),
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
    return {
      status: status?.textContent,
      className: status?.className,
      stats: settings.stats,
      anchors: anchorDeltas.length,
      maxAnchorDelta: anchorDeltas[0]?.delta ?? 0,
      worstAnchors: anchorDeltas.slice(0, 3),
      grids,
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

  // Navigate through all hunks and record the status text.
  const navigation = await page.evaluate(async () => {
    const status = document.getElementById('diff-status')
    const seen = []
    const total = Number(
      (status.textContent ?? '').split('/')[1]?.trim() ?? 0,
    )
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
