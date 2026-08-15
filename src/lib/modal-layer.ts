export const MODAL_DIALOG_SELECTOR = '[data-modal-dialog="true"]'

export function isModalDialogOpen() {
  return typeof document !== 'undefined' && Boolean(document.querySelector(MODAL_DIALOG_SELECTOR))
}
