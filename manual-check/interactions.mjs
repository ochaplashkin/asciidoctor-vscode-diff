import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
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

const diffCss = await readFile('media/diff.css', 'utf8')
const diffContentCss = await readFile('media/diff-content.css', 'utf8')
const diffJs = await readFile('dist/diff.js', 'utf8')
await mkdir('manual-check/screens', { recursive: true })

function preview(body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="preview-root">${body}</div></body></html>`
}

function inline(html) {
  return html
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/gi, '')
    .replace(
      /<link rel="stylesheet" type="text\/css" href="diff.css">/g,
      `<style>${diffCss}</style>`,
    )
    .replace('<script src="diff.js"></script>', `<script>${diffJs}</script>`)
}

function build(leftBody, rightBody, options = {}, extra = {}) {
  const result = renderDiff(preview(leftBody), preview(rightBody), {
    ...defaultDiffRenderOptions,
    ...options,
  })
  const html = buildDiffDocument({
    leftHtml: result.leftHtml,
    rightHtml: result.rightHtml,
    diffScriptUri: 'diff.js',
    diffCssUri: 'diff.css',
    diffContentCss,
    leftTitle: 'v1/index.adoc',
    rightTitle: 'v2/index.adoc',
    strings,
    lineMap: result.lineMap,
    leftLineCount: result.leftLineCount,
    rightLineCount: result.rightLineCount,
    version: 1,
    stats: result.stats,
    options: { ...defaultDiffRenderOptions, ...options },
    ...extra,
  })
  return { result, html: inline(html) }
}

const problems = []
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`)
  } else {
    console.log(`FAIL ${name}${detail ? ` (${detail})` : ''}`)
    problems.push(`${name}${detail ? `: ${detail}` : ''}`)
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function withPage(html, run) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.setContent(html, { waitUntil: 'load' })
  await page.waitForTimeout(1900)
  const result = await run(page)
  await page.close()
  return { ...result, pageErrors: errors }
}

/* 1. Twelve change regions: click cycles and wraps. */
{
  const rows = Array.from({ length: 36 }, (_, index) => index + 1)
  const left = rows
    .map((n) =>
      n % 3 === 0
        ? `<p class="data-line-${n}">paragraph ${n} old</p>`
        : `<p class="data-line-${n}">paragraph ${n}</p>`,
    )
    .join('')
  const right = rows
    .map((n) =>
      n % 3 === 0
        ? `<p class="data-line-${n}">paragraph ${n} new</p>`
        : `<p class="data-line-${n}">paragraph ${n}</p>`,
    )
    .join('')
  const built = build(left, right)
  const { pageErrors, ...r } = await withPage(built.html, async (page) =>
    page.evaluate(async () => {
      const status = document.getElementById('diff-status')
      const total = Number((status.textContent ?? '').split('/')[1]?.trim())
      const seen = []
      const scrolls = []
      for (let index = 0; index < total + 1; index++) {
        status.click()
        await new Promise((resolve) => setTimeout(resolve, 70))
        seen.push(status.textContent)
        scrolls.push(document.getElementById('diff-left').scrollTop)
      }
      const target = document.querySelector('.adoc-diff-hunk-target')
      return { total, seen, scrolls, target: Boolean(target) }
    }),
  )
  check('twelve-hunks-total', r.total === 12, `total=${r.total}`)
  check(
    'twelve-hunks-visit',
    r.seen.slice(0, 12).every((text, index) => text === `${index + 1} / 12`),
    r.seen.join(','),
  )
  check('twelve-hunks-wrap', r.seen[12] === '1 / 12', `after wrap ${r.seen[12]}`)
  check('twelve-hunks-target', r.target, 'flash target missing')
  check('twelve-hunks-errors', pageErrors.length === 0, pageErrors.join('|'))
}

/* 2. showStats=false keeps the navigator and hides the legend. */
{
  const filler = Array.from(
    { length: 30 },
    (_, index) => `<p class="data-line-${index + 4}">Filler ${index + 1}</p>`,
  ).join('')
  const built = build(
    `<p class="data-line-1">A</p><p class="data-line-2">old</p><p class="data-line-3">B</p>${filler}`,
    `<p class="data-line-1">A</p><p class="data-line-2">new</p><p class="data-line-3">B</p>${filler}`,
    { showStats: false },
  )
  const { pageErrors, ...r } = await withPage(built.html, async (page) =>
    page.evaluate(async () => {
      const status = document.getElementById('diff-status')
      const legend = document.getElementById('diff-legend')
      status.click()
      await new Promise((resolve) => setTimeout(resolve, 200))
      return {
        text: status.textContent,
        legendHidden: legend?.hidden,
        scroll: document.getElementById('diff-left').scrollTop,
      }
    }),
  )
  check('showStats-navigator', r.text === '1 / 1', r.text)
  check('showStats-legend-hidden', r.legendHidden === true, String(r.legendHidden))
  check('showStats-click', r.scroll > 0, `scroll=${r.scroll}`)
  check('showStats-errors', pageErrors.length === 0, pageErrors.join('|'))
}

/* 3. align=false: hunks still navigate, no anchors/gaps. */
{
  const built = build(
    '<p class="data-line-1">A</p><p class="data-line-2">old</p>',
    '<p class="data-line-1">A</p><p class="data-line-2">new</p>',
    { align: false },
  )
  const { pageErrors, ...r } = await withPage(built.html, async (page) =>
    page.evaluate(async () => {
      const status = document.getElementById('diff-status')
      status.click()
      await new Promise((resolve) => setTimeout(resolve, 200))
      return {
        text: status.textContent,
        anchors: document.querySelectorAll('[data-adoc-diff-anchor]').length,
        gaps: document.querySelectorAll('.adoc-diff-gap-overlay').length,
      }
    }),
  )
  check('noAlign-status', r.text === '1 / 1', r.text)
  check('noAlign-no-anchors', r.anchors === 0, String(r.anchors))
  check('noAlign-no-gaps', r.gaps === 0, String(r.gaps))
  check('noAlign-errors', pageErrors.length === 0, pageErrors.join('|'))
}

/* 4. Non-visual change only, far down: honest status plus a clickable target. */
{
  const filler = Array.from(
    { length: 30 },
    (_, index) => `<p class="data-line-${index + 1}">Filler ${index + 1}</p>`,
  ).join('')
  const built = build(
    `${filler}<p class="data-line-31"><a href="old.html">link</a></p>`,
    `${filler}<p class="data-line-31"><a href="new.html">link</a></p>`,
  )
  const { pageErrors, ...r } = await withPage(built.html, async (page) =>
    page.evaluate(async () => {
      const status = document.getElementById('diff-status')
      const icon = document.querySelector('[data-adoc-diff-nonvisual]')
      const before = document.getElementById('diff-left').scrollTop
      status.click()
      await new Promise((resolve) => setTimeout(resolve, 250))
      const style = icon ? getComputedStyle(icon, '::after') : null
      return {
        text: status.textContent,
        iconContent: style?.content,
        iconTitle: icon?.getAttribute('title'),
        before,
        after: document.getElementById('diff-left').scrollTop,
        targets: document.querySelectorAll('.adoc-diff-hunk-target').length,
      }
    }),
  )
  check('nonVisual-status', r.text === 'No visual text differences — 1 change', r.text)
  check('nonVisual-icon', r.iconContent === '"!"', String(r.iconContent))
  check('nonVisual-title', r.iconTitle === 'Link target was changed here', String(r.iconTitle))
  check('nonVisual-click-scroll', r.after > r.before, `${r.before}->${r.after}`)
  check('nonVisual-target', r.targets > 0, String(r.targets))
  check('nonVisual-errors', pageErrors.length === 0, pageErrors.join('|'))
}

/* 5. Table row hunk: the row is the target and is highlighted. */
{
  const table = (value) =>
    `<table class="tableblock"><colgroup><col width="50%"><col width="50%"></colgroup><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>one</td><td>1</td></tr><tr><td>two</td><td>${value}</td></tr><tr><td>three</td><td>3</td></tr></tbody></table>`
  const built = build(table('old'), table('new'))
  const { pageErrors, ...r } = await withPage(built.html, async (page) =>
    page.evaluate(async () => {
      const status = document.getElementById('diff-status')
      status.click()
      await new Promise((resolve) => setTimeout(resolve, 250))
      const target = document.querySelector('.adoc-diff-hunk-target')
      const cell = target?.querySelector('td')
      return {
        tag: target?.tagName,
        cellOutline: cell ? getComputedStyle(cell).outlineStyle : undefined,
        text: status.textContent,
      }
    }),
  )
  check('tableHunk-row-target', r.tag === 'TR', String(r.tag))
  check('tableHunk-cell-outline', r.cellOutline === 'solid', String(r.cellOutline))
  check('tableHunk-status', r.text === '1 / 1', r.text)
  check('tableHunk-errors', pageErrors.length === 0, pageErrors.join('|'))
}

/* 6. Collapsed deletion: navigation expands it and the gap label is visible. */
{
  const longText = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n')
  const built = build(
    `<p class="data-line-1">A</p><div class="listingblock data-line-2"><div class="content"><pre><code>${longText}</code></pre></div></div><p class="data-line-30">B</p>`,
    '<p class="data-line-1">A</p><p class="data-line-2">B</p>',
  )
  const { pageErrors, ...r } = await withPage(built.html, async (page) =>
    page.evaluate(async () => {
      const status = document.getElementById('diff-status')
      const collapsed = document.querySelector('[data-adoc-diff-collapsed]')
      const before = collapsed?.classList.contains('adoc-diff-expanded')
      status.click()
      await new Promise((resolve) => setTimeout(resolve, 300))
      const overlay = document.querySelector('.adoc-diff-gap-overlay')
      const rect = overlay?.getBoundingClientRect()
      return {
        before,
        expanded: collapsed?.classList.contains('adoc-diff-expanded'),
        overlayText: overlay?.textContent,
        overlayTop: rect?.top,
        gapLabels: document.querySelectorAll('[data-adoc-diff-gap-label]').length,
      }
    }),
  )
  check('collapse-expanded', r.before === false && r.expanded === true, `${r.before}->${r.expanded}`)
  check('collapse-overlay-empty', r.overlayText === '', String(r.overlayText))
  check('collapse-overlay-visible', typeof r.overlayTop === 'number', String(r.overlayTop))
  check('collapse-errors', pageErrors.length === 0, pageErrors.join('|'))
}

/* 7. In-page link in the right pane scrolls the right pane. */
{
  const filler = (prefix) =>
    Array.from(
      { length: 25 },
      (_, index) =>
        `<p class="data-line-${index + 1}">${prefix} ${index + 1}</p>`,
    ).join('')
  const after = Array.from(
    { length: 30 },
    (_, index) =>
      `<p class="data-line-${index + 41}">After ${index + 1}</p>`,
  ).join('')
  const left = `<p class="data-line-1"><a href="#left-target">go left</a></p>${filler('left')}<h2 id="left-target" class="data-line-40">Left target</h2>${after}`
  const right = `<p class="data-line-1"><a href="#right-target">go right</a></p>${filler('right')}<h2 id="right-target" class="data-line-40">Right target</h2>${after}`
  const built = build(left, right)
  const { pageErrors, ...r } = await withPage(built.html, async (page) =>
    page.evaluate(async () => {
      const leftPane = document.getElementById('diff-left')
      const rightPane = document.getElementById('diff-right')
      const beforeLeft = leftPane.scrollTop
      const beforeRight = rightPane.scrollTop
      const link = rightPane.querySelector('a[href="#right-target"]')
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 350))
      const target = [...rightPane.querySelectorAll('[id]')].find(
        (el) => el.id === 'right-target',
      )
      const leftTarget = [...leftPane.querySelectorAll('[id]')].find(
        (el) => el.id === 'left-target',
      )
      return {
        beforeLeft,
        beforeRight,
        leftTop: leftPane.scrollTop,
        rightTop: rightPane.scrollTop,
        rightOffset: target
          ? target.getBoundingClientRect().top - rightPane.getBoundingClientRect().top
          : undefined,
        leftOffset: leftTarget
          ? leftTarget.getBoundingClientRect().top - leftPane.getBoundingClientRect().top
          : undefined,
        href: link.getAttribute('href'),
      }
    }),
  )
  check('link-raw-href', r.href === '#right-target', String(r.href))
  check('link-right-scrolls', r.rightTop > r.beforeRight, `${r.beforeRight}->${r.rightTop}`)
  check('link-right-target', Math.abs(r.rightOffset ?? 999) < 20, String(r.rightOffset))
  check('link-errors', pageErrors.length === 0, pageErrors.join('|'))
}

/* 8. Restore by source line and expanded state. */
{
  const longText = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n')
  const filler = Array.from(
    { length: 40 },
    (_, index) => `<p class="data-line-${index + 1}">Filler ${index + 1}</p>`,
  ).join('')
  const left = `${filler}<div class="listingblock data-line-42"><div class="content"><pre><code>${longText}</code></pre></div></div>`
  const right = `${filler}`
  const result = renderDiff(preview(left), preview(right), defaultDiffRenderOptions)
  const collapseKey = /data-adoc-diff-collapse-key="([^"]+)"/.exec(result.leftHtml)?.[1]
  const html = buildDiffDocument({
    leftHtml: result.leftHtml,
    rightHtml: result.rightHtml,
    diffScriptUri: 'diff.js',
    diffCssUri: 'diff.css',
    diffContentCss,
    leftTitle: 'v1/index.adoc',
    rightTitle: 'v2/index.adoc',
    strings,
    lineMap: result.lineMap,
    leftLineCount: result.leftLineCount,
    rightLineCount: result.rightLineCount,
    leftLine: 30,
    rightLine: 30,
    expanded: collapseKey ? [collapseKey] : [],
    version: 1,
    stats: result.stats,
    options: defaultDiffRenderOptions,
  })
  const { pageErrors, ...r } = await withPage(inline(html), async (page) =>
    page.evaluate(() => ({
      leftTop: document.getElementById('diff-left').scrollTop,
      rightTop: document.getElementById('diff-right').scrollTop,
      expanded: Boolean(
        document.querySelector('[data-adoc-diff-collapsed].adoc-diff-expanded'),
      ),
      status: document.getElementById('diff-status').textContent,
    })),
  )
  check('restore-left', r.leftTop > 0, String(r.leftTop))
  check('restore-right', r.rightTop > 0, String(r.rightTop))
  check('restore-expanded', r.expanded === true, String(r.expanded))
  check('restore-errors', pageErrors.length === 0, pageErrors.join('|'))
}

/* 9. Busy keeps the old summary instead of replacing it immediately. */
{
  const built = build(
    '<p class="data-line-1">A</p><p class="data-line-2">old</p>',
    '<p class="data-line-1">A</p><p class="data-line-2">new</p>',
  )
  const { pageErrors, ...r } = await withPage(built.html, async (page) =>
    page.evaluate(async () => {
      const status = document.getElementById('diff-status')
      const before = status.textContent
      window.postMessage({ type: 'setBusy', busy: true }, '*')
      await new Promise((resolve) => setTimeout(resolve, 100))
      const during = status.textContent
      const busyClass = status.className
      window.postMessage({ type: 'setBusy', busy: false }, '*')
      await new Promise((resolve) => setTimeout(resolve, 100))
      return { before, during, busyClass, after: status.textContent }
    }),
  )
  check('busy-keeps-summary', r.during === r.before, `${r.before}->${r.during}`)
  check('busy-class', r.busyClass.includes('diff-status-busy'), r.busyClass)
  check('busy-cleared', r.after === r.before, `${r.before}->${r.after}`)
  check('busy-errors', pageErrors.length === 0, pageErrors.join('|'))
}

/* 10. TOC-only change: reported, but the TOC itself is not rendered. */
{
  const filler = Array.from(
    { length: 80 },
    (_, i) => `<p class="data-line-${i + 2}">Filler paragraph ${i}.</p>`,
  ).join('')
  const withToc = (entry) =>
    `<div id="header"><h1>Manual</h1><div id="toc" class="toc2"><div id="toctitle">Table of Contents</div><ul><li><a href="#_one">${entry}</a></li></ul></div></div><div id="content"><p class="data-line-1">A</p>${filler}</div>`
  const built = build(withToc('Old heading'), withToc('New heading'))
  const { pageErrors, ...r } = await withPage(built.html, async (page) =>
    page.evaluate(async () => {
      const status = document.getElementById('diff-status')
      return {
        text: status.textContent,
        className: status.className,
        title: status.title,
        clickable: status.getAttribute('role') === 'button' && status.tabIndex === 0,
        hunks: document.querySelectorAll('[data-adoc-diff-hunk]').length,
        toc: Boolean(document.querySelector('#diff-left #toc')),
        navigationMarkers: document.querySelectorAll(
          '[data-adoc-diff-navigation]',
        ).length,
        paneWithToc: document
          .getElementById('diff-left')
          .classList.contains('diff-pane-with-toc'),
      }
    }),
  )
  check(
    'navigation-stats',
    built.result.stats.navigationChanges === 1,
    String(built.result.stats.navigationChanges),
  )
  check('navigation-no-hunks', r.hunks === 0, String(r.hunks))
  check(
    'navigation-status',
    r.text === 'No visual text differences — 1 navigation change',
    r.text,
  )
  check('navigation-class', r.className.includes('diff-status-navigation'), r.className)
  check(
    'navigation-not-clickable',
    !r.className.includes('diff-status-clickable') && !r.clickable,
    `${r.className} role=${r.clickable}`,
  )
  check('navigation-no-toc', !r.toc, String(r.toc))
  check(
    'navigation-no-markers',
    r.navigationMarkers === 0,
    String(r.navigationMarkers),
  )
  check(
    'navigation-no-pane-padding',
    !r.paneWithToc,
    String(r.paneWithToc),
  )
  check(
    'navigation-tooltip',
    r.title === 'Table of contents changed',
    String(r.title),
  )
  check('navigation-errors', pageErrors.length === 0, pageErrors.join('|'))
}

/* 11. Swap button posts the swap request to the host. */
{
  const built = build(
    '<p class="data-line-1">A</p>',
    '<p class="data-line-1">B</p>',
  )
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  // `setContent` does not run `addInitScript`, so define the host API in a
  // script that precedes the diff client in the document head.
  const withApi = built.html.replace(
    '<head>',
    `<head><script>
      window.__adocDiffMessages = [];
      window.acquireVsCodeApi = () => ({
        postMessage: (message) => window.__adocDiffMessages.push(message),
      });
    </script>`,
  )
  await page.setContent(withApi, { waitUntil: 'load' })
  await page.waitForTimeout(400)
  const messages = await page.evaluate(() => {
    document.getElementById('diff-swap').click()
    return window.__adocDiffMessages
  })
  check(
    'swap-message',
    messages.some((message) => message.type === 'swap'),
    JSON.stringify(messages),
  )
  check('swap-errors', pageErrors.length === 0, pageErrors.join('|'))
  await page.close()
}

await browser.close()
console.log('\nPROBLEMS:', problems.length)
for (const item of problems) console.log('-', item)
process.exitCode = problems.length > 0 ? 1 : 0
