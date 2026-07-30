import { describe, expect, it } from 'vitest'

import { buildFinalStatusRowsContext, calculateFinalStatusInRows, type WeldInput } from '@/lib/weld-fields'

describe('calculateFinalStatusInRows', () => {
  it('uses the final status context without changing same-name repair logic', () => {
    const rows = [
      {
        id: 1,
        projectTitle: 'Риформинг',
        subtitleCode: '400',
        line: 'LIN-000-11-31',
        joint: 'F1',
        status: 'неофициальный',
        weldDate: '2026-07-01',
        hasRk: 'да',
        rkResult: 'ремонт',
      },
      {
        id: 2,
        projectTitle: 'Риформинг',
        subtitleCode: '400',
        line: 'LIN-000-11-31',
        joint: 'F1',
      },
      {
        id: 3,
        projectTitle: 'Риформинг',
        subtitleCode: '400',
        line: 'LIN-000-11-31',
        joint: 'F2R1',
        status: 'неофициальный',
        weldDate: '2026-07-01',
        hasRk: 'да',
        rkResult: 'ремонт',
      },
      {
        id: 4,
        projectTitle: 'Риформинг',
        subtitleCode: '400',
        line: 'LIN-000-11-31',
        joint: 'F2',
      },
    ] satisfies WeldInput[]
    const context = buildFinalStatusRowsContext(rows)

    expect(calculateFinalStatusInRows(rows[1], rows)).toBe('ожидает ремонт')
    expect(calculateFinalStatusInRows(rows[1], rows, context)).toBe('ожидает ремонт')
    expect(calculateFinalStatusInRows(rows[3], rows)).toBe('ожидает сварку')
    expect(calculateFinalStatusInRows(rows[3], rows, context)).toBe('ожидает сварку')
  })

  it('can calculate a paged row with final status context from the full journal', () => {
    const fullRows = [
      {
        id: 1,
        projectTitle: 'Риформинг',
        subtitleCode: '400',
        line: 'LIN-000-11-31',
        joint: 'F1',
        status: 'неофициальный',
        weldDate: '2026-07-01',
        hasRk: 'да',
        rkResult: 'ремонт',
      },
      {
        id: 2,
        projectTitle: 'Риформинг',
        subtitleCode: '400',
        line: 'LIN-000-11-31',
        joint: 'F1',
      },
    ] satisfies WeldInput[]
    const pageRows = [fullRows[1]]
    const fullContext = buildFinalStatusRowsContext(fullRows)

    expect(calculateFinalStatusInRows(pageRows[0], pageRows)).toBe('ожидает сварку')
    expect(calculateFinalStatusInRows(pageRows[0], fullRows, fullContext)).toBe('ожидает ремонт')
  })
})
