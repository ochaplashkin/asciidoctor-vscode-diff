// Manual browser check of the preview-first chrome: renders a real preview
// with `asciidoc.preview.openInPreview` enabled, loads the real preview client
// scripts and verifies the in-page "View Source Code" action.
//
// Run from the repository root after `npm run build && npm run build-test`:
//   node manual-check/source-button.mjs
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const { convertForPreview, resolveWebviewResources } = require(
  '../build/src/features/preview/previewConversion.js',
)
const { previewRequest, fakeHost, fileUri } = require(
  '../build/src/test/unit/previewFixtures.js',
)

const ORIGIN = 'http://127.0.0.1:48124'
const repo = process.cwd()
await mkdir(path.join(repo, 'manual-check', 'screens'), { recursive: true })

const doc = `= Preview-first mode
:description: A rendered document that shows the source action

== Introduction

The document opens as a rendered page when **Open Files in Preview Mode** is on.

* The source editor is not opened.
* A **View Source Code** action is available at the top.

== A second section

Some more text so the page has a little height.
`

const base = previewRequest(doc)
const request = {
  ...base,
  contributions: {
    previewScripts: [fileUri('/extension/dist/index.js')],
    previewStyles: [
      fileUri('/extension/media/editor-selection.css'),
      fileUri('/extension/media/preview-chrome.css'),
    ],
  },
  config: { ...base.config, openInPreview: true },
  strings: {
    ...base.strings,
    preview: {
      ...base.strings.preview,
      viewSourceCode: 'View Source Code',
    },
  },
}

const result = await convertForPreview(request, fakeHost({}).host)
// `acquireVsCodeApi` is injected by VS Code in a real webview; provide the
// same tiny surface in a plain page so the real client bundle can run.
const vscodeApiStub = `<script>window.__messages=[];window.acquireVsCodeApi=function(){return{getState:function(){return{}},setState:function(){},postMessage:function(message){window.__messages.push(message)}}};</script>
<style>
/* The webview provides the VS Code theme variables; mirror them for the
 * standalone screenshot. */
:root {
  --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", sans-serif;
  --vscode-editor-background: #ffffff;
  --vscode-button-background: #0078d4;
  --vscode-button-foreground: #ffffff;
  --vscode-button-secondaryBackground: #e5e5e5;
  --vscode-button-secondaryForeground: #3b3b3b;
  --vscode-button-secondaryHoverBackground: #cccccc;
  --vscode-panel-border: rgba(128, 128, 128, 0.35);
  --vscode-focusBorder: #0090f1;
  --vscode-textLink-foreground: #006ab1;
  --vscode-textLink-activeForeground: #005a9e;
}
body { background: var(--vscode-editor-background); }
</style>`
const html = resolveWebviewResources(
  result.html,
  result.resources,
  (resource) => `${ORIGIN}${resource.path}`,
)
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/gi, '')
  .replace('<head>', `<head>${vscodeApiStub}`)

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const errors = []
const logs = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`))

await page.route(`${ORIGIN}/**`, async (route) => {
  const url = new URL(route.request().url())
  const relative = url.pathname.replace(/^\/extension/, '')
  const file = path.join(repo, decodeURIComponent(relative))
  try {
    const body = await readFile(file)
    const type = file.endsWith('.js') || file.endsWith('.mjs')
      ? 'text/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : 'application/octet-stream'
    await route.fulfill({ status: 200, contentType: type, body })
  } catch {
    await route.fulfill({ status: 404, body: '' })
  }
})

await page.setContent(html, { waitUntil: 'load' })
try {
  await page.waitForSelector('#preview-source-bar', { timeout: 5000 })
} catch (error) {
  const status = await page.evaluate(() => ({
    body: document.body.innerHTML.slice(0, 500),
    scripts: [...document.scripts].map((s) => ({ src: s.src, type: s.type })),
    settings: document
      .getElementById('vscode-asciidoc-preview-data')
      ?.getAttribute('data-settings'),
  }))
  console.log(JSON.stringify({ status, errors, logs }, null, 2))
  throw error
}

const before = await page.evaluate(() => {
  const bar = document.getElementById('preview-source-bar')
  const button = bar?.querySelector('button')
  return {
    firstChild: document.body.firstElementChild?.id,
    label: button?.textContent,
    top: bar?.getBoundingClientRect().top,
    position: getComputedStyle(bar).position,
    buttonColor: button ? getComputedStyle(button).color : undefined,
  }
})
await page.screenshot({
  path: path.join(repo, 'manual-check', 'screens', 'source-button-link.png'),
})

// Variant: a top toolbar with a filled secondary button.
const topBar = await page.addStyleTag({
  content: `
    .preview-source-bar {
      margin: 0 0 12px;
      padding: 8px 0;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    }
    .preview-source-button {
      padding: 3px 9px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 2px;
      background: var(--vscode-button-secondaryBackground, #e5e5e5);
      color: var(--vscode-button-secondaryForeground, #3b3b3b);
    }
    .preview-source-button:hover {
      background: var(--vscode-button-secondaryHoverBackground, #cccccc);
      text-decoration: none;
    }
  `,
})
await page.screenshot({
  path: path.join(repo, 'manual-check', 'screens', 'source-button-top-bar.png'),
})
await topBar.evaluate((element) => element.remove())

// Variant: a floating pill that stays visible while scrolling.
const floating = await page.addStyleTag({
  content: `
    .preview-source-bar {
      position: fixed;
      top: 10px;
      right: 14px;
      z-index: 10;
      margin: 0;
      padding: 0;
    }
    .preview-source-button {
      padding: 4px 12px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 999px;
      background: var(--vscode-button-secondaryBackground, #e5e5e5);
      color: var(--vscode-button-secondaryForeground, #3b3b3b);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
    }
    .preview-source-button:hover {
      background: var(--vscode-button-secondaryHoverBackground, #cccccc);
      text-decoration: none;
    }
  `,
})
await page.screenshot({
  path: path.join(repo, 'manual-check', 'screens', 'source-button-floating.png'),
})
await floating.evaluate((element) => element.remove())

await page.click('#preview-source-bar button')
const messages = await page.evaluate(() => window.__messages)

const problems = []
if (before.firstChild !== 'preview-source-bar') {
  problems.push('the bar is not the first element of the page')
}
if (before.label?.trim() !== 'View Source Code') {
  problems.push(`unexpected label: ${before.label}`)
}
if (!(before.top < 100)) {
  problems.push(`the bar is not at the top: ${before.top}`)
}
if (!messages.some((message) => message.type === 'showSource')) {
  problems.push(`the click did not post a showSource message: ${JSON.stringify(messages)}`)
}
if (errors.length > 0) {
  problems.push(`page errors: ${errors.join(' | ')}`)
}

console.log(JSON.stringify({ before, messages, errors, problems }, null, 2))
await browser.close()
if (problems.length > 0) {
  process.exit(1)
}
