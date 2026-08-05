import { createServerFn } from '@tanstack/react-start'
import { and, asc, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

import { requireDb } from '@/db'
import { weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import {
  buildSystemDocumentSummaries,
  isSystemDocumentType,
  type SystemDocumentReference,
  type SystemDocumentSummary,
  type SystemDocumentType,
} from '@/lib/system-document-types'

const BASE_HISTORY_SELECT = {
  id: weldJoints.id,
  weldDate: weldJoints.weldDate,
  projectTitle: weldJoints.projectTitle,
  subtitleCode: weldJoints.subtitleCode,
  line: weldJoints.line,
  updatedAt: weldJoints.updatedAt,
}

const LNK_REQUEST_HISTORY_SELECT = {
  ...BASE_HISTORY_SELECT,
  ...Object.fromEntries(
    LNK_METHODS.flatMap((method) => [
      [method.requestKey, weldJoints[method.requestKey]],
      [method.requestDateKey, weldJoints[method.requestDateKey]],
    ]),
  ),
}

const LNK_CONCLUSION_HISTORY_SELECT = {
  ...BASE_HISTORY_SELECT,
  ...Object.fromEntries(
    LNK_METHODS.flatMap((method) => [
      [method.conclusionKey, weldJoints[method.conclusionKey]],
      [method.conclusionDateKey, weldJoints[method.conclusionDateKey]],
    ]),
  ),
}

const PSTO_REQUEST_HISTORY_SELECT = {
  ...BASE_HISTORY_SELECT,
  pstoRequest: weldJoints.pstoRequest,
  pstoRequestDate: weldJoints.pstoRequestDate,
}

const PSTO_CONCLUSION_HISTORY_SELECT = {
  ...BASE_HISTORY_SELECT,
  heatTreatmentDiagram: weldJoints.heatTreatmentDiagram,
  pstoDate: weldJoints.pstoDate,
}

export const listSystemDocuments = createServerFn({ method: 'GET' })
  .validator((data: { type: SystemDocumentType }) => ({
    type: requireSystemDocumentType(data?.type),
  }))
  .handler(async ({ data }): Promise<SystemDocumentSummary[]> => {
    const db = requireDb()
    const rows =
      data.type === 'lnkRequest'
        ? await db.select(LNK_REQUEST_HISTORY_SELECT).from(weldJoints).where(hasAnyLnkRequest())
        : data.type === 'lnkConclusion'
          ? await db.select(LNK_CONCLUSION_HISTORY_SELECT).from(weldJoints).where(hasAnyLnkConclusion())
          : data.type === 'pstoRequest'
            ? await db
                .select(PSTO_REQUEST_HISTORY_SELECT)
                .from(weldJoints)
                .where(hasText(weldJoints.pstoRequest))
            : await db
                .select(PSTO_CONCLUSION_HISTORY_SELECT)
                .from(weldJoints)
                .where(hasText(weldJoints.heatTreatmentDiagram))

    return buildSystemDocumentSummaries(
      rows as unknown as Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>,
      data.type,
    )
  })

export const getSystemDocumentRows = createServerFn({ method: 'GET' })
  .validator(normalizeSystemDocumentReference)
  .handler(async ({ data }): Promise<WeldRow[]> => {
    const db = requireDb()
    const rows = await db
      .select()
      .from(weldJoints)
      .where(buildSystemDocumentWhere(data))
      .orderBy(
        asc(weldJoints.projectTitle),
        asc(weldJoints.subtitleCode),
        asc(weldJoints.line),
        asc(weldJoints.joint),
      )

    return rows.map(compactSystemDocumentRow)
  })

function buildSystemDocumentWhere(reference: SystemDocumentReference): SQL {
  if (reference.type === 'lnkRequest') {
    const conditions = LNK_METHODS.map((method) =>
      and(
        textEquals(weldJoints[method.requestKey], reference.title),
        dateEquals(weldJoints[method.requestDateKey], reference.date),
      ),
    )
    return or(...conditions) ?? sql`false`
  }

  if (reference.type === 'lnkConclusion') {
    const method = LNK_METHODS.find((candidate) => candidate.code === reference.methodCode)
    if (!method) return sql`false`
    return and(
      textEquals(weldJoints[method.conclusionKey], reference.title),
      dateEquals(weldJoints[method.conclusionDateKey], reference.date),
    ) ?? sql`false`
  }

  if (reference.type === 'pstoRequest') {
    return and(
      textEquals(weldJoints.pstoRequest, reference.title),
      dateEquals(weldJoints.pstoRequestDate, reference.date),
    ) ?? sql`false`
  }

  return and(
    textEquals(weldJoints.heatTreatmentDiagram, reference.title),
    dateEquals(weldJoints.pstoDate, reference.date),
  ) ?? sql`false`
}

function hasAnyLnkRequest() {
  return or(...LNK_METHODS.map((method) => hasText(weldJoints[method.requestKey])))
}

function hasAnyLnkConclusion() {
  return or(...LNK_METHODS.map((method) => hasText(weldJoints[method.conclusionKey])))
}

function hasText(column: SQLWrapper) {
  return sql`nullif(btrim(${column}), '') is not null`
}

function textEquals(column: SQLWrapper, value: string) {
  return sql`btrim(coalesce(${column}, '')) = ${value}`
}

function dateEquals(column: SQLWrapper, value: string) {
  return sql`coalesce(${column}::text, '') = ${value}`
}

function requireSystemDocumentType(value: unknown): SystemDocumentType {
  if (!isSystemDocumentType(value)) throw new Error('Неизвестный тип системного документа.')
  return value
}

function normalizeSystemDocumentReference(data: SystemDocumentReference): SystemDocumentReference {
  const type = requireSystemDocumentType(data?.type)
  const title = String(data?.title ?? '').trim()
  const date = String(data?.date ?? '').trim().slice(0, 10)
  const methodCode = String(data?.methodCode ?? '').trim()
  if (!title) throw new Error('Не указано наименование системного документа.')
  if (type === 'lnkConclusion' && !LNK_METHODS.some((method) => method.code === methodCode)) {
    throw new Error('Не указан вид контроля заключения ЛНК.')
  }
  return {
    type,
    title,
    date,
    ...(methodCode ? { methodCode } : {}),
  }
}

function compactSystemDocumentRow(row: typeof weldJoints.$inferSelect): WeldRow {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  ) as unknown as WeldRow
}
