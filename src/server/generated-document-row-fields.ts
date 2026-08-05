import { eq, inArray } from 'drizzle-orm'

import { requireDb } from '@/db'
import { generatedDocuments, generatedDocumentWeldJoints } from '@/db/schema'

export type GeneratedDocumentRowFields = {
  jsrDocument?: string | null
  jsrDocumentId?: number
  checklistDocument?: string | null
  checklistDocumentId?: number
  zniDocument?: string | null
  zniDocumentId?: number
}

type GeneratedDocumentCarrier = {
  id: unknown
}

export type GeneratedDocumentRowAssignment = {
  weldJointId: number
  documentId: number
  type: string
  title: string
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
    } as Row & GeneratedDocumentRowFields
  })
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
    })
    .from(generatedDocumentWeldJoints)
    .innerJoin(generatedDocuments, eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId))
    .where(inArray(generatedDocumentWeldJoints.weldJointId, ids))

  return applyGeneratedDocumentFields(rows, assignments)
}
