import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  assertPstoLineActivationTransferAllowed,
  assertPstoLineCancellationPromotionAllowed,
  normalizePstoLineAssignmentPayload,
  persistPstoLineAssignmentRows,
} from '@/server/psto-line-assignment'

describe('PSTO line assignment payload', () => {
  it('uses the same chronology barrier when activation moves LNK into pre-TO', () => {
    const previous = {
      id: 1,
      joint: 'F1',
      weldDate: '2026-08-01',
      vikRequest: 'Заявка ВИК',
      vikRequestDate: '2023-12-31',
    } as WeldRow
    const next = {
      ...previous,
      pstoRequired: 'да',
      vikRequest: null,
      vikRequestDate: null,
      preHeatTreatmentControls: [{
        id: -1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК',
        requestDate: '2023-12-31',
      }],
    } as WeldRow

    expect(() => assertPstoLineActivationTransferAllowed([previous], [next]))
      .toThrow(/Назначение ПСТО невозможно.*01\.01\.2024/)

    expect(() => assertPstoLineActivationTransferAllowed(
      [{ ...previous, vikRequestDate: '2026-08-02' }],
      [{
        ...next,
        preHeatTreatmentControls: [{
          ...next.preHeatTreatmentControls![0]!,
          requestDate: '2026-08-02',
        }],
      }],
    )).not.toThrow()
  })

  it('uses the same chronology barrier when cancellation promotes pre-TO LNK', () => {
    const previous = {
      id: 1,
      joint: 'F1',
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      preHeatTreatmentControls: [{
        id: 10,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        requestDate: '2023-12-31',
        result: 'годен',
        conclusionDate: '2026-08-02',
        conclusionName: 'Заключение ВИК',
      }],
    } as WeldRow
    const next = {
      ...previous,
      pstoRequired: 'отменен',
      preHeatTreatmentControls: [],
      vikRequest: 'Заявка ВИК до ТО',
      vikRequestDate: '2023-12-31',
      vikResult: 'годен',
      vikConclusionDate: '2026-08-02',
      vikConclusion: 'Заключение ВИК',
    } as WeldRow

    expect(() => assertPstoLineCancellationPromotionAllowed([previous], [next]))
      .toThrow(/Отмена ПСТО невозможна.*01\.01\.2024/)
  })

  it('normalizes the full project/subtitle/line identity and removal decisions', () => {
    expect(normalizePstoLineAssignmentPayload({
      identity: { projectTitle: ' Проект ', subtitleCode: ' 400 ', line: ' L-1 ' },
      action: 'remove',
      expectedVersions: [{ id: 1, version: ' 101 ' }],
      activationDecisions: [
        {
          rowId: 3,
          disposition: 'movePrimaryToBeforeHeatTreatment',
          methodCodes: [' вик ', 'РК', 'ВИК', 'ТВМТ'] as never,
        },
        {
          rowId: 4,
          disposition: 'keepPrimary',
          methodCodes: ['ПВК'],
        },
      ],
      decisions: [
        { rowId: 1, disposition: 'keepPrimary' },
        { rowId: 2, disposition: 'promoteBeforeHeatTreatment' },
        { rowId: -1, disposition: 'keepPrimary' },
      ],
    })).toEqual({
      identity: { projectTitle: 'Проект', subtitleCode: '400', line: 'L-1' },
      action: 'remove',
      expectedVersions: [{ id: 1, version: '101' }],
      cancellationDate: '',
      cancellationBasis: '',
      activationDecisions: [{
        rowId: 3,
        disposition: 'movePrimaryToBeforeHeatTreatment',
        methodCodes: ['ВИК', 'РК'],
      }, {
        rowId: 4,
        disposition: 'keepPrimary',
        methodCodes: ['ПВК'],
      }],
      decisions: [
        { rowId: 1, disposition: 'keepPrimary' },
        { rowId: 2, disposition: 'promoteBeforeHeatTreatment' },
      ],
    })
  })

  it('rejects an empty line and an unknown action', () => {
    expect(() => normalizePstoLineAssignmentPayload({
      identity: { projectTitle: 'Проект', subtitleCode: '400', line: '' },
      action: 'assign',
      expectedVersions: [],
    })).toThrow('укажите линию')

    expect(() => normalizePstoLineAssignmentPayload({
      identity: { projectTitle: 'Проект', subtitleCode: '400', line: 'L-1' },
      action: 'other' as 'assign',
      expectedVersions: [],
    })).toThrow('Неизвестное действие')
  })

  it('persists a whole line with one batch write instead of one query per weld', async () => {
    let insertCalls = 0
    const tx = {
      insert: () => {
        insertCalls += 1
        return {
          values: (values: Array<Record<string, unknown>>) => ({
            onConflictDoUpdate: () => ({
              returning: async () => values,
            }),
          }),
        }
      },
    }
    const rows = [
      {
        id: 1,
        joint: 'J-1',
        pstoRequired: 'да',
        preHeatTreatmentControls: [{ id: 11, weldJointId: 1 }],
      },
      {
        id: 2,
        joint: 'J-2',
        pstoRequired: 'да',
        pstoRepeatCycles: [{ id: 22, weldJointId: 2, sequence: 1 }],
      },
    ] as WeldRow[]

    const saved = await persistPstoLineAssignmentRows(
      tx as never,
      rows,
      new Date('2026-09-04T10:00:00.000Z'),
      new Set([1]),
    )

    expect(insertCalls).toBe(1)
    expect(saved.map((row) => row.id)).toEqual([1, 2])
    expect(saved[0]?.preHeatTreatmentControls).toHaveLength(1)
    expect(saved[1]?.pstoRepeatCycles).toHaveLength(1)
  })
})
