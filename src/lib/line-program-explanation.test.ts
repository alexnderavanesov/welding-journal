import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { explainLineProgram } from './line-program-explanation'
import { calculateLineProgram } from './line-program-calculation'
import { buildLineProgramDisplay } from './line-program-display'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import { getProgramRemovalHints } from './line-program-excess'
import { createProgramRowSelector } from './line-program-selection'
import { programApprovalKey } from './program-control-approval'
import { buildLineConsistencyTasks } from './line-consistency-tasks'
import { captureProgramChainStates } from './line-program-chain-state'

const row = (id: number, extra: Partial<WeldRow> = {}): WeldRow => ({ id, joint: `F${id}`, projectTitle: 'P', subtitleCode: 'S', line: 'L', connectionType: 'С17', weldDate: '2026-09-01', stamp1K: 'A', hasVik: 'да', weldControlPercent: 10, pvkControlPercent: 10, ...extra })
const explain = (rows: WeldRow[], extra: Partial<Parameters<typeof explainLineProgram>[3]> = {}, percent = 10, pvk = 10) => explainLineProgram(rows, percent, pvk, { kind: 'common', list: 'physical', page: 0, ...extra })

describe('shared calculation explanations and zero-weight repair assignments', () => {
  it.each(['repair', 'coil'] as const)('keeps custom %s indexes in the stamp projection of a full line', kind => {
    const settings = { ...DEFAULT_SYSTEM_INDEX_SETTINGS, repair: 'P', cutout: 'C', coil: 'K' }
    const rows = kind === 'repair'
      ? [row(1, { joint: 'F1', rkResult: 'ремонт', hasRk: 'да' }), row(2, { joint: 'F1P1', hasRk: 'да' })]
      : [row(1, { joint: 'F1', rkResult: 'вырез', hasRk: 'да' }), row(2, { joint: 'F1K1' }), row(3, { joint: 'F1K2' })]
    // Old stored rows have no captured ID topology yet. A repair adds no physical
    // connection; the two coil sides replace one. Names follow saved settings.
    const count = kind === 'repair' ? 1 : 2
    const result = explain(rows, { settings, stamp: 'A' }, 100, 100)
    expect(result.total).toBe(count)
    expect(result.math).toEqual([`${count} × 100% = ${count}.`])
    expect(result.summary).toContain(`База ${count} + добор 0 = расчётная норма ${count}.`)
  })
  it('explains full-line shared credit without multiplying it by stamps', () => {
    const result = explain([row(1, { stamp1Z: 'B', hasRk: 'да' })], { list: 'covered' }, 100, 100)
    expect(result.rows[0].reason).toContain('одно место в норме всей линии независимо от числа клейм')
    expect(result.summary).toContain('Зачтено 1;')
  })
  it('names layered replacement instead of implying an RK/UZK assignment or factual result', () => {
    const rows = [row(1, { connectionType: 'У19', layeredControlAssigned: true, hasPvk: 'да', pvkResult: 'годен' })]
    expect(explain(rows, { list: 'assigned' }).rows[0].reason).toContain('послойная замена РК/УЗК')
    expect(explain(rows, { list: 'results' }).rows[0].reason).toContain('не отдельный результат РК/УЗК')
    expect(explain(rows, { list: 'covered' }).rows[0].reason).toContain('Послойная замена РК/УЗК')
  })
  it('explains assignments including plans without confusing them with credit or results', () => {
    const rows = [row(1, { hasRk: 'да', hasUzk: 'дополнительный' }), row(2, { hasRk: 'да', weldDate: null }), row(3, { hasRk: 'да', rkResult: 'ремонт' })]
    const assigned = explain(rows, { list: 'assigned' })
    expect(assigned.rows.map(row => row.id)).toEqual([1, 2, 3])
    expect(assigned.rows[0].reason).toContain('и дополнительный')
    expect(assigned.rows[1].reason).toContain('сварке')
    expect(explain(rows, { list: 'results' }).rows.map(row => row.id)).toEqual([3])
    expect(explain(rows, { list: 'results' }).rows[0].reason).toContain('негодный результат')
    expect(explain(rows, { list: 'additional' }).rows.map(row => row.id)).toEqual([1])
  })
  it('explains excess and a jointly safe subset, including method counts and history protection', () => {
    const rows = [row(1, { hasRk: 'да', rkResult: 'годен' }), row(2, { hasRk: 'да' }), row(3, { hasRk: 'да', rkResult: 'годен' })]
    const excess = explain(rows, { list: 'excess' })
    expect(excess.rows.map(row => row.id)).toEqual([2, 3])
    expect(excess.rows[0].reason).toContain('Можно снять')
    expect(excess.rows[1].reason).toContain('защищена история')
    expect(excess.explanation).toContain('Считаются назначения методов')
    expect(explain(rows, { list: 'reduction' }).rows.map(row => row.id)).toEqual([2])
    const paired = [row(1, { hasRk: 'да', hasUzk: 'да' })]
    expect(explain(paired, { list: 'duplicates' }).rows[0].reason).toContain('взаимозаменяемый метод')
    const approved = new Set([programApprovalKey(paired[0], 'common', true)])
    expect(explain(paired, { list: 'excess', approved }).total).toBe(0)
    expect(explain(paired, { list: 'approved', approved }).rows[0].reason).toContain('явное согласование')
  })
  it('shows candidates only for groups with actual debt, never an unreachable theoretical quota', () => {
    const rows = [row(1, { hasRk: 'да', stamp1K: 'A' }), row(2, { stamp1K: 'B' })]
    expect(explain(rows, { list: 'missing', stamp: 'A' }).total).toBe(0)
    expect(explain(rows, { list: 'missing' }).rows.map(row => row.id)).toEqual([2])
    expect(explain([rows[0]], { list: 'missing' }).explanation).toContain('не является долгом')
  })
  it('uses the same full-control stamp projection as the table, not the whole line quota', () => {
    const rows = [row(1, { stamp1K: 'A', hasRk: 'да' }), row(2, { stamp1K: 'B' }), row(3, { stamp1K: 'A', weldDate: null })]
    const a = explain(rows, { stamp: 'A' }, 100, 100)
    expect(a.total).toBe(2)
    expect(a.math).toEqual(['2 × 100% = 2.'])
    expect(a.summary).toContain('норма 2. Зачтено 1;')
    expect(a.summary).toContain('К назначению: 1.')
  })
  it('explains real percent rounding and paginates without returning all rows', () => {
    const rows = Array.from({ length: 101 }, (_, i) => row(i + 1))
    const result = explain(rows, { page: 1 })
    expect(result).toMatchObject({ total: 101, page: 1, pageSize: 50 })
    expect(result.rows).toHaveLength(50)
    expect(result.rows[0].id).toBe(51)
    expect(result.math[0]).toContain('101 × 10% → база 10')
  })
  it('distinguishes performed PVK from credited PVK after RK rejection', () => {
    const rows = [row(1, { pvkResult: 'годен', rkResult: 'ремонт', hasPvk: 'да', hasRk: 'да' })]
    expect(explain(rows, { kind: 'pvk', list: 'excluded' }).rows[0].reason).toContain('даже при собственном годном ПВК')
    expect(explain(rows, { kind: 'pvk', list: 'covered' }).total).toBe(0)
    expect(explain(rows, { list: 'covered' }).rows[0].reason).toContain('сохраняет зачёт при браке')
  })
  it.each([10, 100])('keeps an optional repair-only assignment visible at zero quantity, %i%%', percent => {
    const rows = [row(1, { vikResult: 'ремонт' }), row(2, { joint: 'F1R1', stamp1K: 'B', hasRk: 'да' })]
    const groups = calculateLineProgram(rows, percent, 10)
    const hints = getProgramRemovalHints(1, rows, groups, new Set())
    const display = buildLineProgramDisplay(rows, groups, percent, 10, hints)
    expect(groups.find(group => group.stamp === 'B')).toMatchObject({ rowIds: [], common: { required: 0, coveredRowIds: [], excessRowIds: [2] } })
    expect(display.stampRows.find(group => group.stamp === 'B')).toMatchObject({ count: 0, reducible: 1, common: { required: 0, missing: 0, excess: 1 } })
    expect(explain(rows, { stamp: 'B', list: 'reduction' }, percent).rows.map(row => row.id)).toEqual([2])
  })
  it('protects shared coverage required by the third stamp', () => {
    const rows = [row(1, { hasRk: 'да', stamp1Z: 'B', stamp2K: 'C' }), row(2, { hasUzk: 'да' })]
    const result = explain(rows, { stamp: 'A', list: 'protected' })
    expect(result.rows.find(row => row.id === 1)?.reason).toContain('B, C')
    expect(explain(rows, { list: 'reduction' }).rows.map(row => row.id)).toEqual([2])
  })
  it('shows an approved pair even when no excess survives and protects inherited mandatory methods', () => {
    const rows = [row(1, { hasRk: 'да', hasUzk: 'да', vikResult: 'ремонт' }), row(2, { joint: 'F1R1', hasRk: 'да', hasUzk: 'да' })]
    const approved = new Set([programApprovalKey(rows[0], 'common', true)])
    const groups = calculateLineProgram(rows, 10, 10, undefined, approved)
    expect(createProgramRowSelector(rows, groups, 1, approved)({ slice: 'approved' }).map(row => row.id)).toEqual([1])
    expect(buildLineConsistencyTasks(rows, approved).filter(task => task.fieldKey === 'controlPresence')).toEqual([])
    expect(explain(rows, { list: 'obligations', approved }).rows[0].reason).toContain('согласованию РК + УЗК')
  })
  it('reports missing intermediate history and never binds another line with a similar name', () => {
    const original = [row(1), row(2, { joint: 'F1R1' }), row(3, { joint: 'F1R2' })]
    const states = captureProgramChainStates(original)
    const remaining = [original[0], original[2]].map(row => ({ ...row, programChainState: states.get(row.id) }))
    expect(explain(remaining).issues.some(issue => issue.message.includes('предшественник'))).toBe(true)
    const foreign = row(4, { line: 'L X', joint: 'F1' })
    const orphan = row(5, { line: 'LX', joint: 'F1R1' })
    expect(captureProgramChainStates([foreign, orphan]).get(5)?.physicalRootId).toBeNull()
  })
})
