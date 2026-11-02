import { describe, expect, it } from 'vitest'
import { activityActionLabel, activityValueLabel } from './activity-labels'
import { activityPositionSummary, presentActivityChanges, type ActivityRecord } from './activity-presentation'

const row: ActivityRecord = { id: 1, entity: 'generated_documents', label: '502', jointId: null, kind: 'update', changes: {} }
const snapshot = { label: 'Заключение ПСТО', sourceKind: 'pstoCycle', cycleSequences: [1], methodCodes: [], positionCount: 1,
  projects: ['Риформинг'], subtitleCodes: ['73281024/4152-330-ТКМ5'], lines: ['330-FG-03-000'], periodFrom: '2026-08-21', periodTo: '2026-08-21',
  sourcePositions: [{ kind: 'pstoCycle', weldJointId: 2881, relationId: 2881, sequence: 1 }] }
describe('readable saved activity', () => {
  it('compares document snapshots field by field, preserving real composition changes', () => {
    const after = { ...snapshot, positionCount: 2, lines: [...snapshot.lines, '330-P42/P59-03-000'], periodTo: '2026-09-23',
      sourcePositions: [...snapshot.sourcePositions, { kind: 'pstoCycle', weldJointId: 6832, relationId: 6832, sequence: 1 }] }
    const record = { ...row, changes: { sourceMetadata: { before: JSON.stringify(snapshot), after: JSON.stringify(after) } } }
    const original = JSON.stringify(record)
    expect(presentActivityChanges(record).map(change => change.valueKey)).toEqual(['positionCount', 'lines', 'periodTo', 'sourcePositions'])
    expect(JSON.stringify(record)).toBe(original)
  })
  it('does not invent business changes for rowIds backfill or JSON property order', () => {
    expect(presentActivityChanges({ ...row, changes: { sourceMetadata: { before: JSON.stringify(snapshot), after: JSON.stringify({ rowIds: [2881], ...snapshot }) } } })).toEqual([])
    expect(presentActivityChanges({ ...row, changes: { sourceMetadata: { before: { lines: ['A'], sourceKind: 'pstoCycle' }, after: { sourceKind: 'pstoCycle', lines: ['A'] } } } })).toEqual([])
  })
  it('shows changes to positions even when their count and line stay the same', () => {
    const after = { ...snapshot, sourcePositions: [{ ...snapshot.sourcePositions[0], weldJointId: 6832, relationId: 6832 }] }
    expect(presentActivityChanges({ ...row, changes: { sourceMetadata: { before: JSON.stringify(snapshot), after: JSON.stringify(after) } } }).map(change => change.valueKey)).toEqual(['sourcePositions'])
  })
  it('summarizes position changes without converting a missing old snapshot into an empty document', () => {
    const change = { key: 'sourceMetadata.sourcePositions', valueKey: 'sourcePositions', label: 'Позиции документа', after: [{ weldJointId: 1 }] }
    expect(activityPositionSummary(change, 'update')).toBe('Обновлены сведения о позициях документа.')
    expect(activityPositionSummary(change, 'create')).toBe('Позиций в документе: 1.')
    expect(activityPositionSummary({ ...change, before: [] }, 'update')).toBe('Состав позиций документа изменён. Количество: 0 → 1.')
    expect(activityPositionSummary({ ...change, before: [{ weldJointId: 2 }] }, 'update')).toBe('Состав позиций документа изменён.')
    expect(activityPositionSummary({ ...change, before: [] }, 'delete')).toBe('Позиций в удалённом документе: 0.')
    expect(activityPositionSummary({ ...change, before: [] }, 'update', false)).toBe('Состав позиций документа изменён.')
  })
  it('merges duplicate displayed counts only when both saved sides agree', () => {
    const record = { ...row, changes: { rowCount: { before: 1, after: 2 }, sourceMetadata: { before: JSON.stringify({ positionCount: 1 }), after: JSON.stringify({ positionCount: 2 }) } } }
    const original = JSON.stringify(record)
    expect(presentActivityChanges(record)).toEqual([{ key: 'rowCount', valueKey: 'rowCount', label: 'Количество стыков и позиций', before: 1, after: 2 }])
    expect(JSON.stringify(record)).toBe(original)
    record.changes.sourceMetadata.before = JSON.stringify({ positionCount: 3 })
    expect(presentActivityChanges(record).map(change => change.valueKey)).toEqual(['rowCount', 'positionCount'])
  })
  it('keeps false, zero, removals and precise numbers; omits only empty creation/deletion fields', () => {
    for (const kind of ['create', 'delete'] as const) {
      const side = kind === 'create' ? 'after' : 'before'
      const result = presentActivityChanges({ ...row, kind, changes: { title: { [side]: '' }, rowCount: { [side]: 0 }, archived: { [side]: false } } })
      expect(result.map(change => change.valueKey)).toEqual(['rowCount', 'archived'])
    }
    expect(presentActivityChanges({ ...row, changes: { title: { before: 'A', after: null }, wdiTotal: { before: 1.001, after: 1.002 } } })).toHaveLength(2)
  })
  it('leaves malformed and future metadata intact in history without implying cleared fields', () => {
    const changes = { sourceMetadata: { before: JSON.stringify(snapshot), after: '{broken' }, unknownNewField: { after: 'preserved' } }
    expect(presentActivityChanges({ ...row, changes })).toEqual([])
    expect(changes.sourceMetadata.after).toBe('{broken')
    expect(presentActivityChanges({ ...row, changes: { sourceMetadata: { before: JSON.stringify(snapshot), after: null } } }).map(change => change.valueKey)).toContain('sourcePositions')
  })
  it('translates document types, MIME, stages, dates and operations without reinterpreting numbers', () => {
    expect(activityValueLabel('generated_documents', 'type', 'system:pstoRequest')).toBe('Заявка ПСТО')
    expect(activityValueLabel('generated_documents', 'type', 'system:lnkConclusionVik')).toBe('Заключение ВИК')
    expect(activityValueLabel('generated_documents', 'type', 'weldingJournal')).toBe('ЖСР')
    expect(activityValueLabel('generated_documents', 'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('Excel (.xlsx)')
    expect(activityValueLabel('', 'sourceKind', 'beforeHeatTreatment')).toBe('НК до ТО')
    expect(activityValueLabel('', 'periodTo', '2026-09-23')).toBe('23.09.2026')
    expect(activityValueLabel('', 'rowCount', 0)).toBe('0')
    expect(activityValueLabel('', 'title', '2026-09-23')).toBe('2026-09-23')
    expect(activityActionLabel('savePreHeatTreatmentLnkWorkflow', 'lnk')).toBe('Заявки и результаты НК до ТО')
  })
})
