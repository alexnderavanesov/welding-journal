import { expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildSystemDocumentReferencesWhere, collectSystemDocumentChangeReferences } from './system-document-index'
import { PgDialect } from 'drizzle-orm/pg-core'

it.each(['pstoRequest', 'pstoConclusion', 'lnkRequest', 'lnkConclusion'] as const)(
  'does not reread an unchanged 100k-position historical %s when another primary document is renamed', type => {
    const historical: WeldRow = { id: 1, projectTitle: 'Общий проект', line: 'Л1',
      pstoRequest: 'Историческая заявка', pstoRequestDate: '2026-09-01',
      heatTreatmentDiagram: 'Историческая диаграмма', pstoDate: '2026-09-02',
      tvmtRequest: 'Историческая ТВМТ', tvmtRequestDate: '2026-09-02',
      tvmtConclusion: 'Историческое заключение', tvmtConclusionDate: '2026-09-03' }
    const primary = { ...historical, id: 2 }
    const next = { ...primary, pstoRequest: 'Новая заявка', heatTreatmentDiagram: 'Новая диаграмма',
      tvmtRequest: 'Новая ТВМТ', tvmtConclusion: 'Новое заключение' }
    // Row 1 belongs to a renamed repeat cycle, but its primary facts do not
    // change. Its historical document must not enter the primary-index query.
    const oldPrimary = { ...primary, pstoRequest: 'Заявка пакета', heatTreatmentDiagram: 'Диаграмма пакета',
      tvmtRequest: 'ТВМТ пакета', tvmtConclusion: 'Заключение пакета' }
    const references = collectSystemDocumentChangeReferences([historical, next], new Map([[1, historical], [2, oldPrimary]]), type,
      { documentNamesOnly: true })
    expect(references.previousReferences).toHaveLength(1)
    expect(references.affectedReferences).toHaveLength(2)
    const query = new PgDialect().sqlToQuery(buildSystemDocumentReferencesWhere(references.affectedReferences))
    expect(JSON.stringify(query.params)).not.toContain('Историческ')
    expect(JSON.stringify(query.params)).toContain('пакета')
  },
)

it('retains both sides of date changes, added/deleted rows and changed summary metadata', () => {
  const row: WeldRow = { id: 1, pstoRequest: 'Общая', pstoRequestDate: '2026-09-01', projectTitle: 'А' }
  const deleted = { ...row, id: 2, pstoRequest: 'Удалена' }
  const moved = { ...row, id: 3, pstoRequest: 'Перенос' }
  const references = collectSystemDocumentChangeReferences([
    { ...row, pstoRequestDate: '2026-09-02' }, { ...row, id: 4, pstoRequest: 'Добавлена' },
    { ...moved, projectTitle: 'Б' },
  ], new Map([[1, row], [2, deleted], [3, moved]]), 'pstoRequest', { documentNamesOnly: true })
  expect(references.previousReferences).toHaveLength(3)
  expect(references.affectedReferences.map(item => [item.title, item.date]).sort()).toEqual([
    ['Общая', '2026-09-01'], ['Общая', '2026-09-02'], ['Удалена', '2026-09-01'],
    ['Добавлена', '2026-09-01'], ['Перенос', '2026-09-01'],
  ].sort())
})

it('still reads a shared old document completely when only one member leaves it', () => {
  const first: WeldRow = { id: 1, pstoRequest: 'Общая', pstoRequestDate: '2026-09-01' }
  const second = { ...first, id: 2 }
  const references = collectSystemDocumentChangeReferences([first, { ...second, pstoRequest: 'Отдельная' }],
    new Map([[1, first], [2, second]]), 'pstoRequest', { documentNamesOnly: true })
  expect(references.affectedReferences.map(item => item.title).sort()).toEqual(['Общая', 'Отдельная'])
  const query = new PgDialect().sqlToQuery(buildSystemDocumentReferencesWhere(references.affectedReferences))
  // Scope by both complete document identities, never by just the changed ID.
  expect(query.sql).not.toContain('"weld_joints"."id"')
  expect(JSON.stringify(query.params)).toContain('Общая')
})

it('does not synchronize an unchanged type or an empty source; ordinary mutations retain their existing scope', () => {
  const row: WeldRow = { id: 1, pstoRequest: 'ПСТО', pstoRequestDate: '2026-09-01' }
  const before = new Map([[row.id, row]])
  expect(collectSystemDocumentChangeReferences([{ ...row, pstoUpdatedAt: '2026-10-09T00:00:00Z' }], before,
    'pstoRequest', { documentNamesOnly: true }).affectedReferences).toEqual([])
  expect(collectSystemDocumentChangeReferences([{ ...row, pstoRequest: 'Новая' }], before,
    'lnkRequest', { documentNamesOnly: true }).affectedReferences).toEqual([])
  expect(collectSystemDocumentChangeReferences([], new Map(), 'pstoRequest', { documentNamesOnly: true }).affectedReferences).toEqual([])
  const unchanged = { ...row, id: 2, pstoRequest: 'Не менялась' }
  const ordinary = collectSystemDocumentChangeReferences([{ ...row, pstoRequest: 'Новая' }, unchanged],
    new Map([[1, row], [2, unchanged]]), 'pstoRequest')
  expect(ordinary.affectedReferences.map(item => item.title).sort()).toEqual(['ПСТО', 'Не менялась', 'Новая'].sort())
})

it('keeps the version of an unrelated document on the same joint when control assignments change', () => {
  const previous = {
    id: 1, updatedAt: '2026-10-01T10:00:00Z',
    pstoRequest: 'ПСТО 1', pstoRequestDate: '2026-10-01',
    vikRequest: 'ВИК 2', vikRequestDate: '2026-10-01',
  }
  const current = { ...previous, updatedAt: '2026-10-01T12:00:00Z', vikRequest: null, vikRequestDate: null }
  const before = new Map([[previous.id, previous]])
  const options = { controlAssignmentsOnly: true }
  expect(collectSystemDocumentChangeReferences([current], before, 'pstoRequest', options).affectedReferences).toEqual([])
  expect(collectSystemDocumentChangeReferences([current], before, 'lnkRequest', options).affectedReferences.map(ref => ref.title)).toEqual(['ВИК 2'])
  expect(collectSystemDocumentChangeReferences([current], before, 'pstoRequest').affectedReferences.map(ref => ref.title)).toEqual(['ПСТО 1'])
})

it('rechecks an issued conclusion when an unknown legacy type becomes T at the same version time', () => {
  const row: WeldRow & { updatedAt: string } = { id: 1, connectionType: null, updatedAt: '2026-11-26T12:00:00Z',
    vikConclusion: 'ВИК-1', vikConclusionDate: '2026-11-26', vikRequest: 'Заявка', vikRequestDate: '2026-11-25' }
  const before = new Map([[row.id, row]])
  const support = { ...row, connectionType: 'Т1', joint: 'ОП1' }
  expect(collectSystemDocumentChangeReferences([support], before, 'lnkConclusion').affectedReferences.map(ref => ref.title)).toEqual(['ВИК-1'])
  expect(collectSystemDocumentChangeReferences([support], before, 'lnkRequest').affectedReferences).toEqual([])
  expect(collectSystemDocumentChangeReferences([{ ...row, connectionType: 'У19' }], before, 'lnkConclusion').affectedReferences).toEqual([])
})
