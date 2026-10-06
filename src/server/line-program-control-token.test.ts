import { expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { getLineProgramControlToken } from './line-program-control'
import type { ProgramChange } from '@/lib/line-program-workspace'

const version = new Date('2026-10-02T10:00:00Z')
const changes: ProgramChange[] = [{ id: 1, values: { РК: 'да' } }]

it('keeps the exact preview protocol, with freshness for the last row, history, line and selection', async () => {
  const rows = [{ id: 1, joint: 'S1' }, { id: 2, joint: 'S2', weldingJournalNote: 'x'.repeat(4096) }]
  const token = await getLineProgramControlToken(version, rows, changes)
  expect(token).toBe(createHash('sha256').update(JSON.stringify([version, rows, changes])).digest('hex'))
  expect(await getLineProgramControlToken(version, rows, changes)).toBe(token)
  expect(await getLineProgramControlToken(new Date(version.getTime() + 1), rows, changes)).not.toBe(token)
  expect(await getLineProgramControlToken(version, rows, [{ id: 2, values: { УЗК: 'да' } }])).not.toBe(token)
  rows[1].weldingJournalNote = 'corrected history'
  expect(await getLineProgramControlToken(version, rows, changes)).not.toBe(token)
})

it('never serializes the whole line in one string when checking even one assignment', async () => {
  const rows = Array.from({ length: 32 }, (_, index) => ({ id: index + 1, joint: `S${index}`, weldingJournalNote: 'x'.repeat(4096) }))
  const stringify = JSON.stringify
  let largest = 0
  const spy = vi.spyOn(JSON, 'stringify').mockImplementation((...args: Parameters<typeof JSON.stringify>) => {
    const text = stringify(...args)
    largest = Math.max(largest, text?.length ?? 0)
    return text
  })
  try {
    expect(await getLineProgramControlToken(version, rows, changes)).toMatch(/^[a-f\d]{64}$/)
    expect(largest).toBeLessThan(16_384)
  } finally { spy.mockRestore() }
})

it('covers the last of 200000 records without materializing their combined history', async () => {
  const rows = Array.from({ length: 200000 }, (_, index) => ({ id: index + 1, joint: `S${index}`, weldingJournalNote: 'x'.repeat(4096) }))
  const token = await getLineProgramControlToken(version, rows, changes)
  expect(token).toMatch(/^[a-f\d]{64}$/)
  rows.at(-1)!.weldingJournalNote = 'changed'
  expect(await getLineProgramControlToken(version, rows, changes)).not.toBe(token)
}, 15000)
