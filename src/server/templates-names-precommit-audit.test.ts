import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { WeldRow } from '@/lib/dispatcher-types'
import { normalizeRequestConclusionSettings, type RequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { buildSystemDocumentSummaries, createSystemDocumentTemplateContext, getSystemDocumentNumber } from '@/lib/system-document-types'
import { buildDocumentOperationGroups, getDocumentOperationOccupiedNames, type DocumentOperationSource } from '@/lib/system-document-operation'
import { systemDocumentCounterKey } from '@/lib/system-document-sequence-id'
import type { SystemDocumentTemplateId } from '@/lib/system-document-template-types'
import { systemDocumentNameKey } from '@/lib/system-document-name-allocation'

// No database, server, fixtures or migrations: only production functions with
// explicit in-memory query results. Accidental real DB use must fail immediately.
vi.mock('@/db', () => ({ requireDb: () => { throw new Error('This audit must not connect to a database') } }))

import { checkOperationNameConflicts } from '@/server/document-operation-service'
import { buildInitialSystemDocumentSequenceQuery, loadExistingSystemDocumentNameKeys, reserveSystemDocumentNames, type SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'

const date = '2026-10-13'
const settings = normalizeRequestConclusionSettings({
  lnkConclusion: { systemPattern: 'ЗНК-{{Метод}}-{{Дата}}-{{№}}' },
  lnkConclusionBeforeHeatTreatment: { systemPattern: 'ЗНК-{{Метод}}-{{Дата}}-{{№}}' },
})
const name = (number: string) => `ЗНК-ВИК-13.10.2026-${number}`

function source(count = 2): DocumentOperationSource {
  const rows = Array.from({ length: count }, (_, i) => i + 1).map(id => ({ id, joint: `С${id}`, line: `Л${id}`, vikConclusion: name('005'), vikConclusionDate: date })) as WeldRow[]
  return {
    document: { ...buildSystemDocumentSummaries(rows, 'lnkConclusion')[0], documentId: 10, sourceKind: 'beforeHeatTreatment' },
    rows,
    controls: rows.map(row => ({
      position: { kind: 'beforeHeatTreatment', weldJointId: row.id, relationId: row.id + 100, methodCode: 'ВИК' },
      control: { id: row.id + 100, weldJointId: row.id, method: 'ВИК', conclusionName: name('005'), conclusionDate: date },
    })),
  }
}

function preview(occupiedNames: ReadonlyMap<SystemDocumentTemplateId, ReadonlySet<string>>, namingSettings = settings, count = 2) {
  return buildDocumentOperationGroups({
    sources: [source(count)], settings: namingSettings,
    request: { documentIds: [10], action: 'split', mode: 'joint', merge: false },
    nextNumbers: { lnkConclusionVik: 2, 'lnkConclusionVik:beforeHeatTreatment': 1 },
    occupiedNames,
  })
}

function reservationDatabase(namingSettings: RequestConclusionSettings = settings, names = [name('001'), name('005')]) {
  const select = vi.fn(() => {
    const result = [
      { key: systemDocumentCounterKey('lnkConclusionVik'), value: '2' },
      { key: systemDocumentCounterKey('lnkConclusionVik:beforeHeatTreatment'), value: '1' },
    ]
    const query = {
      from: () => query,
      where: () => query,
      limit: async () => [{ value: JSON.stringify(namingSettings) }],
      then: (resolve: (rows: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    }
    return query
  })
  const execute = vi.fn(async (query) => {
    const compiled = new PgDialect().sqlToQuery(query)
    return { rows: compiled.sql.includes('select distinct "sequenceId"')
      ? names.map(name => ({ sequenceId: 'lnkConclusionVik', date, name }))
      : [] }
  })
  const writes: Array<{ key: string; value: string }> = []
  const insert = vi.fn(() => ({ values: (value: { key: string; value: string }) => ({
    onConflictDoUpdate: async () => { writes.push(value) },
  }) }))
  return { tx: { select, execute, insert } as unknown as SystemDocumentSequenceTransaction, writes,
    calls: () => select.mock.calls.length + execute.mock.calls.length + insert.mock.calls.length }
}

describe('precommit audit: stage naming interactions', () => {
  it('a split preview is applicable after reset when the other stage owns the same full name', async () => {
    // Approved rules allow equal formulas; occupied full name + date must be
    // skipped across both stages. Repeating the preview must give a usable name.
    const { tx, writes } = reservationDatabase()
    const occupied = await loadExistingSystemDocumentNameKeys(tx, [source().document])
    const groups = preview(occupied)
    const conflictQuery = vi.fn(async () => ({ rows: [{ id: 20, type: 'system:lnkConclusionVik', title: name('001'), date, method: 'ВИК', source: null }] }))
    await checkOperationNameConflicts({ execute: conflictQuery } as never, groups, [10])
    expect(groups.every(group => !group.error)).toBe(true)
    const next = groups.find(group => group.reserveNumber)!
    expect(next.name).toBe(name('002'))
    expect(preview(occupied).find(group => group.reserveNumber)?.name).toBe(next.name)
    await expect(reserveSystemDocumentNames(tx, [{ request: {
      type: 'lnkConclusion', methodCode: 'ВИК', sourceKind: 'beforeHeatTreatment', date,
      fieldKeys: ['vikConclusion'], provisionalName: next.name,
    } }], { rejectChangedProvisionalNames: true })).resolves.toMatchObject([{ name: next.name }])
    expect(writes).toHaveLength(1)
  })

  it('retains the first number and skips both existing gaps and a later manual output name', async () => {
    const { tx, writes } = reservationDatabase(settings, [name('001'), name('003'), name('005')])
    const occupied = await loadExistingSystemDocumentNameKeys(tx, [source().document])
    const initial = preview(occupied, settings, 4)
    const groups = buildDocumentOperationGroups({
      sources: [source(4)], settings, nextNumbers: { 'lnkConclusionVik:beforeHeatTreatment': 1 }, occupiedNames: occupied,
      request: { documentIds: [10], action: 'split', mode: 'joint', merge: false,
        names: { [initial[3].key]: { mode: 'custom', name: name('004'), membership: '' } } },
    })
    expect(groups.map(group => group.name)).toEqual(['005', '002', '006', '004'].map(name))
    expect(groups[0]).toMatchObject({ systemNumber: 5, reserveNumber: false })
    expect(writes).toEqual([])
    const allocated = await reserveSystemDocumentNames(tx, groups.filter(group => group.reserveNumber).map(group => ({
      request: { type: 'lnkConclusion', methodCode: 'ВИК', sourceKind: 'beforeHeatTreatment', date,
        fieldKeys: ['vikConclusion'], provisionalName: group.name }, rows: group.rows,
    })), { rejectChangedProvisionalNames: true, occupiedNamesByTemplate: getDocumentOperationOccupiedNames(groups, occupied) })
    expect(allocated.map(item => item.name)).toEqual([name('002'), name('006')])
    expect(writes).toEqual([{ key: systemDocumentCounterKey('lnkConclusionVik:beforeHeatTreatment'), value: '7' }])
  })

  it.each(['ЗНК-{{Метод}}-ДО-ТО-{{Дата}}-{{№}}', 'Акт-{{Линия}}-{{№}}'])('does not block a free full name merely because number 1 exists: %s', async pattern => {
    const rules = normalizeRequestConclusionSettings({ ...settings, lnkConclusionBeforeHeatTreatment: { systemPattern: pattern } })
    const { tx } = reservationDatabase(rules, [name('001'), name('005'), 'Акт-Л1-001'])
    const occupied = await loadExistingSystemDocumentNameKeys(tx, [source().document])
    const group = preview(occupied, rules).find(group => group.reserveNumber)!
    expect(group.systemNumber).toBe(1)
    await expect(reserveSystemDocumentNames(tx, [{ request: {
      type: 'lnkConclusion', methodCode: 'ВИК', sourceKind: 'beforeHeatTreatment', date,
      fieldKeys: ['vikConclusion'], provisionalName: group.name,
    }, rows: group.rows }], { rejectChangedProvisionalNames: true })).resolves.toMatchObject([{ name: group.name }])
  })

  it('rejects a name occupied after preview before consuming a counter', async () => {
    const names = [name('001'), name('005')]
    const { tx, writes } = reservationDatabase(settings, names)
    const occupied = await loadExistingSystemDocumentNameKeys(tx, [source().document])
    const group = preview(occupied).find(group => group.reserveNumber)!
    names.push(group.name)
    await expect(reserveSystemDocumentNames(tx, [{ request: {
      type: 'lnkConclusion', methodCode: 'ВИК', sourceKind: 'beforeHeatTreatment', date,
      fieldKeys: ['vikConclusion'], provisionalName: group.name,
    } }], { rejectChangedProvisionalNames: true })).rejects.toThrow('Показанное системное имя уже занято')
    expect(writes).toEqual([])
  })

  it('does not block an equal full name on another date or mutate the shared snapshot', async () => {
    const occupied = new Map<SystemDocumentTemplateId, Set<string>>([['lnkConclusionVik', new Set([
      systemDocumentNameKey('2026-10-12', name('001')), systemDocumentNameKey(date, name('005')),
    ])]])
    const original = structuredClone(occupied)
    const groups = preview(occupied)
    const group = groups.find(group => group.reserveNumber)!
    expect(group.name).toBe(name('001'))
    const { tx } = reservationDatabase()
    const reserved = await reserveSystemDocumentNames(tx, [{ request: {
      type: 'lnkConclusion', methodCode: 'ВИК', sourceKind: 'beforeHeatTreatment', date,
      fieldKeys: ['vikConclusion'], provisionalName: group.name,
    } }], { rejectChangedProvisionalNames: true, occupiedNamesByTemplate: occupied })
    expect(reserved[0].name).toBe(group.name)
    expect(occupied).toEqual(original)
  })

  it('reservation itself skips the other stage without consuming its counter', async () => {
    const { tx, writes } = reservationDatabase()
    expect(await reserveSystemDocumentNames(tx, [{ request: {
      type: 'lnkConclusion', methodCode: 'ВИК', sourceKind: 'beforeHeatTreatment', date,
      fieldKeys: ['vikConclusion'], provisionalName: name('002'),
    } }], { rejectChangedProvisionalNames: true })).toMatchObject([{ name: name('002') }])
    expect(writes).toEqual([{ key: systemDocumentCounterKey('lnkConclusionVik:beforeHeatTreatment'), value: '3' }])
  })

  it('keeps a mixed-stage split and reservation identical while advancing independent counters', async () => {
    const before = source()
    const mainRows = before.rows.map(row => ({ ...row, id: row.id + 10 }))
    const main: DocumentOperationSource = { document: { ...buildSystemDocumentSummaries(mainRows, 'lnkConclusion')[0], documentId: 20 }, rows: mainRows }
    const { tx, writes } = reservationDatabase()
    const occupied = await loadExistingSystemDocumentNameKeys(tx, [before.document, main.document])
    const groups = buildDocumentOperationGroups({ sources: [main, before], settings, occupiedNames: occupied,
      nextNumbers: { lnkConclusionVik: 2, 'lnkConclusionVik:beforeHeatTreatment': 1 },
      request: { documentIds: [10, 20], action: 'split', mode: 'joint', merge: false } })
    expect(groups.map(group => group.name)).toEqual(['005', '002', '005', '003'].map(name))
    const allocated = await reserveSystemDocumentNames(tx, groups.filter(group => group.reserveNumber).map(group => ({
      request: { type: 'lnkConclusion', methodCode: 'ВИК', date, fieldKeys: ['vikConclusion'], provisionalName: group.name,
        ...(group.reference.sourceKind === 'beforeHeatTreatment' ? { sourceKind: 'beforeHeatTreatment' as const } : {}) },
      rows: group.rows,
    })), { rejectChangedProvisionalNames: true, occupiedNamesByTemplate: getDocumentOperationOccupiedNames(groups, occupied) })
    expect(allocated.map(item => item.name)).toEqual([name('002'), name('003')])
    expect(writes).toEqual([
      { key: systemDocumentCounterKey('lnkConclusionVik'), value: '4' },
      { key: systemDocumentCounterKey('lnkConclusionVik:beforeHeatTreatment'), value: '3' },
    ])
  })

  it('allocates 1,000 stage names with the same query-call count as one name', async () => {
    const measured = async (count: number) => {
      const db = reservationDatabase()
      const result = await reserveSystemDocumentNames(db.tx, Array.from({ length: count }, () => ({ request: {
        type: 'lnkConclusion' as const, methodCode: 'ВИК', sourceKind: 'beforeHeatTreatment' as const,
        date, fieldKeys: ['vikConclusion' as const], provisionalName: 'Предпросмотр',
      } })))
      expect(new Set(result.map(item => item.name)).size).toBe(count)
      expect(db.writes).toHaveLength(1)
      return db.calls()
    }
    const single = await measured(1)
    expect(await measured(1000)).toBe(single)
    expect(single).toBeLessThanOrEqual(7)
  })

  it('changing only the other stage formula must not change an existing document number in its template', () => {
    const original = normalizeRequestConclusionSettings({ lnkRequest: { systemPattern: 'НК-{{№}}' } })
    const document = { type: 'lnkRequest' as const, title: 'НК-1233', date }
    expect(getSystemDocumentNumber(document, original)).toBe('1233')
    const edited = normalizeRequestConclusionSettings({
      ...original,
      lnkRequestBeforeHeatTreatment: { systemPattern: 'НК-{{№}}33' },
    })
    expect(createSystemDocumentTemplateContext(document, [], edited).number).toBe('1233')
  })

  it('pre-TO has priority over the inherited main fallback, even without ДО-ТО in its own formula', () => {
    const rules = normalizeRequestConclusionSettings({
      lnkRequest: { systemPattern: 'НК-{{№}}33' },
      lnkRequestBeforeHeatTreatment: { systemPattern: 'НК-{{№}}' },
    })
    expect(getSystemDocumentNumber({ type: 'lnkRequest', sourceKind: 'beforeHeatTreatment', title: 'НК-12333', date }, rules)).toBe('12333')
    expect(getSystemDocumentNumber({ type: 'lnkRequest', title: 'НК-12333', date }, rules)).toBe('123')
  })

  it.each(['ВИК', 'РК', 'УЗК', 'ПВК'])('recognizes %s conclusion numbers by their stage, including a legacy formula without ДО-ТО', methodCode => {
    const rules = normalizeRequestConclusionSettings({
      lnkConclusion: { systemPattern: 'АКТ-{{Метод}}-{{№}}33' },
      lnkConclusionBeforeHeatTreatment: { systemPattern: 'АКТ-{{Метод}}-{{№}}' },
    })
    const reference = { type: 'lnkConclusion' as const, methodCode, title: `АКТ-${methodCode}-12333`, date }
    expect(createSystemDocumentTemplateContext(reference, [methodCode], rules).number).toBe('123')
    expect(createSystemDocumentTemplateContext({ ...reference, sourceKind: 'beforeHeatTreatment' }, [methodCode], rules).number).toBe('12333')
    const legacy = normalizeRequestConclusionSettings({ lnkConclusion: { systemPattern: 'СТАРЫЙ-{{Метод}}-{{№}}' } })
    expect(getSystemDocumentNumber({ ...reference, title: `СТАРЫЙ-${methodCode}-126`, sourceKind: 'beforeHeatTreatment' }, legacy)).toBe('126')
  })

  it('still recognizes old pre-TO names and unambiguous names retained on either stage transfer', () => {
    const old = normalizeRequestConclusionSettings({ lnkRequest: { systemPattern: 'СТАРОЕ-{{№}}' } })
    expect(getSystemDocumentNumber({ type: 'lnkRequest', sourceKind: 'beforeHeatTreatment', title: 'СТАРОЕ-126', date }, old)).toBe('126')
    expect(getSystemDocumentNumber({ type: 'lnkRequest', title: 'ДО-ТО-СТАРОЕ-127', date }, old)).toBe('127')
    const rules = normalizeRequestConclusionSettings({ lnkRequest: { systemPattern: 'ОСНОВНОЙ-{{№}}' },
      lnkRequestBeforeHeatTreatment: { systemPattern: 'ПРЕЖНИЙ-{{№}}' } })
    expect(getSystemDocumentNumber({ type: 'lnkRequest', sourceKind: 'beforeHeatTreatment', title: 'ПРЕЖНИЙ-128', date }, rules)).toBe('128')
    expect(getSystemDocumentNumber({ type: 'lnkRequest', title: 'ПРЕЖНИЙ-128', date }, rules)).toBe('128')
    expect(getSystemDocumentNumber({ type: 'lnkRequest', sourceKind: 'beforeHeatTreatment', title: 'ОСНОВНОЙ-129', date }, rules)).toBe('129')
  })

  it('cold-counter SQL prioritizes the source stage before fallback patterns in one aggregate', () => {
    const rules = normalizeRequestConclusionSettings({ lnkRequest: { systemPattern: 'ОСН-{{№}}' }, lnkRequestBeforeHeatTreatment: { systemPattern: 'ДО-{{№}}' } })
    const compiled = new PgDialect().sqlToQuery(buildInitialSystemDocumentSequenceQuery(rules, ['lnkRequest'])!)
    expect(compiled.sql).toContain('filter (where "sources"."patternPriority" = 0)')
    // The literal-prefix parameter immediately precedes its numeric priority.
    const priorities = (prefix: string) => compiled.params.flatMap((value, i) => value === prefix ? [compiled.params[i + 1]] : [])
    expect(priorities('ОСН-')).toContain(0)
    expect(priorities('ОСН-')).toContain(1)
    expect(priorities('ДО-')).toContain(0)
    expect(priorities('ДО-')).toContain(1)
    expect(compiled.sql.match(/from "weld_joints"/g)).toHaveLength(1)
    expect(compiled.sql.match(/from "pre_heat_treatment_controls"/g)).toHaveLength(1)
  })
})
