import { describe, expect, it } from 'vitest'
import { createWeldGroupSummarizer } from './weld-group-summary'
import type { WeldRow } from './dispatcher-types'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'

function row(id: number, joint: string, status = 'годен', changes: Partial<WeldRow> = {}): WeldRow {
  return { id, joint, line: 'L1', projectTitle: 'P', subtitleCode: 'C', weldDate: '2026-09-01', wdi: 10,
    finalStatus: status, programChainState: { weldJointId: id, kind: 'primary', physicalRootId: id,
      sourceRowId: null, coilParentId: null, coilSide: null, replacedByCoil: false }, ...changes }
}
function repair(id: number, root: number, source: number, status: string): WeldRow {
  return row(id, `S${root}R${id}`, status, { wdi: 99, programChainState: {
    weldJointId: id, kind: 'repair', physicalRootId: root, sourceRowId: source,
    coilParentId: null, coilSide: null, replacedByCoil: false,
  } })
}
const summarize = (rows: WeldRow[]) => createWeldGroupSummarizer(rows)(rows)
const summarizePsto = (rows: WeldRow[]) => createWeldGroupSummarizer(rows, DEFAULT_SYSTEM_INDEX_SETTINGS, { heatTreatment: true })(rows)
function pstoRow(id: number, changes: Partial<WeldRow> = {}): WeldRow {
  return row(id, `S${id}`, 'годен', { finalStatus: undefined, pstoRequired: 'да', pstoRequest: `ПСТО-${id}`,
    pstoResult: 'проведено', tvmtRequest: `ТВМТ-${id}`, tvmtResult: 'годен', ...changes })
}

describe('grouped physical connections (not journal record totals)', () => {
  it('counts a good repair chain once and uses root WDI, independently of row order', () => {
    const rows = [row(1, 'S1'), row(2, 'S2', 'не годен'), repair(3, 2, 2, 'не годен'), repair(4, 2, 3, 'годен')]
    expect(summarize(rows.reverse())).toMatchObject({ joints: 2, wdi: 20, status: 'годен', rejected: 0, partialChains: 0 })
  })
  it('replaces the entire old branch with two separate coil connections, including repaired coil sides', () => {
    const original = row(2, 'S2', 'не годен')
    original.programChainState!.replacedByCoil = true
    const coil1 = row(5, 'S2Y1', 'не годен')
    const coil2 = row(6, 'S2Y2', 'годен')
    for (const [i, coil] of [coil1, coil2].entries()) Object.assign(coil.programChainState!, { kind: 'coil', coilParentId: 2, coilSide: i + 1 })
    expect(summarize([row(1, 'S1'), original, repair(3, 2, 2, 'не годен'), repair(4, 2, 3, 'не годен'), coil1, coil2, repair(7, 5, 5, 'годен')]))
      .toMatchObject({ joints: 3, wdi: 30, status: 'годен', rejected: 0 })
  })
  it.each(['ожидает сварку', 'ожидает заявку', 'ожидает НК', 'ожидает ремонт'])('shows %s before rejection but retains the rejection count', status => {
    expect(summarize([row(1, 'S1'), row(2, 'S2', status), row(3, 'S3', 'не годен')]))
      .toMatchObject({ status, rejected: 1, joints: 3 })
  })
  it('orders outstanding stages without treating rejection as completion', () => {
    const rows = [row(1, 'A', 'ожидает НК'), row(2, 'B', 'ожидает заявку'), row(3, 'C', 'ожидает ремонт'), row(4, 'D', 'ожидает сварку')]
    for (const expected of ['ожидает сварку', 'ожидает ремонт', 'ожидает заявку', 'ожидает НК']) {
      expect(summarize(rows).status).toBe(expected); rows.pop()
    }
    expect(summarize([row(1, 'S1'), row(2, 'S2', 'не годен по дублю')])).toMatchObject({ status: 'не годен', rejected: 1 })
  })
  it('never hides an error, even in a replaced original or behind welding waits', () => {
    const bad = row(1, 'S1', 'ошибка'); bad.programChainState!.replacedByCoil = true
    expect(summarize([bad, row(2, 'S1Y1'), row(3, 'S1Y2'), row(4, 'S4', 'ожидает сварку')]))
      .toMatchObject({ status: 'ошибка', errors: 1 })
    expect(summarize([row(1, 'S1', 'ошибка'), repair(2, 1, 1, 'годен')]).status).toBe('ошибка')
  })
  it('uses saved identities rather than names and does not join equal labels on different lines', () => {
    expect(summarize([row(1, 'renamed'), { ...repair(2, 1, 1, 'годен'), joint: 'other' }, row(3, 'renamed', 'годен', { line: 'L2' })])).toMatchObject({ joints: 2, lines: 2, partialChains: 1 })
    expect(summarize([row(1, 'S1'), row(2, 'S1', 'годен', { projectTitle: 'P2' })])).toMatchObject({ joints: 2, lines: 2, projectTitle: '—' })
    expect(summarize([row(1, 'S1', 'годен', { projectTitle: 'P A' }), row(2, 'S1', 'годен', { projectTitle: 'PA' })]).lines).toBe(2)
  })
  it('does not turn partial, missing-source, competing or cyclic repairs green', () => {
    for (const rows of [[repair(2, 1, 1, 'годен')], [row(1, 'S1', 'не годен'), repair(2, 1, 1, 'годен'), repair(3, 1, 1, 'годен')],
      [repair(1, 1, 2, 'не годен'), repair(2, 1, 1, 'не годен')]]) {
      expect(summarize(rows).status).not.toBe('годен')
    }
  })
  it('uses root metadata for a filtered repair without inventing a complete chain', () => {
    const item = repair(3, 1, 2, 'годен')
    item.groupPhysicalRoot = { id: 1, exists: true, replaced: false, wdi: 12.34 }
    expect(summarize([item])).toMatchObject({ joints: 1, wdi: 12.34, status: 'неполная цепочка' })
    item.groupPhysicalRoot.replaced = true
    expect(summarize([item])).toMatchObject({ joints: 0, wdi: null, status: 'заменены катушкой' })
  })
  it('keeps an explicitly linked legacy chain, including configured suffixes', () => {
    const original = row(1, 'S1', 'не годен', { programChainState: undefined })
    const last = row(2, 'S1P1', 'годен', { programChainState: undefined })
    original.chainContinuation = { kind: 'repeated-joint', sourceRowId: 1, sourceJoint: 'S1', targetRowIds: [2], targetJoints: ['S1P1'], projectTitle: 'P', subtitleCode: 'C', line: 'L1' }
    const rows = [original, last]
    expect(createWeldGroupSummarizer(rows, { ...DEFAULT_SYSTEM_INDEX_SETTINGS, repair: 'P' })(rows)).toMatchObject({ joints: 1, wdi: 10, status: 'годен' })
    expect(createWeldGroupSummarizer(rows)([original])).toMatchObject({ status: 'не годен', rejected: 1, partialChains: 1 })
  })
  it('counts an explicitly linked official namesake as one physical connection', () => {
    const old = row(1, 'S1', 'не годен', { officiality: 'неофициальный' })
    const current = row(2, 'S1')
    old.chainContinuation = { kind: 'official-joint', sourceRowId: 1, sourceJoint: 'S1', targetRowIds: [2], targetJoints: ['S1'], projectTitle: 'P', subtitleCode: 'C', line: 'L1' }
    expect(summarize([old, current])).toMatchObject({ joints: 1, wdi: 10, status: 'годен' })
  })
  it('does not accept cyclic official links or a continuation to another physical connection as completion', () => {
    const a = row(1, 'S1'), b = row(2, 'S1')
    a.chainContinuation = { kind: 'official-joint', sourceRowId: 1, sourceJoint: 'S1', targetRowIds: [2], targetJoints: ['S1'], projectTitle: 'P', subtitleCode: 'C', line: 'L1' }
    b.chainContinuation = { ...a.chainContinuation, sourceRowId: 2, targetRowIds: [1] }
    expect(summarize([a, b]).status).toBe('неполная цепочка')
    delete b.chainContinuation
    b.joint = 'S2'
    a.chainContinuation.kind = 'repeated-joint'
    expect(summarize([a, b]).status).toBe('неполная цепочка')
  })
  it('resolves a long namesake history without repeatedly walking every successor', () => {
    const rows = Array.from({ length: 20000 }, (_, i) => row(i + 1, 'S1', i === 19999 ? 'годен' : 'не годен'))
    for (let i = 0; i < rows.length - 1; i++) rows[i].chainContinuation = {
      kind: 'official-joint', sourceRowId: i + 1, sourceJoint: 'S1', targetRowIds: [i + 2], targetJoints: ['S1'], projectTitle: 'P', subtitleCode: 'C', line: 'L1',
    }
    expect(summarize(rows)).toMatchObject({ joints: 1, wdi: 10, status: 'годен', partialChains: 0 })
  })
  it('returns common fields only when every record matches, and dates across history', () => {
    const rows = [row(1, 'A', 'годен', { weldDate: '03.09.2026', wdi: 0.1 }), row(2, 'B', 'годен', { weldDate: '2026-09-05', wdi: '0,2' }), row(3, 'C', 'ожидает сварку', { weldDate: '', wdi: null, subtitleCode: '' })]
    expect(summarize(rows)).toMatchObject({ projectTitle: 'P', subtitleCode: '—', weldDate: '03.09.2026 — 05.09.2026', missingDates: 1, wdi: .3, missingWdi: 1 })
    expect(summarize([row(1, 'A'), row(2, 'B')]).weldDate).toBe('01.09.2026')
    expect(summarize([])).toMatchObject({ joints: 0, wdi: null, status: '—' })
  })
  it('aggregates each supplied subset independently without duplicating rows', () => {
    const a = row(1, 'S1', 'не годен'), b = repair(2, 1, 1, 'годен')
    const sum = createWeldGroupSummarizer([a, b])
    expect(sum([a])).toMatchObject({ joints: 1, status: 'не годен' })
    expect(sum([b])).toMatchObject({ joints: 1, status: 'неполная цепочка' })
    expect(sum([a, b, a])).toMatchObject({ joints: 1, status: 'годен' })
  })
  it('keeps a bounded linear number of row visits for 200000 ordinary joints', () => {
    const rows = Array.from({ length: 200000 }, (_, i) => row(i + 1, `S${i + 1}`, 'годен', { line: `L${i % 1000}` }))
    expect(summarize(rows)).toMatchObject({ joints: 200000, lines: 1000, wdi: 2000000, status: 'годен' })
    for (const item of rows) Object.assign(item, { pstoRequired: 'да', pstoRequest: 'ПСТО', pstoResult: 'проведено', tvmtRequest: 'ТВМТ', tvmtResult: 'годен' })
    expect(summarizePsto(rows)).toMatchObject({ joints: 200000, lines: 1000, wdi: 2000000, status: 'годен',
      pstoResult: { status: 'проведено', counts: { проведено: 200000 } }, tvmtResult: { status: 'годен', counts: { годен: 200000 } } })
  }, 20000)
})

describe('PSTO and TVMT group stage results', () => {
  it('adds stage results only for the heat treatment profile without changing journal totals', () => {
    const rows = [pstoRow(1), pstoRow(2, { tvmtResult: 'не годен' })]
    const ordinary = summarize(rows)
    expect(ordinary).not.toHaveProperty('pstoResult')
    expect(ordinary).not.toHaveProperty('tvmtResult')
    const { pstoResult, tvmtResult, ...shared } = summarizePsto(rows)
    expect(shared).toEqual(ordinary)
    expect(pstoResult).toEqual({ status: 'проведено', rejected: 0, errors: 0, partialChains: 0, counts: { проведено: 2 } })
    expect(tvmtResult).toMatchObject({ status: 'не годен', rejected: 1, counts: { годен: 1, 'не годен': 1 } })
  })
  it('uses physical leaves for repaired and replaced connections, not all historical results', () => {
    const original = pstoRow(1, { finalStatus: 'не годен', tvmtResult: 'не годен' })
    const repaired = { ...pstoRow(2), ...repair(2, 1, 1, 'годен') }
    expect(summarizePsto([original, repaired])).toMatchObject({ joints: 1, wdi: 10, status: 'годен',
      pstoResult: { status: 'проведено', counts: { проведено: 1 } },
      tvmtResult: { status: 'годен', rejected: 0, counts: { годен: 1 } } })
    original.programChainState!.replacedByCoil = true
    const left = pstoRow(3, { joint: 'S1Y1' }), right = pstoRow(4, { joint: 'S1Y2' })
    expect(summarizePsto([original, repaired, left, right])).toMatchObject({ joints: 2, wdi: 20,
      tvmtResult: { status: 'годен', rejected: 0, counts: { годен: 2 } } })
    expect(summarizePsto([original])).toMatchObject({ joints: 0, tvmtResult: { status: 'заменены катушкой', counts: {} } })
  })
  it('keeps early waiting stages ahead of rejection and counts current rejected physical connections separately', () => {
    const rows = [
      pstoRow(1, { tvmtResult: 'не годен' }),
      pstoRow(2, { tvmtResult: '' }),
      pstoRow(3, { tvmtRequest: '', tvmtResult: '' }),
      pstoRow(4, { pstoResult: '', tvmtRequest: '', tvmtResult: '' }),
      pstoRow(5, { pstoRequest: '', pstoResult: '', tvmtRequest: '', tvmtResult: '' }),
      pstoRow(6, { joint: 'S6R1', weldDate: '', pstoRequest: '', pstoResult: '', tvmtRequest: '', tvmtResult: '' }),
      pstoRow(7, { weldDate: '', pstoRequest: '', pstoResult: '', tvmtRequest: '', tvmtResult: '' }),
    ]
    for (const expected of ['ожидает сварку', 'ожидает ремонт', 'ожидает заявку ПСТО', 'ожидает ПСТО', 'ожидает заявку ТВМТ', 'ожидает ТВМТ', 'не годен']) {
      expect(summarizePsto(rows).tvmtResult).toMatchObject({ status: expected, rejected: 1 })
      rows.pop()
    }
  })
  it('retains the existing pre-TO waiting prerequisites in both result columns', () => {
    const waiting = pstoRow(1, { pstoRequest: '', pstoResult: '', tvmtRequest: '', tvmtResult: '',
      preHeatTreatmentLnkEnabled: true, hasVik: 'да' })
    expect(summarizePsto([waiting])).toMatchObject({ pstoResult: { status: 'ожидает заявку НК до ТО' }, tvmtResult: { status: 'ожидает заявку НК до ТО' } })
    waiting.preHeatTreatmentControls = [{ id: 11, weldJointId: 1, method: 'ВИК', requestName: 'ВИК до ТО' }]
    expect(summarizePsto([waiting])).toMatchObject({ pstoResult: { status: 'ожидает НК до ТО' }, tvmtResult: { status: 'ожидает НК до ТО' } })
  })
  it('uses the latest cycle exactly as the report, including an unfinished repeat', () => {
    const item = pstoRow(1, { tvmtResult: 'не годен', pstoRepeatCycles: [{ id: 12, weldJointId: 1, sequence: 2,
      pstoRequest: 'ПСТО повтор', pstoResult: 'проведено', tvmtRequest: 'ТВМТ повтор', tvmtResult: 'годен' }] })
    expect(summarizePsto([item]).tvmtResult).toMatchObject({ status: 'годен', rejected: 0 })
    item.pstoRepeatCycles![0] = { id: 12, weldJointId: 1, sequence: 2, pstoRequest: 'ПСТО повтор' }
    expect(summarizePsto([item])).toMatchObject({ pstoResult: { status: 'ожидает ПСТО' }, tvmtResult: { status: 'ожидает ПСТО', rejected: 0 } })
  })
  it('keeps errors in loaded history and old cycles above waiting or a good successor, scoped to their stage', () => {
    const history = pstoRow(1, { pstoResult: 'ошибка', finalStatus: 'не годен' })
    const repaired = { ...pstoRow(2), ...repair(2, 1, 1, 'годен') }
    expect(summarizePsto([history, repaired])).toMatchObject({ pstoResult: { status: 'ошибка', errors: 1 }, tvmtResult: { status: 'годен', errors: 0 } })
    history.programChainState!.replacedByCoil = true
    expect(summarizePsto([history])).toMatchObject({ pstoResult: { status: 'ошибка', errors: 1 } })
    const cycles = pstoRow(3, { tvmtResult: 'ошибка', pstoRepeatCycles: [{ id: 31, weldJointId: 3, sequence: 2,
      pstoRequest: 'Повтор', pstoResult: 'проведено', tvmtRequest: 'ТВМТ повтор', tvmtResult: 'годен' }] })
    expect(summarizePsto([cycles])).toMatchObject({ pstoResult: { status: 'проведено', errors: 0 }, tvmtResult: { status: 'ошибка', errors: 1 } })
    expect(summarizePsto([pstoRow(4, { finalStatus: 'ошибка' })])).toMatchObject({ status: 'ошибка', pstoResult: { status: 'проведено' }, tvmtResult: { status: 'годен' } })
  })
  it('does not let cancellation erase a current factual TVMT rejection or an unfinished performed cycle', () => {
    const cancelled = pstoRow(1, { pstoRequired: 'отменен', tvmtResult: 'не годен' })
    expect(summarizePsto([cancelled])).toMatchObject({ pstoResult: { status: 'проведено · назначение отменено' }, tvmtResult: { status: 'не годен', rejected: 1 } })
    cancelled.tvmtResult = ''
    expect(summarizePsto([cancelled]).tvmtResult?.status).toBe('ожидает ТВМТ')
    cancelled.tvmtRequest = ''
    expect(summarizePsto([cancelled]).tvmtResult?.status).toBe('ожидает заявку ТВМТ')
    cancelled.pstoRepeatCycles = [{ id: 12, weldJointId: 1, sequence: 2, pstoRequest: 'Сохранённый не начатый повтор' }]
    expect(summarizePsto([cancelled]).tvmtResult?.status).toBe('ожидает заявку ТВМТ')
  })
  it.each(['отменен', null])('does not turn retained requests or waiting labels on an inactive line (%s) into unfinished work', pstoRequired => {
    const item = pstoRow(1, { pstoRequired, pstoResult: 'ожидает', tvmtRequest: '', tvmtResult: 'ожидает ТВМТ' })
    const status = pstoRequired === 'отменен' ? 'отменен' : 'не требуется'
    expect(summarizePsto([item])).toMatchObject({ pstoResult: { status }, tvmtResult: { status } })
  })
  it('does not label a mixed group of completed, cancelled and unnecessary stages as wholly completed', () => {
    const noNeed = pstoRow(3, { pstoResult: 'ожидает', tvmtRequest: '', tvmtResult: '', finalStatus: 'не годен' })
    const cancelled = pstoRow(2, { pstoRequired: 'отменен', pstoRequest: '', pstoResult: '', tvmtRequest: '', tvmtResult: '' })
    expect(summarizePsto([pstoRow(1), cancelled, noNeed])).toMatchObject({
      pstoResult: { status: 'разные результаты', counts: { проведено: 1, отменен: 1, 'нет потребности': 1 } },
      tvmtResult: { status: 'разные результаты', counts: { годен: 1, отменен: 1, 'нет потребности': 1 } },
    })
    noNeed.tvmtResult = 'не годен'
    expect(summarizePsto([noNeed]).tvmtResult).toMatchObject({ status: 'не годен', rejected: 1 })
  })
  it('keeps incomplete or conflicting physical chains visible and never uses filtered-out history to clear them', () => {
    const original = pstoRow(1, { finalStatus: 'не годен' })
    const repaired = { ...pstoRow(2), ...repair(2, 1, 1, 'годен') }
    const sum = createWeldGroupSummarizer([original, repaired], DEFAULT_SYSTEM_INDEX_SETTINGS, { heatTreatment: true })
    expect(sum([repaired])).toMatchObject({ pstoResult: { status: 'неполная цепочка', partialChains: 1 }, tvmtResult: { status: 'неполная цепочка', partialChains: 1 } })
    expect(sum([original, repaired, repaired]).tvmtResult).toMatchObject({ status: 'годен', counts: { годен: 1 } })
    const conflicting = { ...pstoRow(3), ...repair(3, 1, 1, 'годен'), tvmtResult: 'не годен' }
    expect(summarizePsto([original, repaired, conflicting]).tvmtResult).toMatchObject({ status: 'не годен', rejected: 1, partialChains: 1 })
    expect(summarizePsto([])).toMatchObject({ pstoResult: { status: '—', counts: {} }, tvmtResult: { status: '—', counts: {} } })
  })
  it('normalizes factual legacy aliases without reporting a mixed or waiting group', () => {
    expect(summarizePsto([pstoRow(1), pstoRow(2, { pstoResult: ' ДА ', tvmtResult: ' ДА ' })])).toMatchObject({
      pstoResult: { status: 'проведено', counts: { проведено: 2 } }, tvmtResult: { status: 'годен', counts: { годен: 2 } },
    })
    expect(summarizePsto([pstoRow(1, { tvmtResult: 'вырез' })]).tvmtResult).toMatchObject({ status: 'не годен', rejected: 1 })
  })
})
