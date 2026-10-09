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
