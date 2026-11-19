/** Physical C covers layouts; key also covers keyboards that omit the physical code. */
export function isCopyShortcut(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'defaultPrevented'>) {
  return !event.defaultPrevented && !event.isComposing && !event.altKey && !event.shiftKey
    && (event.ctrlKey || event.metaKey) && (event.code === 'KeyC' || ['c', 'с'].includes(event.key.toLowerCase()))
}
