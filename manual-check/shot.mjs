import { chromium } from 'playwright'
import { mkdir, readFile } from 'node:fs/promises'

const names = process.argv.slice(2)
await mkdir('manual-check/screens', { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
for (const name of names) {
  const html = await readFile(`manual-check/html/${name}.html`, 'utf8')
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
  await page.setContent(html, { waitUntil: 'load' })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `manual-check/screens/${name}--initial.png` })
  await page.close()
}
await browser.close()
