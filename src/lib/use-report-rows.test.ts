import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  prepareReportRows,
  prepareReportRowsInPlace,
  reuseEquivalentWeldRows,
} from '@/lib/use-report-rows'

describe('paged repair statuses', () => {
  const continuation = { id: 2, joint: 'F1', line: 'L', finalStatus: 'ожидает ремонт' } as WeldRow

  it('does not erase the server repair status when its source is on another page', () => {
    expect(prepareReportRows([continuation], [], undefined, undefined, undefined, true)[0].finalStatus).toBe('ожидает ремонт')
  })

  it('uses an authoritative full context to remove an obsolete repair status', () => {
    const context = { rejectedUnofficialSameNameRepairKeys: new Set<string>() }
    expect(prepareReportRows([continuation], [], undefined, context, undefined, true)[0].finalStatus).toBe('ожидает сварку')
  })

  it('does not keep waiting for repair after welding was actually recorded', () => {
    const row = { ...continuation, weldDate: '2026-09-16', hasVik: 'да', vikResult: 'годен' }
    expect(prepareReportRows([row], [], undefined, undefined, undefined, true)[0].finalStatus).toBe('годен')
  })

  it('uses the visible rejected pre-TO source without a separate context request', () => {
    const source = { id: 1, joint: 'F1', line: 'L', officiality: 'неофициальный', pstoRequired: 'да', hasVik: 'да',
      preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ВИК', result: 'ремонт' }],
    }
    expect(prepareReportRows([source, { ...continuation, finalStatus: 'ожидает сварку' }], [], undefined, undefined, undefined, true)[1].finalStatus).toBe('ожидает ремонт')
  })
})

describe('reuseEquivalentWeldRows', () => {
  it('preserves references for unchanged rows and replaces only a changed row', () => {
    const previous = [
      { id: 1, joint: 'S1', line: 'L1' },
      { id: 2, joint: 'S2', line: 'L1' },
    ] as WeldRow[]
    const next = [
      { id: 1, joint: 'S1', line: 'L1' },
      { id: 2, joint: 'S2-new', line: 'L1' },
    ] as WeldRow[]

    const result = reuseEquivalentWeldRows(previous, next)

    expect(result[0]).toBe(previous[0])
    expect(result[1]).toBe(next[1])
  })

  it('treats an unchanged shallow array as equivalent', () => {
    const control = { id: 10 }
    const previous = [{ id: 1, duplicateControls: [control] }] as unknown as WeldRow[]
    const next = [{ id: 1, duplicateControls: [control] }] as unknown as WeldRow[]

    expect(reuseEquivalentWeldRows(previous, next)[0]).toBe(previous[0])
  })
})

describe('prepareReportRowsInPlace', () => {
  it('keeps dispatcher status semantics without replacing owned row objects', () => {
    const source = [{
      id: 1,
      weldDate: '2026-09-20',
      hasVik: null,
      hasRk: 'да',
      rkRequest: 'РК-1',
      rkResult: null,
      pstoRequired: null,
    }] as WeldRow[]
    const duplicateControls = [{
      id: 7,
      version: '1',
      weldJointId: 1,
      method: 'РК' as const,
      result: 'годен' as const,
      controlDate: '2026-09-21',
      conclusion: 'Д-1',
      conclusionDate: '2026-09-21',
    }]
    const expected = prepareReportRows(source.map((row) => ({ ...row })), duplicateControls)
    const originalReference = source[0]

    const actual = prepareReportRowsInPlace(source, duplicateControls)

    expect(actual[0]).toBe(originalReference)
    expect(actual[0]).toMatchObject({
      hasVik: expected[0]?.hasVik,
      rkResult: expected[0]?.rkResult,
      finalStatus: expected[0]?.finalStatus,
      duplicateControls: expected[0]?.duplicateControls,
    })
  })
})
