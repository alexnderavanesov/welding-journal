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
  persistSourcedSystemDocumentChangesInTransaction,
  persistSourcedSystemDocumentUpsertPlans,
  persistSystemDocumentSummaryRecordsInTransaction,
} from '@/server/system-document-index'
import { WELD_ROW_VERSION_SELECT } from '@/server/weld-server-shared'

describe('sourced system document database load', () => {
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
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
    const values = vi.fn(() => ({ onConflictDoNothing }))
    const insert = vi.fn(() => ({ values }))

    await persistSourcedSystemDocumentChangesInTransaction({
      delete: deleteRows,
      execute,
      insert,
    } as never, changes, new Date('2026-09-04T10:00:00.000Z'))

    expect(deleteRows).toHaveBeenCalledTimes(2)
    expect(deleteWhere).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledTimes(1)
    expect(values).toHaveBeenCalledTimes(1)
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1)
    const compiledUpdate = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0])
    expect(compiledUpdate.sql).toContain('update "generated_documents"')
    expect(compiledUpdate.sql).toContain('from (values')
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
    const returning = vi.fn().mockResolvedValue(returnedDocuments)
    const values = vi.fn(() => ({ returning }))
    const insert = vi.fn(() => ({ values }))
    const execute = vi.fn().mockResolvedValue(undefined)

    const result = await persistSystemDocumentSummaryRecordsInTransaction({
      tx: { execute, insert } as never,
      summaries,
      matchedDocumentIds: new Map(),
      now: new Date('2026-09-04T10:00:00.000Z'),
    })

    expect(insert).toHaveBeenCalledTimes(1)
    expect(values).toHaveBeenCalledTimes(1)
    expect(returning).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
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
    const returning = vi.fn()
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
    let insertCall = 0
    const insert = vi.fn(() => {
      insertCall += 1
      return {
        values: vi.fn((records: Array<Record<string, unknown>>) => {
          if (insertCall === 1) {
            returning.mockResolvedValueOnce(records.map((record, index) => ({
              id: 5_000 + index,
              type: record.type,
              title: record.title,
              periodFrom: record.periodFrom,
              sourceMetadata: record.sourceMetadata,
            })).reverse())
            return { returning }
          }
          return { onConflictDoNothing }
        }),
      }
    })
    const execute = vi.fn().mockResolvedValue(undefined)
    const deleteRows = vi.fn()

    const documentIds = await persistSourcedSystemDocumentUpsertPlans(
      { insert, execute, delete: deleteRows } as never,
      plans,
      new Date('2026-09-04T10:00:00.000Z'),
    )

    expect(documentIds.size).toBe(documentCount)
    expect(insert).toHaveBeenCalledTimes(2)
    expect(returning).toHaveBeenCalledTimes(1)
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
    expect(deleteRows).not.toHaveBeenCalled()
  })

  it.each([2, 100])('batch-updates %i sourced documents and their assignments', async (documentCount) => {
    const plans = Array.from({ length: documentCount }, (_, index) => sourcedPlan(index, 6_000 + index))
    const execute = vi.fn().mockResolvedValue(undefined)
    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    const deleteRows = vi.fn(() => ({ where: deleteWhere }))
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
    const values = vi.fn(() => ({ onConflictDoNothing }))
    const insert = vi.fn(() => ({ values }))

    const documentIds = await persistSourcedSystemDocumentUpsertPlans(
      { insert, execute, delete: deleteRows } as never,
      plans,
      new Date('2026-09-04T10:00:00.000Z'),
    )

    expect(documentIds.size).toBe(documentCount)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(deleteRows).toHaveBeenCalledTimes(1)
    expect(deleteWhere).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledTimes(1)
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1)
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
