import { eq, inArray } from 'drizzle-orm'

import { requireDb } from '@/db'
import { generatedDocuments, generatedDocumentWeldJoints } from '@/db/schema'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { getSystemDocumentTemplateIdForField } from '@/lib/system-document-template-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

export type GeneratedDocumentRowFields = {
  jsrDocument?: string | null
  jsrDocumentId?: number
  checklistDocument?: string | null
  checklistDocumentId?: number
  zniDocument?: string | null
  zniDocumentId?: number
  systemDocumentIds?: Partial<Record<WeldFieldKey, number>>
}

type GeneratedDocumentCarrier = {
  id: unknown
}

export type GeneratedDocumentRowAssignment = {
  weldJointId: number
  documentId: number
  type: string
  title: string
  periodFrom?: string | null
}

export function applyGeneratedDocumentFields<Row extends GeneratedDocumentCarrier>(
  rows: Row[],
  assignments: GeneratedDocumentRowAssignment[],
): Array<Row & GeneratedDocumentRowFields> {
  const assignmentsByWeldId = new Map<number, GeneratedDocumentRowAssignment[]>()
  for (const assignment of assignments) {
    const current = assignmentsByWeldId.get(assignment.weldJointId) ?? []
    current.push(assignment)
    assignmentsByWeldId.set(assignment.weldJointId, current)
  }

  return rows.map((row) => {
    const weldAssignments = assignmentsByWeldId.get(Number(row.id))
    if (!weldAssignments) return row as Row & GeneratedDocumentRowFields
    const jsrAssignment = weldAssignments.find((assignment) => assignment.type === 'weldingJournal')
    const checklistAssignment = weldAssignments.find((assignment) => assignment.type === 'checklist')
    const zniAssignment = weldAssignments.find((assignment) => assignment.type === 'zni')
    const systemDocumentIds = buildSystemDocumentIds(row, weldAssignments)
    return {
      ...row,
      ...(jsrAssignment
        ? { jsrDocument: jsrAssignment.title, jsrDocumentId: jsrAssignment.documentId }
        : {}),
      ...(checklistAssignment
        ? {
            checklistDocument: checklistAssignment.title,
            checklistDocumentId: checklistAssignment.documentId,
          }
        : {}),
      ...(zniAssignment
        ? {
            zniDocument: zniAssignment.title,
            zniDocumentId: zniAssignment.documentId,
          }
        : {}),
      ...(Object.keys(systemDocumentIds).length > 0 ? { systemDocumentIds } : {}),
    } as Row & GeneratedDocumentRowFields
  })
}

function buildSystemDocumentIds<Row extends GeneratedDocumentCarrier>(
  row: Row,
  assignments: GeneratedDocumentRowAssignment[],
) {
  const values = row as Record<string, unknown>
  const result: Partial<Record<WeldFieldKey, number>> = {}
  const fields: Array<{ fieldKey: WeldFieldKey; dateKey: WeldFieldKey }> = [
    ...LNK_METHODS.map((method) => ({
      fieldKey: method.requestKey,
      dateKey: method.requestDateKey,
    })),
    ...LNK_METHODS.map((method) => ({
      fieldKey: method.conclusionKey,
      dateKey: method.conclusionDateKey,
    })),
    { fieldKey: 'pstoRequest', dateKey: 'pstoRequestDate' },
    { fieldKey: 'heatTreatmentDiagram', dateKey: 'pstoDate' },
  ]

  for (const { fieldKey, dateKey } of fields) {
    const title = normalizeText(values[fieldKey])
    if (!title) continue
    const templateId = getSystemDocumentTemplateIdForField(fieldKey)
    if (!templateId) continue
    const date = normalizeDate(values[dateKey])
    const assignment = assignments.find(
      (candidate) =>
        candidate.type === `system:${templateId}` &&
        normalizeText(candidate.title) === title &&
        normalizeDate(candidate.periodFrom) === date,
    )
    if (assignment) result[fieldKey] = assignment.documentId
  }

  return result
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeDate(value: unknown) {
  return String(value ?? '').trim().slice(0, 10)
}

export async function attachGeneratedDocumentFields<Row extends GeneratedDocumentCarrier>(
  rows: Row[],
): Promise<Array<Row & GeneratedDocumentRowFields>> {
  if (rows.length === 0) return rows
  const ids = [...new Set(rows.map((row) => Number(row.id)).filter(Number.isFinite))]
  if (ids.length === 0) return rows

  const db = requireDb()
  const assignments = await db
    .select({
      weldJointId: generatedDocumentWeldJoints.weldJointId,
      documentId: generatedDocuments.id,
      type: generatedDocuments.type,
      title: generatedDocuments.title,
      periodFrom: generatedDocuments.periodFrom,
    })
    .from(generatedDocumentWeldJoints)
    .innerJoin(generatedDocuments, eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId))
    .where(inArray(generatedDocumentWeldJoints.weldJointId, ids))

  return applyGeneratedDocumentFields(rows, assignments)
}
