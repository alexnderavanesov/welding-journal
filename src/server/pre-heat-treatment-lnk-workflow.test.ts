import { describe, expect, it } from 'vitest'

import {
  normalizePreHeatTreatmentLnkResultCorrectionPayload,
  normalizePreHeatTreatmentLnkWorkflowPayload,
  persistPreHeatTreatmentTouchedRows,
  savePreHeatTreatmentControlWrites,
  splitPreHeatTreatmentWriteBatches,
} from '@/server/pre-heat-treatment-lnk-workflow'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('pre-heat-treatment LNK workflow payload', () => {
  it('keeps only supported staged positions', () => {
    expect(normalizePreHeatTreatmentLnkWorkflowPayload({
      action: 'request',
      date: '2026-08-04',
      expectedVersions: [
        { id: 1, version: '101' },
        { id: 2, version: '102' },
      ],
      groups: [{
        name: 'Заявка до ТО-1',
        positions: [
          { rowId: 1, methodCode: 'ВИК' },
          { rowId: 1, methodCode: 'ВИК' },
          { rowId: 2, methodCode: 'РК' },
          { rowId: 3, methodCode: 'ТВМТ' as 'ВИК' },
        ],
      }],
    }).groups[0]?.positions).toEqual([
      { rowId: 1, methodCode: 'ВИК' },
      { rowId: 2, methodCode: 'РК' },
    ])
  })

  it('does not allow one staged position in two documents', () => {
    expect(() => normalizePreHeatTreatmentLnkWorkflowPayload({
      action: 'request',
      date: '2026-08-04',
      expectedVersions: [{ id: 1, version: '101' }],
      groups: [
        { name: 'Заявка 1', positions: [{ rowId: 1, methodCode: 'ВИК' }] },
        { name: 'Заявка 2', positions: [{ rowId: 1, methodCode: 'ВИК' }] },
      ],
    })).toThrow('нельзя включить в несколько документов')
  })

  it('requires one result for every selected position', () => {
    expect(() => normalizePreHeatTreatmentLnkWorkflowPayload({
      action: 'result',
      date: '2026-08-05',
      expectedVersions: [
        { id: 1, version: '101' },
        { id: 2, version: '102' },
      ],
      groups: [{
        name: 'ЗНК-ВИК-1',
        positions: [
          { rowId: 1, methodCode: 'ВИК' },
          { rowId: 2, methodCode: 'ВИК' },
        ],
      }],
      results: [{ rowId: 1, methodCode: 'ВИК', result: 'годен' }],
    })).toThrow('для каждой выбранной позиции')
  })

  it('does not accept duplicate results as coverage for another selected position', () => {
    expect(() => normalizePreHeatTreatmentLnkWorkflowPayload({
      action: 'result',
      date: '2026-08-05',
      expectedVersions: [
        { id: 1, version: '101' },
        { id: 2, version: '102' },
      ],
      groups: [{
        name: 'ЗНК-ВИК-1',
        positions: [
          { rowId: 1, methodCode: 'ВИК' },
          { rowId: 2, methodCode: 'ВИК' },
        ],
      }],
      results: [
        { rowId: 1, methodCode: 'ВИК', result: 'годен' },
        { rowId: 1, methodCode: 'ВИК', result: 'ремонт' },
      ],
    })).toThrow('указан несколько раз')
  })

  it('rejects a non-numeric RK exposure diameter', () => {
    expect(() => normalizePreHeatTreatmentLnkWorkflowPayload({
      action: 'result',
      date: '2026-08-05',
      expectedVersions: [{ id: 1, version: '101' }],
      groups: [{
        name: 'ЗНК-РК-1',
        positions: [{ rowId: 1, methodCode: 'РК' }],
      }],
      results: [{
        rowId: 1,
        methodCode: 'РК',
        result: 'годен',
        rkExposureConfirmedDiameter: 'не число' as unknown as number,
      }],
    })).toThrow('должен быть числом')
  })

  it('normalizes result corrections without accepting an unknown relation or action', () => {
    expect(normalizePreHeatTreatmentLnkResultCorrectionPayload({
      relationId: 7.9,
      expectedVersion: ' 101 ',
      action: 'update',
      result: ' годен ',
      conclusionDate: ' 2026-08-05 ',
      conclusionName: ' ЗНК-ВИК-1 ',
    })).toEqual({
      relationId: 7,
      expectedVersion: '101',
      stage: 'result',
      action: 'update',
      requestDate: '',
      requestName: '',
      result: 'годен',
      conclusionDate: '2026-08-05',
      conclusionName: 'ЗНК-ВИК-1',
    })

    expect(() => normalizePreHeatTreatmentLnkResultCorrectionPayload({
      relationId: 0,
      expectedVersion: '101',
      action: 'delete',
    })).toThrow('Не указан результат')
    expect(() => normalizePreHeatTreatmentLnkResultCorrectionPayload({
      relationId: 1,
      expectedVersion: '101',
      action: 'replace' as 'update',
    })).toThrow('Неизвестное изменение')
  })

  it('normalizes request-stage corrections independently from results', () => {
    expect(normalizePreHeatTreatmentLnkResultCorrectionPayload({
      relationId: 8,
      expectedVersion: '101',
      stage: 'request',
      action: 'update',
      requestDate: ' 2026-08-03 ',
      requestName: ' Заявка до ТО ',
    })).toEqual(expect.objectContaining({
      relationId: 8,
      stage: 'request',
      action: 'update',
      requestDate: '2026-08-03',
      requestName: 'Заявка до ТО',
    }))
  })

  it('batches a large set of NDT-before-heat-treatment writes', () => {
    expect(splitPreHeatTreatmentWriteBatches(Array.from({ length: 1_201 }, (_, index) => index)))
      .toHaveLength(3)
    expect(splitPreHeatTreatmentWriteBatches(Array.from({ length: 1_201 }, (_, index) => index))
      .map((batch) => batch.length)).toEqual([500, 500, 201])
  })

  it('saves several control positions in one insert/upsert query', async () => {
    let insertCalls = 0
    const tx = {
      insert: () => {
        insertCalls += 1
        return {
          values: (values: Array<Record<string, unknown>>) => ({
            onConflictDoUpdate: () => ({
              returning: async () => values.map((value, index) => ({ ...value, id: index + 1 })),
            }),
          }),
        }
      },
    }

    const saved = await savePreHeatTreatmentControlWrites(tx as never, 'request', [
      { weldJointId: 1, method: 'ВИК', requestName: 'Заявка-1', requestDate: '2026-09-04' },
      { weldJointId: 2, method: 'РК', requestName: 'Заявка-1', requestDate: '2026-09-04' },
    ])

    expect(insertCalls).toBe(1)
    expect(saved.map((record) => [record.weldJointId, record.method])).toEqual([[1, 'ВИК'], [2, 'РК']])
  })

  it('updates several parent weld rows in one query and keeps loaded relations', async () => {
    let insertCalls = 0
    const tx = {
      insert: () => {
        insertCalls += 1
        return {
          values: (values: Array<Record<string, unknown>>) => ({
            onConflictDoUpdate: () => ({ returning: async () => values }),
          }),
        }
      },
    }
    const rows = [{
      id: 1,
      joint: 'F1',
      preHeatTreatmentControls: [{ id: 11, weldJointId: 1, method: 'ВИК' }],
      duplicateControls: [{ id: 12, weldJointId: 1, method: 'РК', result: 'годен', controlDate: '', conclusion: '', conclusionDate: '' }],
      pstoRepeatCycles: [{ id: 13, weldJointId: 1, sequence: 2 }],
    }, {
      id: 2,
      joint: 'F2',
      preHeatTreatmentControls: [{ id: 21, weldJointId: 2, method: 'РК' }],
    }] as WeldRow[]

    const saved = await persistPreHeatTreatmentTouchedRows(
      tx as never,
      rows,
      new Date('2026-09-04T10:00:00.000Z'),
    )

    expect(insertCalls).toBe(1)
    expect(saved.map((row) => row.id)).toEqual([1, 2])
    expect(saved[0]?.preHeatTreatmentControls).toHaveLength(1)
    expect(saved[0]?.duplicateControls).toHaveLength(1)
    expect(saved[0]?.pstoRepeatCycles).toHaveLength(1)
  })
})
