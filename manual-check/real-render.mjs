import { mkdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { scenarios } from './scenarios.mjs'

const require = createRequire(import.meta.url)
const { convertForPreview, resolveWebviewResources } = require(
  '../build/src/features/preview/previewConversion.js',
)
const { previewRequest, fakeHost } = require('../build/src/test/unit/previewFixtures.js')
const { renderDiff } = require('../build/src/features/diff/renderDiff.js')
const { buildDiffDocument } = require('../build/src/features/diff/diffDocument.js')
const { defaultDiffRenderOptions } = require('../build/src/features/diff/blockDiff.js')

const PORT = 48123
const ORIGIN = `http://127.0.0.1:${PORT}`
const repo = process.cwd()

const strings = {
  rendering: 'Rendering…', noDifferences: 'No differences', noVisualDifferences: 'No visual differences',
  error: 'Unable to render the diff', old: 'old', new: 'new', swap: 'Swap',
  nonVisualFormatting: 'Formatting was changed here', nonVisualLink: 'Link target was changed here', nonVisualId: 'Anchor id was changed here',
  blockChanged: 'Changed block', mediaChanged: 'Changed image or diagram',
  shellDiffers: 'The documents use different preview shells; some styles may not match.',
  statusSummary: '{0} change regions · +{1} added blocks · −{2} removed blocks', statusNonVisual: '{0} formatting / {1} link / {2} id changes',
  statusJump: 'Click for the next change, Shift+click for the previous', collapseExpand: 'Click to expand deleted block', collapseCollapse: 'Click to collapse deleted block',
  collapseLabel: '{0} lines', collapseLabelWithExcerpt: '{0} lines · {1}',
  gapAddedBlocks: '{0} added blocks', gapAddedTable: '{0} added table rows', gapAddedLines: '{0} added lines',
  gapRemovedBlocks: '{0} removed blocks', gapRemovedTable: '{0} removed table rows', gapRemovedLines: '{0} removed lines',
  gapChangedBlocks: '{0} changed blocks', gapChangedTable: '{0} changed table rows', gapChangedLines: '{0} changed lines',
  gapAddedBlock: '1 added block', gapAddedTableRow: '1 added table row', gapAddedLine: '1 added line',
  gapRemovedBlock: '1 removed block', gapRemovedTableRow: '1 removed table row', gapRemovedLine: '1 removed line',
  gapChangedBlock: '1 changed block', gapChangedTableRow: '1 changed table row', gapChangedLine: '1 changed line',
}

const diffContentCss = await readFile(path.join(repo, 'media', 'diff-content.css'), 'utf8')
await mkdir(path.join(repo, 'manual-check', 'screens'), { recursive: true })

function httpUri(resource) {
  if (resource.path.startsWith('/extension/')) {
    return `${ORIGIN}${resource.path.slice('/extension'.length)}`
  }
  return `${ORIGIN}${resource.path}`
}

async function convert(text) {
  const result = await convertForPreview(
    previewRequest(text, { attributes: { 'data-uri': '' } }),
    fakeHost({}).host,
  )
  return resolveWebviewResources(result.html, result.resources, httpUri)
}

function contentType(file) {
  if (file.endsWith('.js') || file.endsWith('.mjs')) return 'text/javascript'
  if (file.endsWith('.css')) return 'text/css'
  if (file.endsWith('.svg')) return 'image/svg+xml'
  if (file.endsWith('.wasm')) return 'application/wasm'
  if (file.endsWith('.json')) return 'application/json'
  if (file.endsWith('.woff2')) return 'font/woff2'
  if (file.endsWith('.woff')) return 'font/woff'
  return 'text/plain'
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
for (const name of ['code-json', 'callouts', 'diagrams']) {
  const scenario = scenarios.find((item) => item.name === name)
  const [left, right] = await Promise.all([convert(scenario.old), convert(scenario.new)])
  const diff = renderDiff(left, right, defaultDiffRenderOptions)
  const html = buildDiffDocument({
    leftHtml: diff.leftHtml,
    rightHtml: diff.rightHtml,
    diffScriptUri: `${ORIGIN}/diff.js`,
    diffCssUri: `${ORIGIN}/diff.css`,
    diffContentCss,
    leftTitle: 'v1/index.adoc',
    rightTitle: 'v2/index.adoc',
    strings,
    lineMap: diff.lineMap,
    leftLineCount: diff.leftLineCount,
    rightLineCount: diff.rightLineCount,
    version: 1,
    stats: diff.stats,
    options: defaultDiffRenderOptions,
  }).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/gi, '')

  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url())
    let file = path.join(repo, decodeURIComponent(url.pathname))
    if (url.pathname === '/diff.js') file = path.join(repo, 'dist', 'diff.js')
    if (url.pathname === '/diff.css') file = path.join(repo, 'media', 'diff.css')
    try {
      const body = await readFile(file)
      await route.fulfill({ status: 200, contentType: contentType(file), body })
    } catch {
      await route.fulfill({ status: 404, body: '' })
    }
  })
  await page.setContent(html, { waitUntil: 'load' })
  await page.waitForTimeout(3500)
  const metrics = await page.evaluate(() => {
    const codeLines = document.querySelectorAll('.adoc-diff-code-line')
    const highlighted = document.querySelectorAll(
      '.adoc-diff-code-line .hljs-keyword, .adoc-diff-code-line .hljs-string, .adoc-diff-code-line .hljs-attr, .adoc-diff-code-line .hljs-number, .adoc-diff-code-line .hljs-punctuation',
    )
    return {
      status: document.getElementById('diff-status')?.textContent,
      codeLines: codeLines.length,
      highlighted: highlighted.length,
      svgs: document.querySelectorAll('svg').length,
      mermaidDivs: document.querySelectorAll('.mermaid').length,
      plantumlErrors: document.querySelectorAll('.plantuml-error').length,
      mediaChanged: document.querySelectorAll('.adoc-diff-media-changed').length,
      mediaHostMarked: document.querySelectorAll('[data-adoc-diff-media-changed]').length,
      mediaIcons: [...document.querySelectorAll('[data-adoc-diff-icon][data-adoc-diff-media-changed]')].filter((host) =>
        getComputedStyle(host, '::before').content === '"~"',
      ).length,
      mermaidHosted: [...document.querySelectorAll('.mermaid')].filter((diagram) =>
        diagram.closest('[data-adoc-diff-media-changed]'),
      ).length,
      anchorMax: (() => {
        const left = document.getElementById('diff-left')
        const right = document.getElementById('diff-right')
        const l = new Map([...left.querySelectorAll('[data-adoc-diff-anchor]')].filter((e) => e.getClientRects().length).map((e) => [e.getAttribute('data-adoc-diff-anchor'), e]))
        let max = 0
        for (const re of right.querySelectorAll('[data-adoc-diff-anchor]')) {
          if (!re.getClientRects().length) continue
          const le = l.get(re.getAttribute('data-adoc-diff-anchor'))
          if (!le) continue
          max = Math.max(max, Math.abs(le.getBoundingClientRect().top - re.getBoundingClientRect().top))
        }
        return max
      })(),
    }
  })
  console.log(name, JSON.stringify({ ...metrics, stats: diff.stats, errors }))
  await page.screenshot({ path: `manual-check/screens/real-${name}.png` })
  await page.close()
}
await browser.close()
