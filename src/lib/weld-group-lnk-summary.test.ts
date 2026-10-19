import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { createWeldGroupSummarizer } from './weld-group-summary'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'

const row = (id: number, extra: Partial<WeldRow> = {}): WeldRow => ({
  id, projectTitle: 'P', subtitleCode: 'C', line: 'L', joint: `S${id}`, weldDate: '2026-09-01', wdi: 10,
  hasVik: 'да', hasRk: 'да', hasUzk: 'да', hasPvk: 'да',
  vikResult: 'годен', rkResult: 'годен', uzkResult: 'годен', pvkResult: 'годен', finalStatus: 'годен',
  programChainState: { kind: 'ordinary', physicalRootId: id, sourceRowId: null, coilParentId: null, coilSide: null, replacedByCoil: false, replacementCoilIds: [] },
  ...extra,
} as WeldRow)
const summary = (rows: WeldRow[]) => createWeldGroupSummarizer(rows, DEFAULT_SYSTEM_INDEX_SETTINGS, { lnk: true })(rows)
const pre = (id: number, method: string, result?: string | null, requestName?: string | null) => ({ id, weldJointId: 1, method, result, requestName })

describe('LNK physical group results', () => {
  it('keeps each method and stage separate from the final joint status and leaves journal/PSTO unchanged', () => {
    const rows = [row(1, { finalStatus: 'ошибка', rkResult: 'ремонт', preHeatTreatmentLnkEnabled: true, pstoRequired: 'да',
      preHeatTreatmentControls: [pre(11, 'ВИК', 'годен'), pre(12, 'РК', 'вырез'), pre(13, 'УЗК', null, 'PRE')] })]
    expect(summary(rows).lnkResults).toMatchObject({
      vikResult: { status: 'годен', errors: 0 }, rkResult: { status: 'не годен', rejected: 1 },
      uzkResult: { status: 'годен' }, preVikResult: { status: 'годен' },
      preRkResult: { status: 'не годен', rejected: 1 }, preUzkResult: { status: 'нет потребности' },
    })
    expect(createWeldGroupSummarizer(rows)(rows)).not.toHaveProperty('lnkResults')
    expect(createWeldGroupSummarizer(rows, undefined, { heatTreatment: true })(rows)).not.toHaveProperty('lnkResults')
  })
  it('counts a repaired physical connection once without borrowing the predecessor result', () => {
    const original = row(1, { rkResult: 'ремонт', finalStatus: 'не годен' })
    const repaired = row(2, { joint: 'S1R1', rkResult: 'годен', programChainState: { ...original.programChainState!, kind: 'repair', physicalRootId: 1, sourceRowId: 1 } })
    expect(summary([original, repaired])).toMatchObject({ joints: 1, lnkResults: { rkResult: { status: 'годен', rejected: 0, counts: { годен: 1 } } } })
    repaired.rkResult = ''; repaired.rkRequest = 'NEW'
    expect(summary([original, repaired]).lnkResults?.rkResult).toMatchObject({ status: 'ожидает НК', rejected: 0 })
    const calculate = createWeldGroupSummarizer([original, repaired], undefined, { lnk: true })
    repaired.rkResult = 'годен'
    expect(calculate([repaired]).lnkResults?.vikResult.status).toBe('неполная цепочка')
  })
  it('retains history errors only in their own method/stage, including replaced history', () => {
    const original = row(1, { vikResult: 'ошибка', finalStatus: 'не годен', hasVik: 'отменен',
      preHeatTreatmentControls: [pre(11, 'РК', 'ошибка')] })
    const repaired = row(2, { joint: 'S1R1', programChainState: { ...original.programChainState!, kind: 'repair', physicalRootId: 1, sourceRowId: 1 } })
    expect(summary([original, repaired]).lnkResults).toMatchObject({ vikResult: { status: 'ошибка', errors: 1 },
      rkResult: { status: 'годен', errors: 0 }, preRkResult: { status: 'ошибка', errors: 1 } })
    original.programChainState!.replacedByCoil = true
    expect(summary([original]).lnkResults?.vikResult.status).toBe('ошибка')
    expect(summary([original]).lnkResults?.rkResult.status).toBe('заменены катушкой')
  })
  it('uses early waiting with a separate current rejection counter', () => {
    const rows = [row(1, { rkResult: 'вырез', finalStatus: 'не годен' }), row(2, { rkResult: '', rkRequest: 'RK' }), row(3, { rkResult: '' })]
    expect(summary(rows).lnkResults?.rkResult).toMatchObject({ status: 'ожидает заявку', rejected: 1,
      counts: { 'не годен': 1, 'ожидает НК': 1, 'ожидает заявку': 1 } })
    rows.pop()
    expect(summary(rows).lnkResults?.rkResult.status).toBe('ожидает НК')
  })
  it('does not turn cancellation, lack of need or unassigned controls into a good group', () => {
    const rows = [row(1), row(2, { hasRk: 'отменен', rkResult: '' }), row(3, { hasRk: 'нет', rkResult: '' }),
      row(4, { rkResult: '', vikResult: 'ремонт', finalStatus: 'не годен' })]
    expect(summary(rows).lnkResults?.rkResult).toMatchObject({ status: 'разные результаты',
      counts: { годен: 1, отменен: 1, 'не требуется': 1, 'нет потребности': 1 } })
    expect(summary([row(1, { hasRk: 'отменен', rkResult: 'вырез' })]).lnkResults?.rkResult).toMatchObject({ status: 'не годен', rejected: 1 })
    expect(summary([row(1, { hasRk: 'отменен' })]).lnkResults?.rkResult.status).toBe('годен · назначение отменено')
  })
  it('does not inherit line history or demand pre-TO work when the stage is disabled or unnecessary', () => {
    const historical = row(1, { preHeatTreatmentLnkEnabled: true, preHeatTreatmentControls: [pre(11, 'ВИК', 'годен')] })
    const fresh = row(2, { preHeatTreatmentLnkEnabled: true })
    expect(summary([historical, fresh]).lnkResults?.preVikResult).toMatchObject({ status: 'разные результаты', counts: { годен: 1, 'не требуется': 1 } })
    expect(summary([row(1, { preHeatTreatmentLnkEnabled: false, pstoRequired: 'да', preHeatTreatmentControls: [pre(11, 'ВИК', 'годен')] })]).lnkResults?.preVikResult.status).toBe('этап выключен')
    expect(summary([row(1, { preHeatTreatmentLnkEnabled: true, preHeatTreatmentControls: [pre(11, 'ВИК', 'ожидает НК', 'HISTORY')] })]).lnkResults?.preVikResult.status).toBe('не требуется')
  })
  it('shows missing requests and results for a required pre-TO method without reusing main results', () => {
    const item = row(1, { preHeatTreatmentLnkEnabled: true, pstoRequired: 'да' })
    expect(summary([item]).lnkResults?.preRkResult.status).toBe('ожидает заявку')
    item.preHeatTreatmentControls = [pre(11, 'РК', null, 'PRE')]
    expect(summary([item]).lnkResults?.preRkResult.status).toBe('ожидает НК')
    item.preHeatTreatmentControls[0].result = 'годен'
    expect(summary([item]).lnkResults?.preRkResult.status).toBe('годен')
  })
  it('keeps a retained pre-TO rejection after moving to an unassigned line, without contaminating primary facts', () => {
    const item = row(1, { preHeatTreatmentLnkEnabled: true, preHeatTreatmentControls: [pre(11, 'УЗК', 'ремонт')] })
    expect(summary([item]).lnkResults).toMatchObject({ preUzkResult: { status: 'не годен', rejected: 1 }, uzkResult: { status: 'годен' } })
  })
  it('normalizes legacy good aliases, counts both coil sides, and handles empty groups', () => {
    const root = row(1, { rkResult: 'вырез', programChainState: { ...row(1).programChainState!, replacedByCoil: true } })
    expect(summary([root, row(2, { joint: 'S1Y1', rkResult: ' ДА ' }), row(3, { joint: 'S1Y2' })])).toMatchObject({ joints: 2,
      lnkResults: { rkResult: { status: 'годен', rejected: 0, counts: { годен: 2 } } } })
    expect(summary([]).lnkResults?.rkResult).toMatchObject({ status: '—', counts: {} })
  })
})
