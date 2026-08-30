import { describe, expect, it } from 'vitest'

import { buildFinalStatusRowsContext, calculateFinalStatusInRows, type WeldInput } from '@/lib/weld-fields'
import type { PreHeatTreatmentControlRecord } from '@/lib/lnk-control-stage'
import type { PstoRepeatCycleRecord } from '@/lib/psto-cycle'

describe('calculateFinalStatusInRows', () => {
  it('requires assigned pre-heat-treatment controls and keeps duplicates on their existing path', () => {
    const base = {
      id: 1,
      joint: 'F1',
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      hasVik: 'да',
      vikRequest: 'Заявка ВИК после ТО',
      vikResult: 'годен',
      pstoRequest: 'Заявка ПСТО',
      pstoResult: 'проведено',
      pstoDate: '2026-08-10',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtResult: 'годен',
    } satisfies WeldInput

    expect(calculateFinalStatusInRows(base, [base])).toBe('ожидает заявку')

    const requestedControl = {
      id: 1,
      weldJointId: 1,
      method: 'ВИК',
      requestName: 'Заявка ВИК до ТО',
      requestDate: '2026-08-03',
      result: 'ожидает НК',
    }
    const requested = {
      ...base,
      preHeatTreatmentControls: [requestedControl],
    } as WeldInput
    expect(calculateFinalStatusInRows(requested, [requested])).toBe('ожидает НК')

    const complete = {
      ...requested,
      preHeatTreatmentControls: [{
        ...requestedControl,
        result: 'годен',
        conclusionDate: '2026-08-04',
        conclusionName: 'ЗНК-ВИК до ТО',
      }],
    } as WeldInput
    expect(calculateFinalStatusInRows(complete, [complete])).toBe('годен')

    const duplicateRejected = {
      ...complete,
      duplicateControls: [{ id: 1, weldJointId: 1, method: 'РК', result: 'ремонт' }],
    } as WeldInput
    expect(calculateFinalStatusInRows(duplicateRejected, [duplicateRejected])).toBe('не годен по дублю')
  })

  it('treats a completed PSTO and TVMT cycle as sufficient when no LNK method is assigned', () => {
    const complete = {
      id: 2,
      joint: 'F2',
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО',
      pstoResult: 'проведено',
      pstoDate: '2026-08-10',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtResult: 'годен',
    } satisfies WeldInput

    expect(calculateFinalStatusInRows(complete, [complete])).toBe('годен')
  })

  it('routes failed TVMT into a repeat cycle without making the weld rejected', () => {
    for (const weldControlPercent of ['10', '100']) {
      const failedPrimary = {
        id: 20,
        joint: 'F20',
        weldDate: '2026-08-01',
        weldControlPercent,
        pstoRequired: 'да',
        pstoRequest: 'Заявка ПСТО-1',
        pstoResult: 'проведено',
        pstoDate: '2026-08-10',
        tvmtRequest: 'Заявка ТВМТ-1',
        tvmtResult: 'не годен',
      } satisfies WeldInput

      expect(calculateFinalStatusInRows(failedPrimary, [failedPrimary])).toBe('ожидает заявку')

      const repeatInProgress = {
        ...failedPrimary,
        pstoRepeatCycles: [{
          id: 201,
          weldJointId: 20,
          sequence: 2,
          pstoRequest: 'Заявка ПСТО-2',
          pstoResult: 'проведено',
          pstoDate: '2026-08-12',
          tvmtRequest: 'Заявка ТВМТ-2',
          tvmtResult: 'ожидает НК',
        }],
      } satisfies WeldInput & { pstoRepeatCycles: PstoRepeatCycleRecord[] }
      expect(calculateFinalStatusInRows(repeatInProgress, [repeatInProgress])).toBe('ожидает НК')

      const repeatComplete = {
        ...repeatInProgress,
        pstoRepeatCycles: [{
          ...repeatInProgress.pstoRepeatCycles[0],
          tvmtResult: 'годен',
        }],
      } satisfies WeldInput & { pstoRepeatCycles: PstoRepeatCycleRecord[] }
      expect(calculateFinalStatusInRows(repeatComplete, [repeatComplete])).toBe('годен')
    }
  })

  it('keeps pre-TO controls mandatory for a weld whose PSTO was actually performed before cancellation', () => {
    const completedCycle = {
      id: 30,
      joint: 'F30',
      weldDate: '2026-08-01',
      pstoRequired: 'отменен',
      pstoRequest: 'Заявка ПСТО-1',
      pstoResult: 'проведено',
      pstoDate: '2026-08-10',
      tvmtRequest: 'Заявка ТВМТ-1',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-11',
      hasVik: 'да',
      vikRequest: 'Заявка ВИК основная',
      vikResult: 'годен',
    } satisfies WeldInput

    expect(calculateFinalStatusInRows(completedCycle, [completedCycle])).toBe('ожидает заявку')

    const withGoodPreControl = {
      ...completedCycle,
      preHeatTreatmentControls: [{
        id: 301,
        weldJointId: 30,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        result: 'годен',
      }],
    } satisfies WeldInput & { preHeatTreatmentControls: PreHeatTreatmentControlRecord[] }
    expect(calculateFinalStatusInRows(withGoodPreControl, [withGoodPreControl])).toBe('годен')
  })

  it('keeps a completed cancelled PSTO cycle sufficient when no LNK method is assigned', () => {
    const completedCycle = {
      id: 31,
      joint: 'F31',
      weldDate: '2026-08-01',
      pstoRequired: 'отменен',
      pstoRequest: 'Заявка ПСТО-1',
      pstoResult: 'проведено',
      pstoDate: '2026-08-10',
      tvmtRequest: 'Заявка ТВМТ-1',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-11',
    } satisfies WeldInput

    expect(calculateFinalStatusInRows(completedCycle, [completedCycle])).toBe('годен')
  })

  it('does not require a new cycle after failed TVMT on a cancelled line', () => {
    const failedCycle = {
      id: 32,
      joint: 'F32',
      weldDate: '2026-08-01',
      pstoRequired: 'отменен',
      pstoRequest: 'Заявка ПСТО-1',
      pstoResult: 'проведено',
      pstoDate: '2026-08-10',
      tvmtRequest: 'Заявка ТВМТ-1',
      tvmtResult: 'не годен',
      tvmtConclusionDate: '2026-08-11',
    } satisfies WeldInput

    expect(calculateFinalStatusInRows(failedCycle, [failedCycle])).toBe('годен')
  })

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
    ] as WeldInput[]
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

  it('carries a rejected pre-heat-treatment result into the same-name repair context', () => {
    const fullRows = [
      {
        id: 1,
        projectTitle: 'Риформинг',
        subtitleCode: '400',
        line: 'LIN-000-11-31',
        joint: 'F3',
        status: 'неофициальный',
        weldDate: '2026-07-01',
        pstoRequired: 'да',
        hasVik: 'да',
        preHeatTreatmentControls: [{
          id: 31,
          weldJointId: 1,
          method: 'ВИК',
          requestName: 'Заявка ВИК до ТО',
          result: 'ремонт',
        }],
      },
      {
        id: 2,
        projectTitle: 'Риформинг',
        subtitleCode: '400',
        line: 'LIN-000-11-31',
        joint: 'F3',
      },
    ] as WeldInput[]
    const pageRows = [fullRows[1]]
    const fullContext = buildFinalStatusRowsContext(fullRows)

    expect(calculateFinalStatusInRows(pageRows[0], pageRows)).toBe('ожидает сварку')
    expect(calculateFinalStatusInRows(pageRows[0], fullRows, fullContext)).toBe('ожидает ремонт')
  })
})
