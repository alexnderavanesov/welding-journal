import { describe, expect, it, vi } from 'vitest'
import type { WeldJoint } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import { getPstoLineIdentityKey } from '@/lib/psto-line-assignment'
import { preparePstoLineMoveRecordInTransaction } from './weld-line-move-stage'
import { toDbInsert } from './weld-persistence'
import type { ServerWeldValidationContext } from './weld-save-validation'

function fixture(result: string | null) {
  return {
    id: 1, joint: 'F1', projectTitle: 'P', subtitleCode: 'S', line: 'source',
    pstoRequired: 'да', vikRequest: 'MAIN-REQ', vikRequestDate: '2026-08-01',
    vikResult: 'годен', vikConclusionDate: '2026-08-02', vikConclusion: 'MAIN-CONCLUSION',
    pstoRequest: 'PSTO-1', pstoRequestDate: '2026-08-03',
    pstoResult: 'проведено', pstoDate: '2026-08-04', heatTreatmentDiagram: 'DIAGRAM-1',
    tvmtRequest: 'TVMT-1', tvmtRequestDate: '2026-08-04',
    tvmtResult: 'годен', tvmtConclusion: 'TVMT-CONCLUSION', tvmtConclusionDate: '2026-08-05',
    preHeatTreatmentControls: [{ id: 11, weldJointId: 1, method: 'ВИК',
      requestName: 'PRE-REQ', requestDate: '2026-07-29', result,
      conclusionDate: result ? '2026-07-30' : null, conclusionName: result ? 'PRE-CONCLUSION' : null }],
    duplicateControls: [{ id: 12, weldJointId: 1, method: 'ВИК', result: 'годен', conclusion: 'DUPLICATE' }],
    pstoRepeatCycles: [{ id: 13, weldJointId: 1, sequence: 2, pstoRequest: 'PSTO-2', pstoRequestDate: '2026-08-06' }],
  } as unknown as WeldRow
}

function context(record: WeldRow, target: string): ServerWeldValidationContext {
  return {
    controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS,
    saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS, dataListSettings: DEFAULT_DATA_LIST_SETTINGS,
    otherSettings: DEFAULT_OTHER_SETTINGS, systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
    welderStamps: [], welderStampSuspensions: [],
    pstoLineAssignments: new Map([[getPstoLineIdentityKey(record), {
      rowCount: 2, assignedCount: target === 'assigned' ? 2 : 0,
      cancelledCount: target === 'cancelled' ? 2 : 0,
      cancellationDate: '2026-08-20', cancellationBasis: 'DECISION',
    }]]),
  }
}

describe('line moves preserve recorded stages', () => {
  function primaryMovable() {
    return { id: 1, joint: 'F1', projectTitle: 'P', subtitleCode: 'S', line: 'source',
      officiality: 'действующий', hasVik: 'да', weldDate: '2026-07-01',
      vikRequest: 'ВИК-З', vikRequestDate: '2026-07-02', vikResult: 'годен', vikConclusion: 'ВИК-К', vikConclusionDate: '2026-07-03',
      preHeatTreatmentControls: [], pstoRepeatCycles: [],
    } as unknown as WeldRow
  }
  async function toAssigned(previous = primaryMovable(), edits: Partial<WeldRow> = {}, target = 'assigned') {
    const record = { ...previous, line: 'target', ...edits }
    return preparePstoLineMoveRecordInTransaction({ tx: {} as never, record, previousStored: previous as unknown as WeldJoint,
      validationContext: context(record, target), processSettings: DEFAULT_CONTROL_PROCESS_SETTINGS, disposition: 'movePrimaryToPreHeatTreatment' })
  }
  it('moves the primary package onto an assigned line without inheriting other welds history', async () => {
    const next = await toAssigned()
    expect(next.record).toMatchObject({ line: 'target', pstoRequired: 'да', vikRequest: null, vikResult: null })
    expect(next.record.preHeatTreatmentControls).toEqual([expect.objectContaining({ method: 'ВИК', requestName: 'ВИК-З', conclusionName: 'ВИК-К', conclusionDate: '2026-07-03' })])
    expect(next.transferredToPreHeatTreatment).toBe(true)
    expect(next.validationPrevious.weldDate).toBe('2026-07-01')
  })
  it.each([
    { pstoRequest: 'ПСТО-1' }, { pstoDate: '2026-07-04', pstoResult: 'проведено' },
    { pstoRepeatCycles: [{ id: 5, weldJointId: 1, sequence: 2 }] },
    { preHeatTreatmentControls: [{ id: 8, weldJointId: 1, method: 'ВИК' }] },
  ])('does not use the new assigned-line choice to rewrite protected or occupied stages: %j', change => {
    return expect(toAssigned({ ...primaryMovable(), ...change } as WeldRow)).rejects.toThrow()
  })
  it('rejects the wrong direction, unchanged line, and bad chronology on the new path', async () => {
    await expect(toAssigned(primaryMovable(), {}, 'unassigned')).rejects.toThrow('назначенной ПСТО')
    await expect(toAssigned(primaryMovable(), { line: 'source' })).rejects.toThrow('назначенной ПСТО')
    await expect(toAssigned(primaryMovable(), { weldDate: '2026-07-10' })).rejects.toThrow()
  })
  function movable() {
    return {
      id: 1, joint: 'F1', projectTitle: 'P', subtitleCode: 'S', line: 'source',
      officiality: 'действующий', revisionActuality: 'актуальная', hasVik: 'да',
      weldDate: '2026-07-01', pstoRequired: 'да',
      preHeatTreatmentControls: [{ id: 11, weldJointId: 1, method: 'ВИК',
        requestName: 'PRE-REQ', requestDate: '2026-07-02', result: 'годен',
        conclusionDate: '2026-07-03', conclusionName: 'PRE-CONCLUSION' }],
    } as WeldRow
  }

  async function prepareCorrection(previous: WeldRow, edits: Partial<WeldRow> = {}, target = 'unassigned') {
    const record = { ...previous, line: 'target', ...edits }
    return preparePstoLineMoveRecordInTransaction({
      tx: {} as never, record, previousStored: previous as unknown as WeldJoint,
      validationContext: context(record, target), processSettings: DEFAULT_CONTROL_PROCESS_SETTINGS,
      disposition: 'movePreHeatTreatmentToPrimary',
    })
  }

  it('explicitly corrects the full pre-TO package on an unassigned destination, without writes during preparation', async () => {
    const previous = movable()
    const result = await prepareCorrection(previous)
    expect(result.record).toMatchObject({ line: 'target', pstoRequired: null, vikRequest: 'PRE-REQ',
      vikRequestDate: '2026-07-02', vikResult: 'годен', vikConclusion: 'PRE-CONCLUSION',
      vikConclusionDate: '2026-07-03', preHeatTreatmentControls: [] })
    expect(result.transferredPreControlIds).toEqual([11])
    expect(previous.preHeatTreatmentControls).toHaveLength(1)
  })

  it('validates the actual edited weld date, not just the old preview date', async () => {
    await expect(prepareCorrection(movable(), { weldDate: '2026-07-10' })).rejects.toThrow(/дат|свар/)
  })

  it('preserving stages does not grandfather simultaneous edits to the weld date or officiality', async () => {
    const previous = movable()
    const record = { ...previous, line: 'target', weldDate: '2026-07-10', officiality: 'неофициальный' }
    const result = await preparePstoLineMoveRecordInTransaction({
      tx: {} as never, record, previousStored: previous as unknown as WeldJoint,
      validationContext: context(record, 'unassigned'), processSettings: DEFAULT_CONTROL_PROCESS_SETTINGS,
      disposition: 'keepPrimary',
    })
    expect(result.validationPrevious.weldDate).toBe(previous.weldDate)
    expect(result.validationPrevious.officiality).toBe(previous.officiality)
    expect(result.record.weldDate).toBe('2026-07-10')
  })

  it('does not allow the correction without a real move or onto an assigned destination', async () => {
    await expect(prepareCorrection(movable(), { line: 'source' })).rejects.toThrow('другую линию без ПСТО')
    await expect(prepareCorrection(movable(), {}, 'assigned')).rejects.toThrow('другую линию без ПСТО')
  })

  it.each(['', ' ', '-', 'sou\nrce'])('rejects an empty or persistence-equivalent target (%s)', async line => {
    const previous = { ...movable(), line: line === 'sou\nrce' ? 'sou rce' : 'source' }
    await expect(prepareCorrection(previous, { line })).rejects.toThrow('другую линию без ПСТО')
  })

  it('normalizes repeated whitespace before determining whether a real move occurred', async () => {
    await expect(prepareCorrection({ ...movable(), line: 'L 1' }, { line: 'L  1' })).rejects.toThrow('другую линию без ПСТО')
  })

  it.each(['assigned', 'unassigned', 'cancelled'])('preserves existing raw NK and PSTO facts through persistence when keeping stages on %s', async target => {
    const previous = { ...fixture('годен'), weldDate: '2026-07-01', hasVik: 'да',
      vikResult: 'годен (отменен)', vikDefectDescription: 'Историческое описание\nбез замены',
      vikRequest: '  Исходная  заявка ', pstoResult: 'проведено (отменен)',
      pstoNote: 'Историческое\nпримечание', tvmtResult: 'не годен',
    } as WeldRow
    const record = { ...previous, line: 'target' }
    const prepared = await preparePstoLineMoveRecordInTransaction({
      tx: {} as never, record, previousStored: previous as unknown as WeldJoint,
      validationContext: context(record, target), processSettings: DEFAULT_CONTROL_PROCESS_SETTINGS,
      disposition: 'keepPrimary',
    })
    expect(prepared.preserveRecordedControlHistory).toBe(true)
    const payload = toDbInsert(prepared.record, false, {
      preserveRecordedControlHistory: prepared.preserveRecordedControlHistory,
    })
    for (const key of ['vikResult', 'vikDefectDescription', 'vikRequest', 'pstoRequest', 'pstoRequestDate',
      'pstoDate', 'heatTreatmentDiagram', 'pstoResult', 'pstoNote', 'tvmtRequest', 'tvmtResult', 'tvmtConclusion'] as const) {
      expect(payload[key], key).toBe(previous[key])
    }
    expect(payload.line).toBe('target')
    expect(prepared.record.preHeatTreatmentControls).toEqual(previous.preHeatTreatmentControls)
    expect(prepared.record.pstoRepeatCycles).toEqual(previous.pstoRepeatCycles)
    // This is the old, faulty line-move write: normalization rewrites real facts.
    expect(toDbInsert(prepared.record).vikDefectDescription).toBe('ДНО')
  })

  it('does not change ordinary persistence semantics when no line move occurs', async () => {
    const previous = movable()
    const prepared = await preparePstoLineMoveRecordInTransaction({
      tx: {} as never, record: previous, previousStored: previous as unknown as WeldJoint,
      validationContext: context(previous, 'assigned'), processSettings: DEFAULT_CONTROL_PROCESS_SETTINGS,
    })
    expect(prepared.preserveRecordedControlHistory).toBe(false)
  })

  it('blocks a request-only PSTO dependency and occupied target stage without changing either', async () => {
    await expect(prepareCorrection({ ...movable(), pstoRequest: 'PSTO-REQ', pstoRequestDate: '2026-07-04' })).rejects.toThrow('ПСТО/ТВМТ')
    await expect(prepareCorrection({ ...movable(), rkRequest: 'MAIN-REQ', rkRequestDate: '2026-07-02' })).rejects.toThrow('уже заполнен')
  })

  it('checks the cancellation date against all pre-TO events when correcting onto a cancelled line', async () => {
    const previous = movable()
    previous.preHeatTreatmentControls![0]!.conclusionDate = '2026-08-25'
    await expect(prepareCorrection(previous, {}, 'cancelled')).rejects.toThrow('раньше последнего сохраненного события')
  })
  for (const target of ['assigned', 'unassigned', 'cancelled']) {
    it.each([null, 'годен', 'ремонт'])(`keeps both occupied stages, documents and cycles on ${target} (pre result=%s)`, async result => {
      const previous = fixture(result)
      const before = structuredClone(previous)
      const record = { ...previous, line: 'target' }
      const query = vi.fn(() => { throw new Error('A line move must not rewrite stage relations') })
      const tx = { insert: query, update: query, delete: query, select: query, execute: query }
      const prepared = await preparePstoLineMoveRecordInTransaction({
        tx: tx as never, record, previousStored: previous as unknown as WeldJoint,
        validationContext: context(record, target), processSettings: DEFAULT_CONTROL_PROCESS_SETTINGS,
      })
      for (const [key, value] of Object.entries(before)) {
        if (['line', 'pstoRequired'].includes(key)) continue
        expect(prepared.record[key as keyof WeldRow], key).toEqual(value)
      }
      expect(prepared.record.line).toBe('target')
      expect(previous).toEqual(before)
      expect(query).not.toHaveBeenCalled()
    })
  }

  it.each(['promoteBeforeHeatTreatment', 'movePrimaryToBeforeHeatTreatment', 'deletePrimary'])('rejects obsolete instruction %s before touching facts', async disposition => {
    const previous = fixture('годен')
    const record = { ...previous, line: 'target' }
    await expect(preparePstoLineMoveRecordInTransaction({
      tx: {} as never, record, previousStored: previous as unknown as WeldJoint,
      validationContext: context(record, 'assigned'), processSettings: DEFAULT_CONTROL_PROCESS_SETTINGS,
      disposition: disposition as never,
    })).rejects.toThrow('Смена этапа НК больше не поддерживается')
  })
})
