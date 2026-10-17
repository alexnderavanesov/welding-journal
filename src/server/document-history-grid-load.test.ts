import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { requireDb } from '@/db'
import { loadRemoteGeneratedDocumentHistoryFilterOptions, loadRemoteGeneratedDocumentHistoryGrid, normalizeGeneratedDocumentHistoryFilterOptionsRequest, normalizeGeneratedDocumentHistoryGridRequest } from './generated-documents'
import { loadIndexedSystemDocumentHistoryFilterOptions, loadIndexedSystemDocumentHistoryGrid } from './system-document-index'
import { normalizeSystemDocumentHistoryFilterOptionsRequest, normalizeSystemDocumentHistoryGridRequest } from './system-documents'
import type { DocumentHistoryGridRequest } from '@/lib/document-history-grid'

vi.mock('@/db', () => ({ requireDb: vi.fn() }))
const block: DocumentHistoryGridRequest = { startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] }

describe('document registry grid bounded query execution', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    { fieldKey: 'period' as const, search: '07.10.2026', value: '01.10.2026 - 07.10.2026' },
    { fieldKey: 'updatedAt' as const, search: '02.10.2026', value: '02.10.2026, 00:10' },
  ])('searches generated $fieldKey facets in their visible date format with one bounded query', async ({ fieldKey, search, value }) => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ value, count: 3 }] })
    const limit = vi.fn().mockResolvedValue([])
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }))
    vi.mocked(requireDb).mockReturnValue({ select, execute } as unknown as ReturnType<typeof requireDb>)
    const result = await loadRemoteGeneratedDocumentHistoryFilterOptions(normalizeGeneratedDocumentHistoryFilterOptionsRequest({
      type: 'weldingJournal', fieldKey, search,
    }))
    expect(result).toEqual({ options: [{ value, label: value, count: 3 }], hasMore: false })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledTimes(1)
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
    expect(query.sql).toContain(`"option_document"."filter_${fieldKey}"`)
    expect(query.sql).toMatch(/position\(\$\d+ in lower\("option_value"\."value"\)\) > 0/)
    expect(query.params).toContain(search)
    expect(query.params.at(-1)).toBe(201)
    if (fieldKey === 'period') {
      expect(query.sql).toContain('to_char("document_aggregate"."periodFrom", \'DD.MM.YYYY\')')
      expect(query.sql).toContain('to_char("document_aggregate"."periodTo", \'DD.MM.YYYY\')')
    } else {
      expect(query.sql).toContain('"document_aggregate"."updatedAt" at time zone \'Europe/Moscow\'')
      expect(query.sql).toContain("'DD.MM.YYYY, HH24:MI'")
    }
  })

  it('searches indexed system date facets in the displayed format, preserving their exact filter token', async () => {
    const value = '02.10.2026'
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ value, count: 4 }] })
    const limit = vi.fn().mockResolvedValue([{ value: '4' }])
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }))
    const transaction = vi.fn(async callback => callback({ execute, select }))
    vi.mocked(requireDb).mockReturnValue({ transaction } as unknown as ReturnType<typeof requireDb>)
    const result = await loadIndexedSystemDocumentHistoryFilterOptions(normalizeSystemDocumentHistoryFilterOptionsRequest({
      type: 'lnkRequest', fieldKey: 'date', search: value,
    }))
    expect(result).toEqual({ options: [{ value, label: value, count: 4 }], hasMore: false })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(select).toHaveBeenCalledTimes(1)
    const query = new PgDialect().sqlToQuery(execute.mock.calls[1][0])
    expect(query.sql).toContain('to_char("document_source"."date"::date, \'DD.MM.YYYY\')')
    expect(query.sql).toContain('"option_document"."filter_date"')
    expect(query.sql).toMatch(/position\(\$\d+ in lower\("option_value"\."value"\)\) > 0/)
    expect(query.params).toContain(value)
    expect(query.params.at(-1)).toBe(201)
  })

  it.each([10, 1000, 5000])('uses one generated summary query plus settings for %i exact IDs', async count => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ rows: [], rowCount: 0, total: 200_000, matchingSelectedIds: [1, 3] }] })
    const limit = vi.fn().mockResolvedValue([])
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }))
    vi.mocked(requireDb).mockReturnValue({ select, execute } as unknown as ReturnType<typeof requireDb>)
    const result = await loadRemoteGeneratedDocumentHistoryGrid(normalizeGeneratedDocumentHistoryGridRequest({
      ...block, type: 'weldingJournal', selectedIds: Array.from({ length: count }, (_, index) => index + 1),
    }))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledTimes(1)
    expect(limit).toHaveBeenCalledTimes(1)
    expect(result.matchingSelectedIds).toEqual([1, 3])
    expect(result.total).toBe(200_000)
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
    expect(query.sql).toContain('count("generated_document_weld_joints"."weld_joint_id")')
    expect(query.sql).toContain('group by "generated_documents"."id"')
    expect(query.params).toContainEqual(Array.from({ length: count }, (_, index) => index + 1))
  })

  it.each(['block', 'group', 'selection'] as const)('keeps the indexed system %s path at three statements and preserves operation identity', async kind => {
    const metadata = {
      label: 'Повтор ПСТО', sourceKind: 'pstoCycle', cycleSequences: [2, 4], methodCode: 'ТВМТ', methodCodes: ['ТВМТ'],
      positionCount: 7, projects: ['П1', 'П2'], subtitleCodes: ['Ш1'], lines: ['Л1', 'Л2'], periodFrom: '2026-10-01', periodTo: '2026-10-03',
    }
    const document = { documentId: 42, type: 'pstoConclusion', title: 'Имя', date: '2026-10-03', fileName: 'a.xlsx', rowCount: 5,
      metadata, documentVersion: 'v42', specialistsRevision: 7, specialists: { first: { id: 9, name: 'Иванов' }, second: null }, updatedAt: '2026-10-04' }
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{
      rows: kind === 'group' ? [{ groupKey: ['multiple'], childCount: 200_000 }] : [document],
      rowCount: 1, total: 200_000, matchingSelectedIds: [42],
    }] })
    const limit = vi.fn().mockResolvedValue([{ value: '4' }])
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }))
    const transaction = vi.fn(async callback => callback({ execute, select }))
    vi.mocked(requireDb).mockReturnValue({ transaction } as unknown as ReturnType<typeof requireDb>)
    const request = normalizeSystemDocumentHistoryGridRequest({ ...block, type: 'pstoConclusion',
      selectedIds: ['system-document:42'], ...(kind === 'group' ? { rowGroupCols: ['line'] } : {}),
      ...(kind === 'selection' ? { selectionOnly: true } : {}),
    })
    const result = await loadIndexedSystemDocumentHistoryGrid(request)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(2) // Existing index lock plus one summary/group/count/selection statement.
    expect(select).toHaveBeenCalledTimes(1) // Existing initialized-index check.
    expect(limit).toHaveBeenCalledTimes(1)
    expect(result.matchingSelectedIds).toEqual(['system-document:42'])
    if (kind !== 'group') expect(result.rows[0]).toMatchObject({
      id: 'system-document:42', documentId: 42, sourceKind: 'pstoCycle', cycleSequences: [2, 4],
      methodCode: 'ТВМТ', methodCodes: ['ТВМТ'], rowCount: 5, positionCount: 7,
      documentVersion: 'v42', specialistsRevision: 7, specialists: document.specialists, rowIds: [],
      projects: ['П1', 'П2'], subtitleCodes: ['Ш1'], lines: ['Л1', 'Л2'],
    })
    const query = new PgDialect().sqlToQuery(execute.mock.calls[1][0])
    expect(query.sql).not.toContain('"generated_document_weld_joints"')
    expect(query.sql).not.toContain('"weld_joints"')
    expect(query.sql).toContain("'cycleSequences',")
    expect(query.sql).not.toContain("'sourcePositions',") // Composition is not projected into summary metadata.
    expect(query.sql).not.toContain('insert into')
  })
})
