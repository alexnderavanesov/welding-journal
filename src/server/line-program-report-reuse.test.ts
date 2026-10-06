import { expect, it, vi } from 'vitest'
import { loadLineProgramReport } from './line-program-report'
import { calculateLineProgram } from '@/lib/line-program-calculation'
import { getProgramRemovalHints } from '@/lib/line-program-excess'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'

const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('./line-program', () => ({ loadLineProgramCalculations: mocks.load, toLineProgramRecord: (value: unknown) => value }))
vi.mock('./line-program-welder-names', () => ({ loadLineProgramWelderNames: async () => new Map() }))
vi.mock('@/lib/line-program-excess', async original => {
  const module = await original<typeof import('@/lib/line-program-excess')>()
  return { ...module, getProgramRemovalHints: vi.fn(module.getProgramRemovalHints) }
})

it.each(['lines', 'stamps'] as const)('calculates removable assignments only once per configured line for %s', async mode => {
  vi.mocked(getProgramRemovalHints).mockClear()
  const line = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', category: 'II', groupName: 'A',
    weldControlPercent: 10, pvkControlPercent: 0, configurationIssue: null, version: '1' }
  const rows = [1, 2].map(id => ({ id, joint: `F${id}`, connectionType: 'С17', weldDate: '2026-09-01', hasRk: 'да', stamp1K: 'A' }))
  mocks.load.mockResolvedValue({ accepted: new Set(), systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
    calculations: [{ line, rows, calculations: calculateLineProgram(rows, 10, 0) }] })
  const tx = { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [line] }) }) }) }
  const report = await loadLineProgramReport(tx as never, { ids: [1], mode, context: '' })
  expect(getProgramRemovalHints).toHaveBeenCalledTimes(1)
  // Two physical joints at 10% need one assignment; one ordinary RK is removable.
  expect(report.tables![0].rows[0].slice(4, 10)).toEqual([2, '1 / 1', '0 / 0', 0, 1, 1])
})
