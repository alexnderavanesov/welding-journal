import { afterEach, expect, it, vi } from 'vitest'
import { defaultProgramGridSettings, programGridColumns, readProgramGridSettings, writeProgramGridSettings } from './line-program-grid-state'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })
it('persists presentation independently for each table and never persists sorting, selection or drafts', () => {
  const columns = programGridColumns([{ colId: 'joint', width: 287, sort: 'desc', sortIndex: 0, hide: true, rowGroup: true, rowGroupIndex: 0, pinned: 'left', flex: null }])
  writeProgramGridSettings('joints', { ...defaultProgramGridSettings(), columns })
  expect(readProgramGridSettings('joints')).toEqual({ columns: [{ colId: 'joint', width: 287, flex: null }] })
  expect(readProgramGridSettings('assignments')).toEqual(defaultProgramGridSettings())
  const saved = localStorage.getItem('welding:line-program:grid:joints:v2')!
  for (const field of ['sort', 'filter', 'draft', 'selection', 'hide', 'pinned', 'rowGroup', 'density', 'theme']) expect(saved).not.toContain(field)
})
it('rejects malformed persisted settings and excludes generated columns', () => {
  localStorage.setItem('welding:line-program:grid:lines:v2', '{broken')
  expect(readProgramGridSettings('lines')).toEqual(defaultProgramGridSettings())
  localStorage.setItem('welding:line-program:grid:lines:v2', JSON.stringify({ columns: [null, {}, { colId: 'line', width: -9 }, { colId: 'ag-Grid-AutoColumn', width: 900 }], density: 'unknown' }))
  expect(readProgramGridSettings('lines').columns).toEqual([{ colId: 'line', width: 48, flex: null }])
})
it('keeps tables usable when browser storage is blocked', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  expect(readProgramGridSettings('stamps')).toEqual(defaultProgramGridSettings())
  expect(() => writeProgramGridSettings('stamps', defaultProgramGridSettings())).not.toThrow()
})

it('does not restore the rejected interface’s hidden, grouped or pinned columns', () => {
  localStorage.setItem('welding:line-program:grid:joints:v1', JSON.stringify({ columns: [{ colId: 'joint', hide: true, pinned: 'left', rowGroup: true }] }))
  expect(readProgramGridSettings('joints')).toEqual(defaultProgramGridSettings())
})
