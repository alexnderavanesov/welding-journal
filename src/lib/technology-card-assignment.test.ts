import { describe, expect, it } from 'vitest'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { createTechnologyCardAssignmentClassifier, emptyTechnologyCardAssignmentCounts, matchesTechnologyCardAssignmentFilter, technologyCardAssignmentFilterCount, type TechnologyCardAssignmentFilter, type TechnologyCardAssignmentProposal, type TechnologyCardAssignmentRow } from '@/lib/technology-card-assignment'
import type { TechnologyCardRecord } from '@/lib/technology-card-types'

const card: TechnologyCardRecord = { id: 1, name: 'Техкарта №12', revision: 2, archived: false, weldingMethods: ['РАД'], connectionType: 'С17', materialGroups: ['М01'], diameterFrom: 57, diameterTo: 159, thicknessFrom: 3, thicknessTo: 6, psto: 'any' }
const row: TechnologyCardAssignmentRow = { id: 7, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1', version: 'v1', weldDate: '2026-10-08', weldingMethod: 'РАД', connectionType: 'С17', materialGroup: 'М01', d1: 57, d2: 159, t1: 6, t2: 3, pstoRequired: 'да' }
const classify = (cards = [card]) => createTechnologyCardAssignmentClassifier({ cards, names: [{ name: 'ТК №1', cardId: 1 }, ...cards.map(card => ({ name: card.name, cardId: card.id }))] }, DEFAULT_DATA_LIST_SETTINGS)

describe('explicit journal-wide TK assignment', () => {
  it('assigns an empty already-welded joint without modifying inputs', () => {
    expect(classify()(row)).toMatchObject({ kind: 'assign', newName: card.name, mismatch: false })
    expect(row.technologyCardNumber).toBeUndefined()
  })
  it('replaces an unknown manual choice only as a separate proposal', () => {
    expect(classify()({ ...row, technologyCardNumber: 'Ручная ТК' })).toMatchObject({ kind: 'reassign', mismatch: true, oldName: 'Ручная ТК', newName: card.name })
  })
  it('renames the same applicable card even with additional alternatives', () => {
    expect(classify([card, { ...card, id: 2, name: 'Другая' }])({ ...row, technologyCardNumber: 'ТК №1' })).toMatchObject({ kind: 'rename', mismatch: false, newName: card.name })
    expect(classify()({ ...row, technologyCardNumber: card.name })).toMatchObject({ kind: 'unchanged', mismatch: false })
  })
  it('checks parameters before renaming, offering replacement when both changed', () => {
    const run = classify([{ ...card, diameterFrom: 89 }, { ...card, id: 2, name: 'Подходящая' }])
    expect(run({ ...row, technologyCardNumber: 'ТК №1' })).toMatchObject({ kind: 'reassign', newName: 'Подходящая', mismatch: true })
  })
  it('does not guess between candidates or erase an inapplicable choice', () => {
    expect(classify([card, { ...card, id: 2 }])(row).kind).toBe('ambiguous')
    expect(classify([{ ...card, diameterFrom: 89 }])({ ...row, technologyCardNumber: 'ТК №1' })).toMatchObject({ kind: 'none', newName: '', mismatch: true })
    expect(classify([])(row).kind).toBe('none')
  })
  it('keeps or renames an applicable archived assignment, never assigning it to a blank joint', () => {
    const run = classify([{ ...card, archived: true }])
    expect(run(row).kind).toBe('none')
    expect(run({ ...row, technologyCardNumber: 'ТК №1' }).kind).toBe('rename')
    expect(run({ ...row, technologyCardNumber: card.name }).kind).toBe('unchanged')
  })
  it.each([
    { patch: { weldDate: '' }, undated: true, tee: false },
    { patch: { weldDate: undefined }, undated: true, tee: false },
    { patch: { connectionType: 'Т1' }, undated: false, tee: true },
    { patch: { weldDate: '', connectionType: 'Т1' }, undated: true, tee: true },
  ])('explains each actual exclusion without changing eligibility: $patch', ({ patch, undated, tee }) => {
    const result = classify()({ ...row, ...patch })
    expect(result).toMatchObject({ kind: 'excluded', newName: '', mismatch: false })
    expect(result.reason.includes('Нет даты сварки')).toBe(undated)
    expect(result.reason.includes('Подбор ТК для Т-соединений пока не поддерживается.')).toBe(tee)
  })
  it.each([{ d1: null }, { t2: 0 }, { weldingMethod: '' }, { materialGroup: '' }, { weldDate: 'wrong' }])('reports incomplete/invalid profiles without replacement: %j', patch => {
    expect(classify()({ ...row, ...patch, technologyCardNumber: 'ТК №1' }).kind).toBe('incomplete')
  })
  it('uses independent minimum dimensions, exact material/method sets and assigned PSTO', () => {
    const multi = { ...card, materialGroups: ['М01', 'М05'], weldingMethods: ['РАД', 'РД'], psto: 'required' as const }
    const run = classify([multi])
    const weld = { ...row, weldingMethod: 'РД + РАД', materialGroup: 'М05 + М01' }
    expect(run(weld).kind).toBe('assign')
    expect(run({ ...weld, pstoRequired: 'нет' }).kind).toBe('none')
    expect(run({ ...weld, materialGroup: 'М01' }).kind).toBe('none')
    expect(run({ ...weld, weldingMethod: 'РАД' }).kind).toBe('none')
  })
})

it('groups all proposals into disjoint filters with matching counts, without counting mismatches twice', () => {
  const counts = { ...emptyTechnologyCardAssignmentCounts(), assign: 1, reassign: 1, rename: 1,
    ambiguous: 1, none: 1, incomplete: 1, unchanged: 1, excluded: 1, mismatch: 3 }
  const proposals = ['assign', 'reassign', 'rename', 'ambiguous', 'none', 'incomplete', 'unchanged', 'excluded']
    .map((kind, i) => ({ id: i, kind, mismatch: ['reassign', 'ambiguous', 'none'].includes(kind) }) as TechnologyCardAssignmentProposal)
  const expected = { all: 8, changes: 3, attention: 3, unchanged: 1, excluded: 1 }
  for (const filter of Object.keys(expected) as TechnologyCardAssignmentFilter[]) {
    expect(technologyCardAssignmentFilterCount(counts, filter)).toBe(expected[filter])
    expect(proposals.filter(row => matchesTechnologyCardAssignmentFilter(row, filter))).toHaveLength(expected[filter])
  }
  for (const proposal of proposals) {
    expect((['changes', 'attention', 'unchanged', 'excluded'] as const)
      .filter(filter => matchesTechnologyCardAssignmentFilter(proposal, filter))).toHaveLength(1)
  }
})
