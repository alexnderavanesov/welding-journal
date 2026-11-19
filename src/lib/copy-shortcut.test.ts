import { expect, it } from 'vitest'
import { isCopyShortcut } from './copy-shortcut'

it('accepts Russian/English Ctrl+C, Caps Lock and Command+C', () => {
  for (const key of ['c', 'C', 'с', 'С']) for (const modifier of ['ctrlKey', 'metaKey']) {
    expect(isCopyShortcut(new KeyboardEvent('keydown', { key, code: 'KeyC', [modifier]: true }))).toBe(true)
  }
  expect(isCopyShortcut(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))).toBe(true)
})
it('accepts Cyrillic C even when the keyboard does not provide a physical code', () => {
  for (const code of ['', 'Unidentified']) for (const key of ['с', 'С']) for (const modifier of ['ctrlKey', 'metaKey']) {
    expect(isCopyShortcut(new KeyboardEvent('keydown', { key, code, [modifier]: true }))).toBe(true)
  }
})
it('leaves browser shortcuts, composition and consumed events alone', () => {
  for (const patch of [{ ctrlKey: false }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { key: 'x', code: 'KeyX' }]) {
    expect(isCopyShortcut(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ctrlKey: true, ...patch }))).toBe(false)
  }
  const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, cancelable: true })
  event.preventDefault(); expect(isCopyShortcut(event)).toBe(false)
})
