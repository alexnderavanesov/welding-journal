import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// Browsers implement this API, but JSDOM only logs "Not implemented".
window.scrollTo = vi.fn()

// Most existing component tests exercise business UI as an authorized owner.
// Access/session and storage isolation tests explicitly unmock these fixtures.
vi.mock('@/lib/security-context', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/security-context')>(),
  useAccess: () => ({ identity: { id: 'test-owner', name: 'Владелец', email: 'owner@example.test', title: '', role: 'owner', permissions: [], revision: 1 }, can: () => true, loading: false, error: '', refresh: async () => {} }),
}))
vi.mock('@/lib/user-storage', () => ({
  userStorage: { getItem: (key: string) => window.localStorage.getItem(key), setItem: (key: string, value: string) => window.localStorage.setItem(key, value), removeItem: (key: string) => window.localStorage.removeItem(key) },
  userSessionStorage: { getItem: (key: string) => window.sessionStorage.getItem(key), setItem: (key: string, value: string) => window.sessionStorage.setItem(key, value), removeItem: (key: string) => window.sessionStorage.removeItem(key) },
  setStorageIdentity: vi.fn(), scopedStorageKey: (key: string) => key,
}))
