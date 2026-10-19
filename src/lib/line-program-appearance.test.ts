import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_PROGRAM_APPEARANCE, PROGRAM_APPEARANCE_KEY, readProgramAppearance, writeProgramAppearance } from './line-program-appearance'
afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })
it('stores only program appearance independently of journal and column state', () => {
  localStorage.setItem('welding:journal:view', 'untouched')
  localStorage.setItem('welding:line-program:grid:lines:v2', '{"columns":[]}')
  const value = { theme: 'balham', density: 'compact', verticalBorders: true } as const
  writeProgramAppearance(value)
  expect(readProgramAppearance()).toEqual(value)
  expect(localStorage.getItem('welding:journal:view')).toBe('untouched')
  expect(localStorage.getItem('welding:line-program:grid:lines:v2')).toBe('{"columns":[]}')
})
it.each(['{broken', 'null', '[]', '3', '"quartz"', '{"theme":"unknown","density":"huge","verticalBorders":"false"}'])('ignores malformed preferences: %s', raw => {
  localStorage.setItem(PROGRAM_APPEARANCE_KEY, raw)
  expect(readProgramAppearance()).toEqual(DEFAULT_PROGRAM_APPEARANCE)
})
it('does not import filters, selections or drafts from persisted appearance', () => {
  localStorage.setItem(PROGRAM_APPEARANCE_KEY, JSON.stringify({ theme: 'alpine', density: 'spacious', selection: [1], draft: { РК: 'да' }, filter: 'bad' }))
  expect(readProgramAppearance()).toEqual({ theme: 'alpine', density: 'spacious', verticalBorders: false })
})
it('keeps controls available when storage is blocked', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  expect(readProgramAppearance()).toEqual(DEFAULT_PROGRAM_APPEARANCE)
  expect(() => writeProgramAppearance(DEFAULT_PROGRAM_APPEARANCE)).not.toThrow()
})
