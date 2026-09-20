import { and, eq, inArray, like } from 'drizzle-orm'

import { requireDb } from '@/db'
import { generatedDocuments, generatedDocumentWeldJoints } from '@/db/schema'
import { ALL_LNK_FIELD_METHODS as LNK_METHODS } from '@/lib/lnk-report-config'
import { PRE_HEAT_TREATMENT_REPORT_FIELDS } from '@/lib/pre-heat-treatment-report-fields'
import { getSystemDocumentTemplateIdForField } from '@/lib/system-document-template-types'
import { getCurrentPstoCycle } from '@/lib/tvmt-cycle'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import { ensureLayeredControlDocumentsInitialized } from '@/server/layered-control-documents'
import { splitNumberBatches } from '@/server/weld-request-utils'

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
  sourceMetadata?: string | null
}

type SystemDocumentFieldMatch = {
  fieldKey: WeldFieldKey
  dateKey: WeldFieldKey
  sourceStage?: 'primary' | 'beforeHeatTreatment' | 'pstoCycle' | 'pstoRepeat'
  title?: unknown
  date?: unknown
  cycleSequence?: number
}

const PRE_HEAT_TREATMENT_DOCUMENT_FIELDS: SystemDocumentFieldMatch[] = PRE_HEAT_TREATMENT_REPORT_FIELDS
  .filter((field) => field.valueKey === 'requestName' || field.valueKey === 'conclusionName')
  .map((field) => ({
    fieldKey: field.fieldKey,
    dateKey: PRE_HEAT_TREATMENT_REPORT_FIELDS.find((candidate) =>
      candidate.methodCode === field.methodCode &&
      candidate.valueKey === (field.valueKey === 'requestName' ? 'requestDate' : 'conclusionDate'),
    )!.fieldKey,
    sourceStage: 'beforeHeatTreatment',
  }))

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
  const currentCycle = getCurrentPstoCycle(row as WeldInput)
  const cycleSourceStage = 'pstoCycle' as const
  const fields: SystemDocumentFieldMatch[] = [
    ...LNK_METHODS.filter((method) => method.code !== 'ТВМТ').map((method) => ({
      fieldKey: method.requestKey,
      dateKey: method.requestDateKey,
      sourceStage: 'primary' as const,
    })),
    ...LNK_METHODS.filter((method) => method.code !== 'ТВМТ').map((method) => ({
      fieldKey: method.conclusionKey,
      dateKey: method.conclusionDateKey,
      sourceStage: 'primary' as const,
    })),
    ...PRE_HEAT_TREATMENT_DOCUMENT_FIELDS,
    ...(currentCycle ? [
      {
        fieldKey: 'pstoRequest' as const,
        dateKey: 'pstoRequestDate' as const,
        sourceStage: cycleSourceStage,
        title: currentCycle.pstoRequest,
        date: currentCycle.pstoRequestDate,
        cycleSequence: currentCycle.sequence,
      },
      {
        fieldKey: 'heatTreatmentDiagram' as const,
        dateKey: 'pstoDate' as const,
        sourceStage: cycleSourceStage,
        title: currentCycle.heatTreatmentDiagram,
        date: currentCycle.pstoDate,
        cycleSequence: currentCycle.sequence,
      },
      {
        fieldKey: 'tvmtRequest' as const,
        dateKey: 'tvmtRequestDate' as const,
        sourceStage: cycleSourceStage,
        title: currentCycle.tvmtRequest,
        date: currentCycle.tvmtRequestDate,
        cycleSequence: currentCycle.sequence,
      },
      {
        fieldKey: 'tvmtConclusion' as const,
        dateKey: 'tvmtConclusionDate' as const,
        sourceStage: cycleSourceStage,
        title: currentCycle.tvmtConclusion,
        date: currentCycle.tvmtConclusionDate,
        cycleSequence: currentCycle.sequence,
      },
    ] : []),
  ]

  for (const { fieldKey, dateKey, sourceStage, title: suppliedTitle, date: suppliedDate, cycleSequence } of fields) {
    const title = normalizeText(suppliedTitle ?? values[fieldKey])
    if (!title) continue
    const templateId = getSystemDocumentTemplateIdForField(fieldKey)
    if (!templateId) continue
    const date = normalizeDate(suppliedDate ?? values[dateKey])
    const assignment = assignments.find(
      (candidate) =>
        candidate.type === `system:${templateId}` &&
        normalizeText(candidate.title) === title &&
        normalizeDate(candidate.periodFrom) === date &&
        matchesSystemDocumentSourceStage(candidate.sourceMetadata, sourceStage, cycleSequence),
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

function matchesSystemDocumentSourceStage(
  value: string | null | undefined,
  expected: SystemDocumentFieldMatch['sourceStage'],
  cycleSequence?: number,
) {
  if (!expected) return true
  const metadata = parseSystemDocumentSourceMetadata(value)
  const stageMatches = expected === 'primary'
    ? metadata.sourceKind === null
    : expected === 'pstoCycle'
      ? metadata.sourceKind === 'pstoCycle' ||
        metadata.sourceKind === 'pstoRepeat' ||
        (metadata.sourceKind === null && cycleSequence === 1)
    : metadata.sourceKind === expected
  if (!stageMatches) return false
  return cycleSequence === undefined ||
    metadata.cycleSequences.length === 0 ||
    metadata.cycleSequences.includes(cycleSequence)
}

function parseSystemDocumentSourceMetadata(value: string | null | undefined) {
  try {
    const parsed = value
      ? JSON.parse(value) as { sourceKind?: unknown; cycleSequences?: unknown }
      : null
    const sourceKind = parsed?.sourceKind
    return {
      sourceKind: sourceKind === 'beforeHeatTreatment' || sourceKind === 'pstoCycle' || sourceKind === 'pstoRepeat'
        ? sourceKind
        : null,
      cycleSequences: Array.isArray(parsed?.cycleSequences)
        ? parsed.cycleSequences
            .map(Number)
            .filter((sequence) => Number.isInteger(sequence) && sequence > 0)
        : [],
    }
  } catch {
    return { sourceKind: null, cycleSequences: [] }
  }
}

export async function attachGeneratedDocumentFields<Row extends GeneratedDocumentCarrier>(
  rows: Row[],
): Promise<Array<Row & GeneratedDocumentRowFields>> {
  return applyGeneratedDocumentFields(rows, await loadGeneratedDocumentAssignments(rows))
}

export async function loadGeneratedDocumentAssignments<Row extends GeneratedDocumentCarrier>(
  rows: Row[],
  db?: Pick<ReturnType<typeof requireDb>, 'select'>,
): Promise<GeneratedDocumentRowAssignment[]> {
  if (rows.length === 0) return []
  await ensureLayeredControlDocumentsInitialized()
  const ids = [...new Set(rows.map((row) => Number(row.id)).filter(Number.isFinite))]
  if (ids.length === 0) return []

  const database = db ?? requireDb()
  const assignments: GeneratedDocumentRowAssignment[] = []
  for (const idBatch of splitNumberBatches(ids, 1000)) {
    assignments.push(...await database
      .select({
        weldJointId: generatedDocumentWeldJoints.weldJointId,
        documentId: generatedDocuments.id,
        type: generatedDocuments.type,
        title: generatedDocuments.title,
        periodFrom: generatedDocuments.periodFrom,
        sourceMetadata: generatedDocuments.sourceMetadata,
      })
      .from(generatedDocumentWeldJoints)
      .innerJoin(generatedDocuments, eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId))
      .where(inArray(generatedDocumentWeldJoints.weldJointId, idBatch)))
  }

  return assignments
}

export async function attachSystemDocumentIds<Row extends GeneratedDocumentCarrier>(
  rows: Row[],
  db: Pick<ReturnType<typeof requireDb>, 'select'> = requireDb(),
): Promise<Array<Row & Pick<GeneratedDocumentRowFields, 'systemDocumentIds'>>> {
  if (rows.length === 0) return rows
  const ids = [...new Set(rows.map((row) => Number(row.id)).filter(Number.isFinite))]
  if (ids.length === 0) return rows

  const assignments: GeneratedDocumentRowAssignment[] = []
  for (const idBatch of splitNumberBatches(ids, 1000)) {
    assignments.push(...await db
      .select({
        weldJointId: generatedDocumentWeldJoints.weldJointId,
        documentId: generatedDocuments.id,
        type: generatedDocuments.type,
        title: generatedDocuments.title,
        periodFrom: generatedDocuments.periodFrom,
        sourceMetadata: generatedDocuments.sourceMetadata,
      })
      .from(generatedDocumentWeldJoints)
      .innerJoin(generatedDocuments, eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId))
      .where(and(
        inArray(generatedDocumentWeldJoints.weldJointId, idBatch),
        like(generatedDocuments.type, 'system:%'),
      )))
  }

  const assignmentsByWeldId = new Map<number, GeneratedDocumentRowAssignment[]>()
  for (const assignment of assignments) {
    const current = assignmentsByWeldId.get(assignment.weldJointId) ?? []
    current.push(assignment)
    assignmentsByWeldId.set(assignment.weldJointId, current)
  }
  return rows.map((row) => {
    const systemDocumentIds = buildSystemDocumentIds(
      row,
      assignmentsByWeldId.get(Number(row.id)) ?? [],
    )
    const mergedIds = {
      ...(row as Row & GeneratedDocumentRowFields).systemDocumentIds,
      ...systemDocumentIds,
    }
    return Object.keys(mergedIds).length > 0 ? { ...row, systemDocumentIds: mergedIds } : row
  })
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
