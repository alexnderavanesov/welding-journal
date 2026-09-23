import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { PgDialect } from 'drizzle-orm/pg-core'

import {
  generatedDocuments,
  generatedDocumentWeldJoints,
  weldJoints,
} from '@/db/schema'
import type { SystemDocumentSummary } from '@/lib/system-document-types'
import {
  buildSourcedSystemDocumentCandidateWhere,
  buildSystemDocumentNameConflictWhere,
  persistSourcedSystemDocumentChangesInTransaction,
  persistSourcedSystemDocumentUpsertPlans,
  persistSystemDocumentSummaryRecordsInTransaction,
  queryIndexedSystemDocumentHistory,
  rebuildSystemDocumentIndexInTransaction,
} from '@/server/system-document-index'
import { WELD_ROW_VERSION_SELECT } from '@/server/weld-server-shared'

describe('sourced system document database load', () => {
  it('returns the stored count with one history query without reading every assignment', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{
        documents: [{ documentId: 19, title: 'Заявка ЛНК', date: '2026-09-22', rowCount: 200_000 }],
        total: 1,
        filterOptions: {},
      }],
    })

    const history = await queryIndexedSystemDocumentHistory(
      { execute } as never,
      { type: 'lnkRequest', limit: 100, columnFilters: {} },
    )

    expect(execute).toHaveBeenCalledTimes(1)
    expect(history.documents[0]).toMatchObject({ documentId: 19, rowCount: 200_000, rowIds: [] })
  })

  it('loads all sourced-document identity candidates with one array-bound query', () => {
    const compiled = drizzle.mock()
      .select()
      .from(generatedDocuments)
      .where(buildSourcedSystemDocumentCandidateWhere([
        { storageType: 'system:lnkRequest', date: '2026-09-21', title: 'Заявка 1' },
        { storageType: 'system:lnkConclusionRk', date: '2026-09-22', title: 'Заключение 2' },
      ]))
      .toSQL()

    expect(compiled.sql).toContain('exists (')
    expect(compiled.sql).toContain('from unnest(')
    expect(compiled.sql).toContain('lookup(storage_type, document_date, title)')
    expect(compiled.params).toEqual([
      ['system:lnkRequest', 'system:lnkConclusionRk'],
      ['2026-09-21', '2026-09-22'],
      ['Заявка 1', 'Заключение 2'],
    ])
  })

  it('checks one rename conflict without loading document assignments', () => {
    const compiled = drizzle.mock()
      .select({ id: generatedDocuments.id })
      .from(generatedDocuments)
      .where(buildSystemDocumentNameConflictWhere({
        type: 'lnkConclusion',
        methodCode: 'РК',
        title: 'ЗНК-РК-22.09.2026-017',
        date: '2026-09-22',
        excludeDocumentId: 41,
      }))
      .limit(1)
      .toSQL()

    expect(compiled.sql).toContain('"generated_documents"."type" = $1')
    expect(compiled.sql).toContain('"generated_documents"."title" = $2')
    expect(compiled.sql).toContain('"generated_documents"."period_from" = $3')
    expect(compiled.sql).toContain('"generated_documents"."id" <> $4')
    expect(compiled.sql).toContain('limit $5')
    expect(compiled.params).toEqual([
      'system:lnkConclusionRk',
      'ЗНК-РК-22.09.2026-017',
      '2026-09-22',
      41,
      1,
    ])
  })

  it.each(['lnkRequest', 'lnkConclusion', 'pstoRequest', 'pstoConclusion'] as const)(
    'rebuilds the %s index with a constant SQL request count',
    async (type) => {
      const execute = vi.fn().mockResolvedValue({ rows: [] })

      await rebuildSystemDocumentIndexInTransaction({ execute } as never, type)

      expect(execute).toHaveBeenCalledTimes(15)
      const compiledQueries = execute.mock.calls.map(([query]) =>
        new PgDialect().sqlToQuery(query).sql,
      )
      expect(compiledQueries.filter((query) => query.includes('create temporary table'))).toHaveLength(4)
      expect(compiledQueries.some((query) => query.includes('cross join lateral (values'))).toBe(true)
      expect(compiledQueries.some((query) => query.includes('insert into "generated_document_weld_joints"'))).toBe(true)
    },
  )

  it('qualifies the weld row version in joined document queries', () => {
    const compiled = drizzle.mock()
      .select({ rowVersion: WELD_ROW_VERSION_SELECT })
      .from(generatedDocumentWeldJoints)
      .innerJoin(
        generatedDocuments,
        eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId),
      )
      .innerJoin(weldJoints, eq(weldJoints.id, generatedDocumentWeldJoints.weldJointId))
      .toSQL()

    expect(compiled.sql).toContain('"weld_joints".xmin::text as "row_version"')
  })

  it('keeps the qualified weld row version valid in mutation returning clauses', () => {
    const compiled = drizzle.mock()
      .update(weldJoints)
      .set({ updatedAt: new Date('2026-09-04T10:00:00.000Z') })
      .returning({ rowVersion: WELD_ROW_VERSION_SELECT })
      .toSQL()

    expect(compiled.sql).toContain('returning "weld_joints".xmin::text as "row_version"')
  })

  it.each([2, 100])('persists %i document changes with a bounded query count', async (documentCount) => {
    const changes = Array.from({ length: documentCount }, (_, index) => ({
      documentId: index + 1,
      rowIds: index === documentCount - 1 ? [] : [10_000 + index],
      sourceMetadata: JSON.stringify({ sourceKind: 'beforeHeatTreatment', index }),
    }))
    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    const deleteRows = vi.fn(() => ({ where: deleteWhere }))
    const execute = vi.fn().mockResolvedValue(undefined)

    await persistSourcedSystemDocumentChangesInTransaction({
      delete: deleteRows,
      execute,
    } as never, changes, new Date('2026-09-04T10:00:00.000Z'))

    expect(deleteRows).toHaveBeenCalledTimes(2)
    expect(deleteWhere).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledTimes(2)
    const compiledUpdate = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0])
    expect(compiledUpdate.sql).toContain('update "generated_documents"')
    expect(compiledUpdate.sql).toContain('from unnest')
    const compiledAssignments = new PgDialect().sqlToQuery(execute.mock.calls[1]?.[0])
    expect(compiledAssignments.sql).toContain('insert into "generated_document_weld_joints"')
  })

  it('deletes thousands of empty sourced documents with one array-bound statement', async () => {
    const changes = Array.from({ length: 2_501 }, (_, index) => ({
      documentId: index + 1,
      rowIds: [],
      sourceMetadata: '',
    }))
    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    const deleteRows = vi.fn(() => ({ where: deleteWhere }))

    await persistSourcedSystemDocumentChangesInTransaction({
      delete: deleteRows,
      execute: vi.fn(),
      insert: vi.fn(),
    } as never, changes)

    expect(deleteRows).toHaveBeenCalledTimes(1)
    expect(deleteWhere).toHaveBeenCalledTimes(1)
    const compiled = new PgDialect().sqlToQuery(deleteWhere.mock.calls[0]?.[0])
    expect(compiled.sql).toMatch(/= any\(\$\d+::integer\[\]\)/)
    expect(compiled.params[0]).toHaveLength(2_501)
  })

  it('batch-inserts new summaries and matches returned rows by identity instead of result order', async () => {
    const summaries = Array.from({ length: 100 }, (_, index) => summary(index + 1))
    const returnedDocuments = summaries.map((item, index) => ({
      id: 1_000 + index,
      type: 'system:lnkRequest',
      title: item.title,
      periodFrom: item.date,
      sourceMetadata: null,
    })).reverse()
    const execute = vi.fn().mockResolvedValue({ rows: returnedDocuments })

    const result = await persistSystemDocumentSummaryRecordsInTransaction({
      tx: { execute } as never,
      summaries,
      matchedDocumentIds: new Map(),
      now: new Date('2026-09-04T10:00:00.000Z'),
    })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(new Map(result.map((item) => [item.title, item.documentId]))).toEqual(
      new Map(returnedDocuments.map((item) => [item.title, item.id])),
    )
  })

  it('batch-updates 100 existing summaries in one query', async () => {
    const summaries = Array.from({ length: 100 }, (_, index) => summary(index + 1))
    const execute = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn()

    const result = await persistSystemDocumentSummaryRecordsInTransaction({
      tx: { execute, insert } as never,
      summaries,
      matchedDocumentIds: new Map(summaries.map((_, index) => [index, 2_000 + index])),
      now: new Date('2026-09-04T10:00:00.000Z'),
    })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(insert).not.toHaveBeenCalled()
    expect(result.map((item) => item.documentId)).toEqual(
      summaries.map((_, index) => 2_000 + index),
    )
  })

  it.each([2, 100])('batch-inserts %i sourced documents and their assignments', async (documentCount) => {
    const plans = Array.from({ length: documentCount }, (_, index) => sourcedPlan(index, null))
    const execute = vi.fn()
      .mockResolvedValueOnce({
        rows: plans.map((plan, index) => ({
          id: 5_000 + index,
          type: plan.storageType,
          title: plan.summary.title,
          periodFrom: plan.summary.date,
          sourceMetadata: plan.sourceMetadata,
        })).reverse(),
      })
      .mockResolvedValue({ rows: [] })
    const deleteRows = vi.fn()

    const documentIds = await persistSourcedSystemDocumentUpsertPlans(
      { execute, delete: deleteRows } as never,
      plans,
      new Date('2026-09-04T10:00:00.000Z'),
    )

    expect(documentIds.size).toBe(documentCount)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(deleteRows).not.toHaveBeenCalled()
  })

  it.each([2, 100])('batch-updates %i sourced documents and their assignments', async (documentCount) => {
    const plans = Array.from({ length: documentCount }, (_, index) => sourcedPlan(index, 6_000 + index))
    const execute = vi.fn().mockResolvedValue(undefined)
    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    const deleteRows = vi.fn(() => ({ where: deleteWhere }))

    const documentIds = await persistSourcedSystemDocumentUpsertPlans(
      { execute, delete: deleteRows } as never,
      plans,
      new Date('2026-09-04T10:00:00.000Z'),
    )

    expect(documentIds.size).toBe(documentCount)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(deleteRows).toHaveBeenCalledTimes(1)
    expect(deleteWhere).toHaveBeenCalledTimes(1)
  })
})

function summary(index: number): SystemDocumentSummary {
  const date = `2026-09-${String((index % 28) + 1).padStart(2, '0')}`
  return {
    id: `summary-${index}`,
    documentId: 0,
    type: 'lnkRequest',
    title: `Заявка ${index}`,
    date,
    label: `Заявка ${index}`,
    fileName: `Заявка ${index}.xlsx`,
    methodCodes: ['РК'],
    rowCount: 1,
    positionCount: 1,
    projects: ['Проект'],
    subtitleCodes: ['Шифр'],
    lines: ['Линия'],
    periodFrom: date,
    periodTo: date,
    updatedAt: '2026-09-04T10:00:00.000Z',
    rowIds: [index],
  }
}

function sourcedPlan(index: number, targetDocumentId: number | null) {
  const documentSummary = summary(index + 1)
  const sourcePositions = [{
    kind: 'beforeHeatTreatment' as const,
    weldJointId: index + 1,
    relationId: 10_000 + index,
    methodCode: 'РК',
  }]
  const sourceMetadata = JSON.stringify({
    label: documentSummary.label,
    sourceKind: 'beforeHeatTreatment',
    cycleSequences: [],
    methodCodes: documentSummary.methodCodes,
    positionCount: 1,
    projects: documentSummary.projects,
    subtitleCodes: documentSummary.subtitleCodes,
    lines: documentSummary.lines,
    periodFrom: documentSummary.periodFrom,
    periodTo: documentSummary.periodTo,
    sourcePositions,
  })
  return {
    summary: { ...documentSummary, sourceKind: 'beforeHeatTreatment' as const },
    sourcePositions,
    inputIndexes: [index],
    scopeKey: JSON.stringify([
      'system:lnkRequest',
      documentSummary.title,
      documentSummary.date,
      'beforeHeatTreatment',
      '',
    ]),
    storageType: 'system:lnkRequest',
    targetDocumentId,
    redundantDocumentIds: [],
    rowIds: [index + 1],
    sourceMetadata,
  }
}
