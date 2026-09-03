import { eq, inArray } from 'drizzle-orm'

import { requireDb } from '@/db'
import { generatedDocuments, generatedDocumentWeldJoints } from '@/db/schema'
import { ALL_LNK_FIELD_METHODS as LNK_METHODS } from '@/lib/lnk-report-config'
import { getSystemDocumentTemplateIdForField } from '@/lib/system-document-template-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { ensureLayeredControlDocumentsInitialized } from '@/server/layered-control-documents'

export type GeneratedDocumentRowFields = {
  jsrDocument?: string | null
  jsrDocumentId?: number
  checklistDocument?: string | null
  checklistDocumentId?: number
  zniDocument?: string | null
  zniDocumentId?: number
  layeredVikEdgesDocument?: string | null
  layeredVikEdgesDocumentId?: number
  layeredVikLayersDocument?: string | null
  layeredVikLayersDocumentId?: number
  layeredPvkEdgesDocument?: string | null
  layeredPvkEdgesDocumentId?: number
  layeredPvkLayersDocument?: string | null
  layeredPvkLayersDocumentId?: number
  layeredVikDocuments?: string | null
  layeredPvkDocuments?: string | null
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
    const layeredVikEdgesAssignment = weldAssignments.find(
      (assignment) => assignment.type === 'layeredVikEdges',
    )
    const layeredVikLayersAssignment = weldAssignments.find(
      (assignment) => assignment.type === 'layeredVikLayers',
    )
    const layeredPvkEdgesAssignment = weldAssignments.find(
      (assignment) => assignment.type === 'layeredPvkEdges',
    )
    const layeredPvkLayersAssignment = weldAssignments.find(
      (assignment) => assignment.type === 'layeredPvkLayers',
    )
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
      ...(layeredVikEdgesAssignment
        ? {
            layeredVikEdgesDocument: layeredVikEdgesAssignment.title,
            layeredVikEdgesDocumentId: layeredVikEdgesAssignment.documentId,
          }
        : {}),
      ...(layeredVikLayersAssignment
        ? {
            layeredVikLayersDocument: layeredVikLayersAssignment.title,
            layeredVikLayersDocumentId: layeredVikLayersAssignment.documentId,
          }
        : {}),
      ...(layeredPvkEdgesAssignment
        ? {
            layeredPvkEdgesDocument: layeredPvkEdgesAssignment.title,
            layeredPvkEdgesDocumentId: layeredPvkEdgesAssignment.documentId,
          }
        : {}),
      ...(layeredPvkLayersAssignment
        ? {
            layeredPvkLayersDocument: layeredPvkLayersAssignment.title,
            layeredPvkLayersDocumentId: layeredPvkLayersAssignment.documentId,
          }
        : {}),
      ...buildLayeredCompositeField(
        'layeredVikDocuments',
        layeredVikEdgesAssignment,
        layeredVikLayersAssignment,
      ),
      ...buildLayeredCompositeField(
        'layeredPvkDocuments',
        layeredPvkEdgesAssignment,
        layeredPvkLayersAssignment,
      ),
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
  await ensureLayeredControlDocumentsInitialized()
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

function buildLayeredCompositeField(
  fieldKey: 'layeredVikDocuments' | 'layeredPvkDocuments',
  edgesAssignment: GeneratedDocumentRowAssignment | undefined,
  layersAssignment: GeneratedDocumentRowAssignment | undefined,
) {
  const lines = [
    edgesAssignment ? `Кромки: ${edgesAssignment.title}` : '',
    layersAssignment ? `Слои: ${layersAssignment.title}` : '',
  ].filter(Boolean)
  return lines.length > 0 ? { [fieldKey]: lines.join('\n') } : {}
}
