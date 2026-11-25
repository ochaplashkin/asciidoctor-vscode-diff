import { MessagePoster } from './messaging.js'

// A small code glyph, drawn inline so it follows the button's foreground color
// in every theme (the preview cannot use the VS Code icon font).
const SOURCE_ICON = `<svg class="preview-source-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5.5 3.5 1.5 8l4 4.5M10.5 3.5l4 4.5-4 4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`

/**
 * The bar shown at the top of a preview opened in preview-first mode.
 *
 * It lives outside `#preview-root` so the incremental content updates (which
 * recreate the rendered document in place) never remove it. The click is sent
 * to the extension host, which opens the source document beside the preview.
 */
export function createSourceButton(
  messaging: MessagePoster,
  label: string,
): HTMLDivElement {
  const bar = document.createElement('div')
  bar.id = 'preview-source-bar'
  bar.className = 'preview-source-bar'

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'preview-source-button'
  button.title = label
  button.innerHTML = `${SOURCE_ICON}<span></span>`
  const text = button.querySelector('span')
  if (text) {
    text.textContent = label
  }
  button.addEventListener('click', () => {
    messaging.postMessage('showSource', {})
  })

  bar.append(button)
  return bar
}

/** Adds the bar to the preview once, if it is not already present. */
export function installSourceButton(
  messaging: MessagePoster,
  label: string,
  container: HTMLElement = document.body,
): void {
  if (document.getElementById('preview-source-bar')) {
    return
  }
  container.prepend(createSourceButton(messaging, label))
}
