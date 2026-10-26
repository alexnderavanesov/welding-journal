import { persistPstoLineAssignmentRows } from './psto-assignment-transition'
import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  normalizePstoLineAssignmentPayload,
} from '@/server/psto-line-assignment'

describe('PSTO line assignment payload', () => {
  it('normalizes assignment identity without any stage decision', () => {
    expect(normalizePstoLineAssignmentPayload({
      identity: { projectTitle: ' Проект ', subtitleCode: ' 400 ', line: ' L-1 ' },
      action: 'assign', expectedVersions: [{ id: 1, version: ' 101 ' }],
    })).toEqual({
      identity: { projectTitle: 'Проект', subtitleCode: '400', line: 'L-1' },
      action: 'assign', expectedVersions: [{ id: 1, version: '101' }],
      cancellationDate: '', cancellationBasis: '',
      activationDecisions: [],
    })
  })

  it('accepts only whole-package decisions in the direction appropriate to the action', () => {
    const payload = {
      identity: { projectTitle: 'P', subtitleCode: 'S', line: 'L' },
      action: 'assign' as const, expectedVersions: [],
      activationDecisions: [{ rowId: 1, disposition: 'movePrimaryToPreHeatTreatment' as const }],
    }
    expect(normalizePstoLineAssignmentPayload(payload).activationDecisions).toEqual(payload.activationDecisions)
    expect(() => normalizePstoLineAssignmentPayload({ ...payload, action: 'cancel', cancellationDate: '2026-08-10' })).toThrow('целый комплект')
    expect(normalizePstoLineAssignmentPayload({ ...payload, action: 'cancel', cancellationDate: '2026-08-10', activationDecisions: [{ rowId: 1, disposition: 'movePreHeatTreatmentToPrimary' }] }).activationDecisions).toEqual([{ rowId: 1, disposition: 'movePreHeatTreatmentToPrimary' }])
    expect(() => normalizePstoLineAssignmentPayload({ ...payload, activationDecisions: [...payload.activationDecisions, ...payload.activationDecisions] })).toThrow('повторный')
    expect(() => normalizePstoLineAssignmentPayload({ ...payload, activationDecisions: [{ rowId: 1, disposition: 'movePrimaryToPreHeatTreatment', ...{ methodCodes: ['ВИК'] } }] })).toThrow('целый комплект')
  })

  it('only explicitly corrected rows write main control fields, in bounded batches', async () => {
    const writes: Array<{ ids: number[]; set: Record<string, unknown> }> = []
    const tx = { insert: () => ({ values: (rows: Array<Record<string, unknown>>) => ({
      onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
        writes.push({ ids: rows.map(row => Number(row.id)), set })
        return { returning: async () => rows }
      },
    }) }) }
    const rows = Array.from({ length: 201 }, (_, index) => ({ id: index + 1, joint: `F${index + 1}`, pstoRequired: 'да' })) as WeldRow[]
    const corrected = new Set(rows.slice(0, 101).map(row => row.id))
    await persistPstoLineAssignmentRows(tx as never, rows, new Date(), corrected)
    expect(writes.map(write => write.ids.length)).toEqual([100, 100, 1])
    for (const write of writes) {
      if (corrected.has(write.ids[0]!)) expect(write.set).toHaveProperty('vikRequest')
      else expect(write.set).not.toHaveProperty('vikRequest')
    }
  })

  it.each(['assign', 'reactivate'] as const)('rejects obsolete transfer instructions on %s instead of silently changing their meaning', action => {
    expect(() => normalizePstoLineAssignmentPayload({
      identity: { projectTitle: 'Проект', subtitleCode: '400', line: 'L-1' },
      action, expectedVersions: [],
      ...{ activationDecisions: [{ rowId: 1, disposition: 'movePrimaryToBeforeHeatTreatment', methodCodes: ['ВИК'] }] as never },
    })).toThrow('Смена этапа НК больше не поддерживается')
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

  it('keeps large line writes bounded to batches of 100 without control relation writes', async () => {
    const batches: number[] = []
    const tx = { insert: () => ({ values: (rows: Array<Record<string, unknown>>) => {
      batches.push(rows.length)
      return { onConflictDoUpdate: () => ({ returning: async () => rows }) }
    } }) }
    const rows = Array.from({ length: 501 }, (_, index) => ({
      id: index + 1, joint: `F${index + 1}`, pstoRequired: 'да',
      preHeatTreatmentControls: [{ id: index + 1000, weldJointId: index + 1 }],
    })) as WeldRow[]
    const saved = await persistPstoLineAssignmentRows(tx as never, rows)
    expect(batches).toEqual([100, 100, 100, 100, 100, 1])
    expect(saved).toHaveLength(501)
    expect(saved.every((row, index) => row.preHeatTreatmentControls === rows[index].preHeatTreatmentControls)).toBe(true)
  })

  it('persists a whole line with one batch write instead of one query per weld', async () => {
    let insertCalls = 0
    const tx = {
      insert: () => {
        insertCalls += 1
        return {
          values: (values: Array<Record<string, unknown>>) => ({
            onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
              for (const key of ['vikRequest', 'vikResult', 'rkConclusion', 'pstoRequest', 'pstoResult', 'tvmtResult', 'lnkUpdatedAt']) {
                expect(set).not.toHaveProperty(key)
                expect(values[0]).not.toHaveProperty(key)
              }
              return { returning: async () => values }
            },
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
    )

    expect(insertCalls).toBe(1)
    expect(saved.map((row) => row.id)).toEqual([1, 2])
    expect(saved[0]?.preHeatTreatmentControls).toHaveLength(1)
    expect(saved[1]?.pstoRepeatCycles).toHaveLength(1)
  })
})
