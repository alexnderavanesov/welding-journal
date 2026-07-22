let contextActionMenuOpen = false

export function setContextActionMenuOpen(isOpen: boolean) {
  contextActionMenuOpen = isOpen
}

export function isContextActionMenuOpen() {
  return contextActionMenuOpen
}
