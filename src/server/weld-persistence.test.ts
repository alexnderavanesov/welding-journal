import { describe, expect, it, vi } from 'vitest'

import type { WeldJoint } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/report-config'
import { buildWeldBatchUpdatePayload, toDbInsert, updateWeldJointsInBatches, WELD_BATCH_UPDATE_SET } from '@/server/weld-persistence'
import { getPrimaryPstoCyclePersistenceValues } from '@/server/psto-cycle-state'
import * as weldStatus from '@/lib/weld-status'

vi.mock('@/server/line-program-registry', () => ({ prepareLineProgramWeldRecords: vi.fn() }))
vi.mock('@/server/technology-card-weld-write', () => ({ prepareTechnologyCardWeldWrites: vi.fn() }))
vi.mock('@/server/program-approval-lifecycle', () => ({ deleteChangedProgramApprovals: vi.fn() }))

function correctedPrimary(id = 1): WeldRow {
  return {
    id, joint: `F${id}`, line: '  Линия  1 ', weldDate: '01.08.2026',
    officiality: 'действующий', finalStatus: 'ошибка', rkExposureConfirmedDiameter: 219.1,
    lnkNote: '  Общее  примечание ', preHeatTreatmentControls: [],
    ...Object.fromEntries(LNK_METHODS.flatMap(method => [
      [method.enabledKey, ' Да '],
      [method.requestKey, `  Заявка ${method.code}  № 1 `],
      [method.requestDateKey, '02.08.2026'],
      [method.resultKey, 'годен (отменен)'],
      [method.conclusionKey, `  Заключение ${method.code}  № 1 `],
      [method.conclusionDateKey, '03.08.2026'],
      [method.defectDescriptionKey, `  ${method.code}: история\nописания  `],
    ])),
  } as WeldRow
}

function expectPreservedPrimary(payload: ReturnType<typeof toDbInsert>, record: WeldRow) {
  for (const method of LNK_METHODS) {
    for (const key of [method.requestKey, method.requestDateKey, method.resultKey,
      method.conclusionKey, method.conclusionDateKey, method.defectDescriptionKey]) {
      expect(payload[key], key).toBe(record[key])
    }
    expect(payload[method.enabledKey]).toBe('да')
  }
  expect(payload.rkExposureConfirmedDiameter).toBe(record.rkExposureConfirmedDiameter)
  expect(payload).toMatchObject({ line: 'Линия 1', weldDate: '2026-08-01', lnkNote: 'Общее примечание' })
}

describe('recorded control history persistence opt-in', () => {
  const now = new Date('2026-10-09T00:00:00Z')
  const payloadBuilders = [
    ['single', (record: WeldRow, preserveRecordedControlHistory?: boolean) =>
      toDbInsert(record, false, { preserveRecordedControlHistory })],
    ['batch', (record: WeldRow, preserveRecordedControlHistory?: boolean) =>
      buildWeldBatchUpdatePayload(record, new Map([[record.id, record as unknown as WeldJoint]]), now,
        { preserveRecordedControlHistory })],
  ] as const

  describe.each(payloadBuilders)('%s payload', (_name, build) => {
    it.each(['годен (отменен)', 'годен · назначение отменено', 'отменен'])('keeps the complete validated package verbatim: %s', result => {
      const record = correctedPrimary()
      for (const method of LNK_METHODS) record[method.resultKey] = result
      const before = structuredClone(record)
      const payload = build(Object.freeze(record), true)
      expectPreservedPrimary(payload, record)
      expect(payload.finalStatus).toBe(weldStatus.calculateFinalStatus({ ...record, ...payload }))
      expect(payload.finalStatus).not.toBe('ошибка')
      expect(record).toEqual(before)
    })

    it.each([undefined, false])('retains ordinary normalization without opt-in (%s)', flag => {
      const payload = build(correctedPrimary(), flag)
      expect(payload).toMatchObject({ vikResult: 'годен', vikDefectDescription: 'ДНО',
        vikRequest: 'Заявка ВИК № 1', vikRequestDate: '2026-08-02',
        vikConclusion: 'Заключение ВИК № 1', vikConclusionDate: '2026-08-03',
        rkExposureConfirmedDiameter: 219.1 })
    })

    it('preserves explicit nulls and includes loaded relations in the recomputed status', () => {
      const record = correctedPrimary()
      record.vikResult = null
      record.vikConclusion = null
      record.vikConclusionDate = null
      record.vikDefectDescription = null
      record.rkExposureConfirmedDiameter = null
      record.duplicateControls = [{ id: 9, weldJointId: record.id, method: 'РК', result: 'ремонт',
        controlDate: '2026-08-04', conclusion: 'Дубль-1', conclusionDate: '2026-08-04' }]
      const calculate = vi.spyOn(weldStatus, 'calculateFinalStatus')
      try {
        const payload = build(record, true)
        expectPreservedPrimary(payload, record)
        expect(calculate).toHaveBeenLastCalledWith(expect.objectContaining({
          vikRequest: record.vikRequest, vikResult: null, duplicateControls: record.duplicateControls,
        }))
        expect(payload.finalStatus).toBe('не годен по дублю')
      } finally {
        calculate.mockRestore()
      }
    })
  })

  it.each([true, false])('applies the option only to selected rows in actual batch writes (selected=%s)', async selected => {
    const records = [correctedPrimary(1), correctedPrimary(2)]
    const previousRows = new Map(records.map(record => [record.id, record as unknown as WeldJoint]))
    const lockQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(), for: vi.fn().mockResolvedValue(records.map(({ id }) => ({ id }))) }
    const values = vi.fn((batch: ReturnType<typeof toDbInsert>[]) => ({
      onConflictDoUpdate: vi.fn(() => ({ returning: vi.fn().mockResolvedValue(
        batch.map(row => ({ ...row, rowVersion: '2' })),
      ) })),
    }))
    const tx = { select: vi.fn(() => lockQuery), insert: vi.fn(() => ({ values })) }
    const rows = await updateWeldJointsInBatches(tx as unknown as Parameters<typeof updateWeldJointsInBatches>[0], records,
      previousRows, selected ? { preserveRecordedControlHistoryRowIds: new Set([1]) } : {})
    expect(values).toHaveBeenCalledTimes(1)
    const [first, second] = values.mock.calls[0]![0]
    if (selected) expectPreservedPrimary(first!, records[0]!)
    else expect(first!.vikResult).toBe('годен')
    expect(second).toMatchObject({ vikResult: 'годен', vikDefectDescription: 'ДНО', vikRequestDate: '2026-08-02' })
    expect(rows.map(row => row.id)).toEqual([1, 2])
    expect(tx.select).toHaveBeenCalledTimes(1)
    expect(tx.insert).toHaveBeenCalledTimes(1)
  })

  it('keeps both recorded stages verbatim for a chain line move without skipping welding-field normalization', () => {
    const record = { ...correctedPrimary(), pstoRequired: 'да',
      pstoResult: 'проведено (отменен)', pstoRequest: '  Исходная  заявка ПСТО ',
      pstoRequestDate: '04.08.2026', pstoDate: '05.08.2026',
      pstoNote: 'Строка 1\nСтрока 2', heatTreatmentDiagram: '  Диаграмма  1 ',
      tvmtRequest: '  Заявка ТВМТ ', tvmtRequestDate: '06.08.2026', tvmtResult: 'не годен',
      tvmtConclusion: '  Заключение ТВМТ ', tvmtConclusionDate: '07.08.2026',
    } as WeldRow
    const payload = buildWeldBatchUpdatePayload(record, new Map([[record.id, record as unknown as WeldJoint]]), now,
      { preserveRecordedControlHistory: true })
    expectPreservedPrimary(payload, record)
    for (const key of ['pstoResult', 'pstoRequest', 'pstoRequestDate', 'pstoDate', 'pstoNote', 'heatTreatmentDiagram',
      'tvmtRequest', 'tvmtRequestDate', 'tvmtResult', 'tvmtConclusion', 'tvmtConclusionDate'] as const) {
      expect(payload[key], key).toBe(record[key])
    }
  })
})

describe('weld persistence', () => {
  it.each(['ТК  №12', 'ТК\u00a0№12'])('keeps exact TK identifier %s in individual and batch saves', technologyCardNumber => {
    const previous = { id: 1, joint: 'F1', technologyCardNumber } as WeldJoint
    const record = { ...previous, note: 'Несвязанная правка' } as WeldRow
    expect(toDbInsert(record).technologyCardNumber).toBe(technologyCardNumber)
    expect(buildWeldBatchUpdatePayload(record, new Map([[1, previous]]), new Date('2026-10-09T00:00:00Z')))
      .toMatchObject({ technologyCardNumber })
  })

  it.each(LNK_METHODS)('preserves incomplete $code request history on an unrelated save', (method) => {
    const previous = {
      id: 1,
      joint: 'F1',
      [method.enabledKey]: null,
      [method.requestKey]: null,
      [method.requestDateKey]: '2026-09-01',
      [method.resultKey]: 'ожидает НК',
    } as unknown as WeldJoint
    const record = { ...previous, note: 'Исправлено примечание' } as unknown as WeldRow
    const expected = {
      [method.requestDateKey]: '2026-09-01',
      [method.resultKey]: 'ожидает НК',
    }

    expect(toDbInsert(record)).toMatchObject(expected)
    expect(buildWeldBatchUpdatePayload(
      record,
      new Map([[previous.id, previous]]),
      new Date('2026-09-02T00:00:00.000Z'),
    )).toMatchObject(expected)
  })

  it('writes officiality only to its final database column', () => {
    const populated = toDbInsert({ officiality: 'неофициальный' })
    const empty = toDbInsert({ officiality: null })

    expect(populated).toMatchObject({ officiality: 'неофициальный' })
    expect(populated).not.toHaveProperty('legacyStatus')
    expect(empty).toMatchObject({ officiality: null })
    expect(empty).not.toHaveProperty('legacyStatus')
  })

  it('writes assignment values in their canonical storage form', () => {
    expect(toDbInsert({ pstoRequired: ' Да ', hasVik: 'ДА', hasRk: 'Нет' })).toMatchObject({
      pstoRequired: 'да',
      hasVik: 'да',
      hasRk: null,
    })
    expect(toDbInsert({ pstoRequired: '0' }).pstoRequired).toBeNull()
  })

  it('does not persist a line-inherited pre-TO exemption in batch updates', () => {
    const previous = {
      id: 1,
      joint: 'F1',
      preHeatTreatmentLnkExempt: false,
    } as WeldJoint
    const record = {
      ...previous,
      line: 'Освобожденная линия',
      preHeatTreatmentLnkExempt: true,
    } as unknown as WeldRow

    expect(buildWeldBatchUpdatePayload(
      record,
      new Map([[previous.id, previous]]),
      new Date('2026-09-02T00:00:00.000Z'),
    )).not.toHaveProperty('preHeatTreatmentLnkExempt')
  })

  it('leaves the obsolete stored flag untouched in every persistence payload', () => {
    const previous = {
      id: 2,
      joint: 'F2',
      pstoRequest: 'Историческая заявка ПСТО',
      preHeatTreatmentLnkExempt: true,
    } as WeldJoint
    const record = {
      ...previous,
      preHeatTreatmentLnkExempt: false,
    } as unknown as WeldRow

    expect(buildWeldBatchUpdatePayload(
      record,
      new Map([[previous.id, previous]]),
      new Date('2026-09-02T00:00:00.000Z'),
    )).not.toHaveProperty('preHeatTreatmentLnkExempt')
    expect(WELD_BATCH_UPDATE_SET).not.toHaveProperty('preHeatTreatmentLnkExempt')
    expect(toDbInsert(record)).not.toHaveProperty('preHeatTreatmentLnkExempt')
    expect(getPrimaryPstoCyclePersistenceValues(record)).not.toHaveProperty('preHeatTreatmentLnkExempt')
  })

  it('persists officiality in batch updates without a compatibility column', () => {
    const previous = {
      id: 3,
      officiality: null,
      preHeatTreatmentLnkExempt: false,
    } as WeldJoint
    const record = {
      ...previous,
      officiality: 'неофициальный',
    } as unknown as WeldRow

    const payload = buildWeldBatchUpdatePayload(
      record,
      new Map([[previous.id, previous]]),
      new Date('2026-09-02T00:00:00.000Z'),
    )

    expect(payload).toMatchObject({ officiality: 'неофициальный' })
    expect(payload).not.toHaveProperty('legacyStatus')
  })
})
