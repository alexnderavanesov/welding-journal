import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS as settings } from './request-conclusion-settings'
import { buildCurrentSystemDocumentName, buildSystemDocumentSummaries } from './system-document-types'
import { assertDocumentMergeCompatible, assertDocumentOperationIntent, buildDocumentOperationGroups, getDocumentOperationPositions, type DocumentOperationSource } from './system-document-operation'

const date = '2026-10-09'
function request(id: number, rowIds: number[], cycle?: number): DocumentOperationSource {
  const title = buildCurrentSystemDocumentName({ type: 'pstoRequest', title: '', date }, [], settings, id)
  const rows = rowIds.map(id => ({ id, joint: `С${id}`, projectTitle: 'П', subtitleCode: 'Ш', line: id % 2 ? 'Л1' : 'Л2', pstoRequest: title, pstoRequestDate: date })) as WeldRow[]
  return { document: { ...buildSystemDocumentSummaries(rows, 'pstoRequest')[0], documentId: id, ...(cycle ? { sourceKind: 'pstoCycle' as const } : {}) }, rows,
    ...(cycle ? { cyclePositions: rows.map(row => ({ position: { kind: 'pstoCycle' as const, weldJointId: row.id, relationId: row.id * 100 + cycle, sequence: cycle },
      cycle: { id: row.id * 100 + cycle, weldJointId: row.id, sequence: cycle, pstoRequest: title, pstoRequestDate: date } })) } : {}) }
}
function build(sources: DocumentOperationSource[], merge: boolean, mode: 'line' | 'none' | 'joint' = 'line') {
  return buildDocumentOperationGroups({ sources, request: { documentIds: sources.map(s => s.document.documentId), action: 'split', mode, merge }, settings, nextNumbers: { pstoRequest: 20 } })
}

describe('selected document grouping — agreed business rules', () => {
  it('standalone merge combines every selected source into exactly one group', () => {
    const sources = [request(1, [1, 2]), request(2, [3, 4])]
    const groups = buildDocumentOperationGroups({ sources, request: { documentIds: [1, 2], action: 'merge', mode: 'none', merge: true }, settings, nextNumbers: {} })
    expect(groups).toHaveLength(1)
    expect(groups[0].sourceIds).toEqual([1, 2])
    expect(groups[0].positions.map(p => p.row.id)).toEqual([1, 2, 3, 4])
  })
  it('standalone merge cannot be turned into splitting or renaming by forged options', () => {
    const input = { documentIds: [1, 2], action: 'merge' as const, mode: 'none' as const, merge: true }
    expect(() => assertDocumentOperationIntent(input)).not.toThrow()
    for (const invalid of [{ ...input, mode: 'line' as const }, { ...input, merge: false }, { ...input, documentIds: [1] }]) {
      expect(() => assertDocumentOperationIntent(invalid)).toThrow('Объединение создаёт один документ')
    }
  })
  it.each([2, 3])('allows different joints with cycles 2 and %i, preserving each exact position', cycle => {
    const sources = [request(10, [1], 2), request(11, [2], cycle)]
    const before = structuredClone(sources)
    expect(() => assertDocumentMergeCompatible(sources)).not.toThrow()
    const groups = build(sources, true, 'none')
    expect(groups).toHaveLength(1)
    expect(groups[0].positions.map(p => [p.row.id, p.cycle, p.relationId])).toEqual([[1, 2, 102], [2, cycle, 200 + cycle]])
    expect(sources).toEqual(before)
  })
  it('rejects two cycles of the SAME joint even with the same date and custom names', () => {
    const sources = [request(10, [1], 2), request(11, [1], 3)]
    expect(() => build(sources, true, 'none')).toThrow('разные циклы одного стыка')
    expect(build(sources, false, 'none')).toHaveLength(2)
  })
  it('rejects duplicate physical primary positions even when one source uses legacy metadata', () => {
    const primary = request(10, [1]), sourced = structuredClone(primary)
    sourced.document = { ...sourced.document, documentId: 11, sourceKind: 'pstoCycle' }
    sourced.cyclePositions = [{ position: { kind: 'pstoCycle', weldJointId: 1, relationId: 1, sequence: 1 } }]
    expect(getDocumentOperationPositions(primary)[0].key).toBe(getDocumentOperationPositions(sourced)[0].key)
    expect(() => build([primary, sourced], true, 'none')).toThrow()
  })
  it('two sources with two lines produce four documents without merge and two with it', () => {
    const sources = [request(1, [1, 2]), request(2, [3, 4])]
    expect(build(sources, false)).toHaveLength(4)
    expect(build(sources, true)).toHaveLength(2)
    expect(build(sources, true, 'none')).toHaveLength(1)
  })
  it('preserves the first stable system number regardless of selection/row sorting', () => {
    const source = request(5, [2, 1])
    const groups = build([source], false, 'joint')
    expect(groups.map(g => [g.rows[0].id, g.systemNumber, g.reserveNumber])).toEqual([[1, 5, false], [2, 20, true]])
  })
  it('splits a historical RK system name while skipping numbers occupied outside the selection', () => {
    const title = 'Заключение-РК-24.08.2026-005', date = '2026-08-24'
    const rows = [2, 1].map(id => ({ id, joint: `С${id}`, rkConclusion: title, rkConclusionDate: date })) as WeldRow[]
    const source = { document: { ...buildSystemDocumentSummaries(rows, 'lnkConclusion')[0], documentId: 15 }, rows }
    const occupied = new Map([['lnkConclusionRk' as const, new Set([6, 7])]])
    const groups = buildDocumentOperationGroups({ sources: [source],
      request: { documentIds: [15], action: 'split', mode: 'joint', merge: false }, settings,
      nextNumbers: { lnkConclusionRk: 5 }, occupiedNumbers: occupied })
    expect(groups.map(group => [group.rows[0].id, group.name, group.reserveNumber])).toEqual([
      [1, 'ЗНК-РК-24.08.2026-005', false], [2, 'ЗНК-РК-24.08.2026-008', true],
    ])
    expect([...occupied.get('lnkConclusionRk')!]).toEqual([6, 7])
  })
  it('refuses multiplied large preview labels without returning truncated groups or mutating sources', () => {
    const source = request(1, Array.from({ length: 10 }, (_, i) => i + 1))
    source.rows.forEach(row => { row.joint = `${row.id}-${'X'.repeat(500_000)}` })
    const before = structuredClone(source)
    expect(() => build([source], false, 'joint')).toThrow('безопасный объём предпросмотра')
    expect(source).toEqual(before)
  })
  it('marks incomplete line identities instead of silently dropping their positions', () => {
    const source = request(1, [1, 2]); source.rows[1].line = ''
    const groups = build([source], false)
    expect(groups).toHaveLength(2)
    expect(groups.flatMap(group => group.positions.map(p => p.row.id))).toEqual([1, 2])
    expect(groups.find(group => group.rows[0].id === 2)?.error).toBe('Не заполнены поля выбранного разделения.')
  })
  it('rejects duplicate custom group names case-insensitively instead of merging their contents', () => {
    const sources = [request(1, [1, 2])], initial = build(sources, false, 'joint')
    const groups = buildDocumentOperationGroups({ sources, settings, nextNumbers: {}, request: {
      documentIds: [1], action: 'split', mode: 'joint', merge: false,
      names: Object.fromEntries(initial.map((group, index) => [group.key, { mode: 'custom', name: index ? '  ОБЩЕЕ  ' : 'Общее', membership: '' }])),
    } })
    expect(groups).toHaveLength(2)
    expect(groups.map(group => group.error)).toEqual(Array(2).fill('Название повторяется. Одинаковое имя не объединяет документы.'))
    expect(groups.map(group => group.positions.map(p => p.row.id))).toEqual([[1], [2]])
  })
  it('does not reuse a custom name for newly split membership', () => {
    const source = request(5, [1, 2]); source.document.title = 'Ручное'; source.rows.forEach(row => { row.pstoRequest = 'Ручное' })
    expect(build([source], false, 'none')[0].name).toBe('Ручное')
    expect(build([source], false, 'joint').map(g => [g.namingMode, g.name, g.error])).toEqual([
      ['custom', '', 'Название не указано'], ['custom', '', 'Название не указано'],
    ])
  })
  it('rejects different dates before generating any merged groups', () => {
    const sources = [request(1, [1]), request(2, [2])]
    sources[1].document.date = '2026-10-10'; sources[1].rows[0].pstoRequestDate = '2026-10-10'
    expect(() => build(sources, true)).toThrow('разные даты')
  })
  it('does not expand the methods of a mixed-method LNK request', () => {
    const rows = [{ id: 1, joint: 'A', vikRequest: 'НК', vikRequestDate: date }, { id: 2, joint: 'Б', rkRequest: 'НК', rkRequestDate: date }] as WeldRow[]
    const source = { document: { ...buildSystemDocumentSummaries(rows, 'lnkRequest')[0], documentId: 1 }, rows }
    expect(getDocumentOperationPositions(source).map(p => [p.row.id, p.method])).toEqual([[1, 'ВИК'], [2, 'РК']])
  })
  it('rejects VIK + RK conclusions even if names and dates match', () => {
    const rows = [{ id: 1, vikConclusion: 'Общее', vikConclusionDate: date }, { id: 2, rkConclusion: 'Общее', rkConclusionDate: date }] as WeldRow[]
    const sources = buildSystemDocumentSummaries(rows, 'lnkConclusion').map((document, index) => ({ document: { ...document, documentId: index + 1 }, rows: rows.filter(row => document.rowIds.includes(row.id)) }))
    expect(sources).toHaveLength(2)
    expect(() => build(sources, true, 'none')).toThrow('методы заключения')
  })
  it('includes pre-TO documents explicitly and never merges them with the primary stage', () => {
    const rows = [1, 2].map(id => ({ id, joint: `С${id}`, vikConclusion: 'НК', vikConclusionDate: date })) as WeldRow[]
    const primary = { document: { ...buildSystemDocumentSummaries(rows, 'lnkConclusion')[0], documentId: 1 }, rows }
    const before: DocumentOperationSource = { document: { ...primary.document, documentId: 2, sourceKind: 'beforeHeatTreatment' }, rows,
      controls: rows.map(row => ({ position: { kind: 'beforeHeatTreatment', weldJointId: row.id, relationId: row.id + 10, methodCode: 'ВИК' },
        control: { id: row.id + 10, weldJointId: row.id, method: 'ВИК', conclusionName: 'НК', conclusionDate: date } })),
    }
    const groups = build([before], false, 'joint')
    expect(groups.map(group => group.positions.map(p => [p.row.id, p.relationId, p.stage]))).toEqual([[[1, 11, 'До ТО']], [[2, 12, 'До ТО']]])
    expect(() => build([primary, before], true, 'none')).toThrow('разные этапы')
  })
})
