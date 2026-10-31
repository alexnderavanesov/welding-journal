export const MODAL_DIALOG_SELECTOR = '[data-modal-dialog="true"]'

export function isModalDialogOpen() {
  return typeof document !== 'undefined' && Boolean(document.querySelector(MODAL_DIALOG_SELECTOR))
}

/** Portal position alone is insufficient: elevated workflows and previews use
 * different overlay layers. Equal layers follow their paint order in the DOM. */
export function getTopModalDialog() {
  if (typeof document === 'undefined') return null
  let top: HTMLElement | null = null, topLayer = -Infinity
  for (const dialog of document.querySelectorAll<HTMLElement>(MODAL_DIALOG_SELECTOR)) {
    if (!isEscapeLayerVisible(dialog)) continue
    const layer = getEscapeLayer(dialog)
    if (layer >= topLayer) { top = dialog; topLayer = layer }
  }
  return top
}

export function isTopModalDialog(element: Element | null | undefined) {
  const dialog = element?.closest(MODAL_DIALOG_SELECTOR)
  return Boolean(dialog && dialog === getTopModalDialog())
}

export function isEscapeLayerVisible(element: Element) {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.matches('[hidden], [aria-hidden="true"], .ag-hidden')) return false
    const style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
  }
  return true
}

function getEscapeLayer(element: Element) {
  let layer = 0
  for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
    const value = Number.parseInt(window.getComputedStyle(node).zIndex, 10)
    if (Number.isFinite(value)) layer = Math.max(layer, value)
  }
  return layer
}

export function hasVisibleEscapePopup(selector: string) {
  const top = getTopModalDialog()
  return [...document.querySelectorAll(selector)].some(node => {
    if (!isEscapeLayerVisible(node)) return false
    const owner = node.closest(MODAL_DIALOG_SELECTOR)
    if (owner && top && owner !== top) return false
    return !top || Boolean(owner) || getEscapeLayer(node) >= getEscapeLayer(top)
  })
}
