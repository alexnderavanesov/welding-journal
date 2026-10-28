import { describe, expect, it, vi } from 'vitest'
import {
  clearChunkReloadAttempt,
  isChunkLoadError,
  markChunkReloadAttempt,
} from '@/lib/chunk-load-recovery'

describe('chunk load recovery', () => {
  it.each([
    'Importing a module script failed.',
    'Failed to fetch dynamically imported module: /assets/page.js',
    'Loading chunk 42 failed',
  ])('recognizes a recoverable module error: %s', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true)
  })

  it('does not treat an application error as a chunk failure', () => {
    expect(isChunkLoadError(new Error('Failed query'))).toBe(false)
  })

  it('allows only one automatic reload until the route loads successfully', () => {
    const storage = createMemoryStorage()
    expect(markChunkReloadAttempt('/statistics', storage)).toBe(true)
    expect(markChunkReloadAttempt('/statistics', storage)).toBe(false)
    clearChunkReloadAttempt('/statistics', storage)
    expect(markChunkReloadAttempt('/statistics', storage)).toBe(true)
  })

  it.each(['getItem', 'setItem'] as const)('leaves recovery to the user when storage.%s is unavailable', method => {
    const storage = createMemoryStorage()
    storage[method] = () => { throw new DOMException('Storage unavailable', 'SecurityError') }
    // Without a durable marker, automatic reload cannot be bounded safely.
    expect(markChunkReloadAttempt('/journal', storage)).toBe(false)
  })

  it('does not break a successfully opened route when the old marker cannot be removed', () => {
    const storage = createMemoryStorage()
    storage.removeItem = () => { throw new DOMException('Storage unavailable', 'SecurityError') }
    expect(() => clearChunkReloadAttempt('/journal', storage)).not.toThrow()
  })

  it('handles a browser that denies access to sessionStorage itself', () => {
    const storage = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError')
    })
    try {
      expect(markChunkReloadAttempt('/journal')).toBe(false)
      expect(() => clearChunkReloadAttempt('/journal')).not.toThrow()
    } finally { storage.mockRestore() }
  })
})

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}
