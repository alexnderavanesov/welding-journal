import { describe, expect, it } from 'vitest'
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
    expect(markChunkReloadAttempt(storage, '/statistics')).toBe(true)
    expect(markChunkReloadAttempt(storage, '/statistics')).toBe(false)
    clearChunkReloadAttempt(storage, '/statistics')
    expect(markChunkReloadAttempt(storage, '/statistics')).toBe(true)
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
