import { describe, expect, it, vi } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { calculateFinalStatusInRows } from '@/lib/weld-status'

const state = vi.hoisted(() => ({
  enabled: true,
  row: {} as Record<string, unknown>,
  select: vi.fn(),
}))

vi.mock('@/db', () => ({
  requireDb: () => ({ select: state.select }),
}))
vi.mock('@/server/heat-treatment-control-relations', () => ({
  attachHeatTreatmentControlRelations: async (rows: WeldRow[]) => rows.map((row) => ({
    ...row,
    preHeatTreatmentLnkEnabled: state.enabled,
    preHeatTreatmentControls: [{ id: 1, weldJointId: row.id, method: 'ВИК', requestName: 'НК-1', result: 'ремонт' }],
  })),
  attachPreHeatTreatmentControlRelations: vi.fn(),
  attachHeatTreatmentControlRelationsInPlace: vi.fn(),
}))

import { loadCurrentFinalStatusRowsContext } from '@/server/weld-read'

describe('server final-status context for same-name repair after pre-TO rejection', () => {
  it.each([
    { enabled: true, pstoRequired: 'да', heatTreatmentDiagram: null, expected: 'ожидает ремонт' },
    { enabled: true, pstoRequired: 'отменен', heatTreatmentDiagram: 'Фактическая диаграмма', expected: 'ожидает ремонт' },
    { enabled: false, pstoRequired: 'да', heatTreatmentDiagram: null, expected: 'ожидает сварку' },
  ])('retains policy facts in the compact SQL selection: %j', async ({ enabled, expected, ...history }) => {
    state.enabled = enabled
    state.row = { id: 1, joint: 'F1', projectTitle: 'P', subtitleCode: 'S', line: 'L', officiality: 'неофициальный', hasVik: 'да', ...history }
    state.select.mockReset()
    state.select.mockImplementation((columns: Record<string, unknown>) => ({ from: () => ({
      where: async () => [Object.fromEntries(Object.keys(columns).map((key) => [key, state.row[key] ?? null]))],
    }) }))

    const context = await loadCurrentFinalStatusRowsContext()
    const continuation = { id: 2, joint: 'F1', projectTitle: 'P', subtitleCode: 'S', line: 'L', officiality: 'действующий' } as WeldRow

    expect(calculateFinalStatusInRows(continuation, [continuation], context)).toBe(expected)
    expect(state.select).toHaveBeenCalledTimes(1)
  })
})
