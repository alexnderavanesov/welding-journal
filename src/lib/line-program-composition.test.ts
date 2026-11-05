import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { calculateLineProgram } from './line-program-calculation'
import { createProgramRowSelector } from './line-program-selection'
import { explainLineProgram } from './line-program-explanation'
import { buildLineProgramDisplay } from './line-program-display'
import { summarizeLineProgram } from './line-program-overview'

const row = (id: number, extra: Partial<WeldRow> = {}): WeldRow => ({ id, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: `F${id}`, connectionType: 'С17', weldDate: '2026-11-01', stamp1K: 'A', hasVik: 'да', ...extra })
describe('exact calculation composition', () => {
  it('opens all 121 physical rows from a fifty-row explanation and preserves stamp/method scope', () => {
    const rows = Array.from({ length: 122 }, (_, i) => row(i + 1, { stamp1K: i === 121 ? 'B' : 'A' }))
    const groups = calculateLineProgram(rows, 10, 10)
    const select = createProgramRowSelector(rows, groups, 1, new Set())
    const explanation = explainLineProgram(rows, 10, 10, { stamp: 'A', kind: 'pvk', list: 'physical', page: 1 })
    expect(explanation).toMatchObject({ total: 121, page: 1 })
    expect(explanation.rows).toHaveLength(50)
    expect(select({ stamp: 'A', kind: 'pvk', slice: 'all', explanationList: 'physical' }).map(row => row.id)).toEqual(Array.from({ length: 121 }, (_, i) => i + 1))
    expect(select({ stamp: 'missing', kind: 'pvk', slice: 'all', explanationList: 'physical' })).toEqual([])
  })
  it('never widens sources, exclusions, repair obligations or a missing composition into all rows', () => {
    const rows = [row(1, { hasRk: 'да', rkResult: 'ремонт' }), row(2, { joint: 'F1R1', hasRk: 'да' }), row(3), row(4, { hasPvk: 'да', pvkResult: 'ремонт' })]
    const select = createProgramRowSelector(rows, calculateLineProgram(rows, 30, 10), 1, new Set())
    const composition = (list: 'sources' | 'excluded' | 'obligations', kind: 'common' | 'pvk' = 'common') => select({ stamp: 'A', kind, slice: 'all', explanationList: list }).map(row => row.id)
    expect(composition('sources')).toEqual([1])
    expect(composition('sources', 'pvk')).toEqual([])
    expect(composition('excluded')).toEqual([2, 4])
    expect(composition('obligations')).toEqual([2])
  })
  it('keeps overquota distinct from a duplicate method when both route through excess', () => {
    const rows = [row(1, { hasRk: 'да', hasUzk: 'да' })]
    const select = createProgramRowSelector(rows, calculateLineProgram(rows, 10, 10), 1, new Set())
    expect(select({ kind: 'common', slice: 'excess', explanationList: 'overquota' })).toEqual([])
    expect(select({ kind: 'common', slice: 'duplicates', explanationList: 'duplicates' }).map(row => row.id)).toEqual([1])
  })
  it('uses support root identities for assigned/result composition while retaining repair-only history', () => {
    const rows = [row(1, { joint: 'ОП1', connectionType: 'Т', vikResult: 'ремонт' }), row(2, { joint: 'ОП1R1', connectionType: 'Т', hasUzk: 'да', uzkResult: 'годен' }), row(3, { joint: 'ОП2', connectionType: 'Т', weldDate: null, hasPvk: 'дополнительный' }), row(4, { joint: 'ОП3', connectionType: 'Т', stamp1K: null })]
    const calculations = calculateLineProgram(rows, 100, 100, undefined, undefined, true)
    const select = createProgramRowSelector(rows, calculations, 1, new Set(), undefined, { percent: 100, pvkPercent: 100, support: true })
    expect(select({ kind: 'common', slice: 'assigned', explanationList: 'assigned' }).map(row => row.id)).toEqual([1])
    expect(select({ kind: 'common', slice: 'results', explanationList: 'results' }).map(row => row.id)).toEqual([1])
    expect(select({ kind: 'common', slice: 'all', explanationList: 'sources' })).toEqual([])
    const display = buildLineProgramDisplay(rows, calculations, 100, 100, undefined, true)
    expect(display.summary).toMatchObject({ count: 3, journalRows: 4, common: { assigned: 1, completed: 1, required: 1 }, pvk: { assigned: 1, required: 1 } })
    const overview = summarizeLineProgram(rows, { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', family: 'supports', category: null, groupName: null, weldControlPercent: 100, pvkControlPercent: 100, configurationIssue: null, version: '1' })
    expect(overview).toMatchObject({ joints: 3, journalRows: 4, calculationJoints: 1, additional: 1, common: { required: 1 } })
    expect(explainLineProgram(rows, 100, 100, { kind: 'common', list: 'sources', page: 0, support: true }).explanation).toBe('Для опор добор по браку не применяется.')
  })
})
