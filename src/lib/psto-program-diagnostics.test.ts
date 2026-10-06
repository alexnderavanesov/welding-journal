import { beforeEach, expect, it, vi } from 'vitest'
import { PSTO_PROGRAM_DIAGNOSTICS_KEY, readPstoProgramDiagnostics, tracePstoProgram, tracePstoProgramModule } from './psto-program-diagnostics'

beforeEach(() => sessionStorage.removeItem(PSTO_PROGRAM_DIAGNOSTICS_KEY))

it('bounds diagnostics across repeated opens and never stores error text or private facts', () => {
  for (let i = 0; i < 200; i++) tracePstoProgram('open')
  tracePstoProgram('query-error', new Error('Private project / ФИО / https://private.example/?secret=1'))
  const events = readPstoProgramDiagnostics()
  expect(events).toHaveLength(60)
  expect(events.at(-1)).toMatchObject({ event: 'query-error', failure: 'other' })
  expect(JSON.stringify(events)).not.toMatch(/Private|ФИО|private|secret/)
  sessionStorage.setItem(PSTO_PROGRAM_DIAGNOSTICS_KEY, JSON.stringify([
    { at: new Date().toISOString(), event: 'open', unsafe: 'secret' }, { at: 'secret', event: 'open' },
  ]))
  expect(readPstoProgramDiagnostics()).toHaveLength(1)
  expect(JSON.stringify(readPstoProgramDiagnostics())).not.toContain('secret')
})

it('distinguishes module failure and completion without retrying or swallowing the cause', async () => {
  const error = new Error('Failed to fetch dynamically imported module: private-url')
  const load = vi.fn().mockRejectedValue(error)
  await expect(tracePstoProgramModule('dialog', load)).rejects.toBe(error)
  expect(load).toHaveBeenCalledTimes(1)
  expect(readPstoProgramDiagnostics().map(({ event, failure }) => [event, failure])).toEqual([
    ['dialog-loading', undefined], ['dialog-error', 'chunk'],
  ])
  await expect(tracePstoProgramModule('group', async () => 42)).resolves.toBe(42)
  expect(readPstoProgramDiagnostics().at(-1)?.event).toBe('group-ready')
})

it('does not break the workflow when storage is corrupt or unavailable', () => {
  sessionStorage.setItem(PSTO_PROGRAM_DIAGNOSTICS_KEY, '{broken')
  expect(readPstoProgramDiagnostics()).toEqual([])
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
  try { expect(() => tracePstoProgram('open')).not.toThrow() } finally { spy.mockRestore() }
})
