export function isAnyReportModalOpen(modalOpenStates: Iterable<boolean>) {
  for (const isOpen of modalOpenStates) {
    if (isOpen) return true
  }
  return false
}
