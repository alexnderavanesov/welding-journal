import { beforeEach, expect, it, vi } from 'vitest'
vi.unmock('./user-storage')
import { setStorageIdentity, userStorage, userSessionStorage } from './user-storage'
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setStorageIdentity(null) })
it('isolates drafts and selections between accounts, including signout', () => {
  setStorageIdentity('first'); userStorage.setItem('selection', 'private'); userSessionStorage.setItem('selection', 'private')
  setStorageIdentity(null); expect(userStorage.getItem('selection')).toBeNull()
  setStorageIdentity('second'); expect(userStorage.getItem('selection')).toBeNull(); expect(userSessionStorage.getItem('selection')).toBeNull()
  setStorageIdentity('first'); expect(userStorage.getItem('selection')).toBeNull() // Logout clears cached work, keeping only presentation preferences.
})
it('copies legacy presentation preferences, never old selections or application settings', () => {
  localStorage.setItem('welding-journal-ag-grid:v1', '{"columns":[{"colId":"createdAt","hide":false}]}')
  localStorage.setItem('selection', 'private'); localStorage.setItem('welding-other-settings', 'old')
  setStorageIdentity('first'); expect(userStorage.getItem('welding-journal-ag-grid:v1')).toContain('createdAt')
  expect(userStorage.getItem('selection')).toBeNull(); expect(userStorage.getItem('welding-other-settings')).toBeNull()
})

it('clears working caches after rights change without losing the user layout', () => {
  setStorageIdentity('first'); userStorage.setItem('selection', 'private'); userStorage.setItem('welding-journal-ag-grid:v1', 'layout')
  setStorageIdentity('first', true)
  expect(userStorage.getItem('selection')).toBeNull(); expect(userStorage.getItem('welding-journal-ag-grid:v1')).toBe('layout')
})

it.each([
  'welding-journal-ag-grid:v1', 'lnk-ag-grid:v1', 'psto-ag-grid:v1',
  'welding-report-view:v1:weldingJournal', 'welding-report-sort:v1',
  'welding-tracker-collapsed-sections:lnk',
  'welding:line-program:grid:lines:v2', 'welding:line-program:grid:stamps:v2',
  'welding:line-program:grid:joints:v2', 'welding:line-program:grid:assignments:v2',
  'welding:line-program:appearance:v1',
  'welding-journal:documents:grid:v1:generated:weldingJournal',
  'welding-journal:documents:history-columns', 'welding-journal:documents:parameters-collapsed',
])('preserves the existing presentation and its personal changes after logout: %s', key => {
  localStorage.setItem(key, 'legacy layout')
  setStorageIdentity('first')
  expect(userStorage.getItem(key)).toBe('legacy layout')
  userStorage.setItem(key, 'personal layout')
  setStorageIdentity(null)
  setStorageIdentity('first')
  expect(userStorage.getItem(key)).toBe('personal layout')
})
