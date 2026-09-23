import { getDateInputValidationReason, normalizeDateLikeForStorage } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { ALL_LNK_FIELD_METHODS } from '@/lib/lnk-report-config'
import type { PreHeatTreatmentControlRecord } from '@/lib/lnk-control-stage'
import type { PstoRepeatCycleRecord } from '@/lib/psto-cycle'
import {
  type SystemDocumentReference,
  type SystemDocumentSourcePosition,
} from '@/lib/system-document-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

export type SystemDocumentDateChangePlan = {
  nextReference: SystemDocumentReference
  previousTitle: string
  nextTitle: string
  previousDate: string
  nextDate: string
  rowCount: number
  positionCount: number
  rows: WeldRow[]
  directRowIds: number[]
  touchedRowIds: number[]
  preHeatTreatmentControls: PreHeatTreatmentControlRecord[]
  pstoRepeatCycles: PstoRepeatCycleRecord[]
}

export function buildSystemDocumentDateChangePreview({
  reference,
  nextDate,
  rows,
  sourcePositions = [],
}: {
  reference: SystemDocumentReference
  nextDate: string
  rows: readonly WeldRow[]
  sourcePositions?: readonly SystemDocumentSourcePosition[]
}) {
  const normalizedDate = normalizeDateLikeForStorage(nextDate)
  if (!normalizedDate || normalizedDate === reference.date) return null
  try {
    const plan = buildSystemDocumentDateChangePlan({
      reference,
      nextDate: normalizedDate,
      rows,
      sourcePositions,
    })
    return {
      rows: plan.rows,
      nextReference: plan.nextReference,
      nextTitle: plan.nextTitle,
      nextDate: plan.nextDate,
      rowCount: plan.rowCount,
      positionCount: plan.positionCount,
    }
  } catch {
    return null
  }
}

export function buildSystemDocumentDateChangePlan({
  reference,
  nextDate,
  rows,
  sourcePositions = [],
}: {
  reference: SystemDocumentReference
  nextDate: string
  rows: readonly WeldRow[]
  sourcePositions?: readonly SystemDocumentSourcePosition[]
}): SystemDocumentDateChangePlan {
  const normalizedDate = normalizeDateLikeForStorage(nextDate)
  const dateReason = getDateInputValidationReason(nextDate, 'Дата документа')
  if (dateReason || !normalizedDate) throw new Error(dateReason || 'Укажите дату документа')
  if (!reference.title.trim()) throw new Error('Не указано наименование документа')
  if (normalizedDate === reference.date) throw new Error('Новая дата совпадает с текущей')
  if (rows.length === 0) throw new Error('В документе больше нет позиций')

  // Dates and names are independent facts, even when the name contains a date
  // or resembles a numbering template. Renaming is a separate explicit action.
  const nextTitle = reference.title
  const nextReference = { ...reference, date: normalizedDate }
  const proposedRows = rows.map(cloneRow)
  const rowsById = new Map(proposedRows.map((row) => [row.id, row]))
  const directRowIds = new Set<number>()
  const touchedRowIds = new Set<number>()
  const changedPreControls = new Map<number, PreHeatTreatmentControlRecord>()
  const changedRepeatCycles = new Map<number, PstoRepeatCycleRecord>()
  let positionCount = 0

  if (reference.sourceKind === 'beforeHeatTreatment') {
    for (const position of sourcePositions) {
      const row = requireRow(rowsById, position.weldJointId)
      const control = row.preHeatTreatmentControls?.find((candidate) => candidate.id === position.relationId)
      if (!control) throw staleDocumentError()
      assertSourceMethod(reference, position, control.method)
      const updated = changePreHeatTreatmentPosition(control, reference, normalizedDate, nextTitle)
      replaceRelation(row.preHeatTreatmentControls, updated)
      changedPreControls.set(updated.id, updated)
      touchedRowIds.add(row.id)
      positionCount += 1
    }
  } else if (reference.sourceKind === 'pstoCycle' || reference.sourceKind === 'pstoRepeat') {
    for (const position of sourcePositions) {
      const row = requireRow(rowsById, position.weldJointId)
      assertSourceMethod(reference, position, position.methodCode)
      if ((position.sequence ?? 1) === 1 && position.relationId === row.id) {
        Object.assign(row, changePstoCyclePosition(row, reference, normalizedDate, nextTitle))
        directRowIds.add(row.id)
      } else {
        const cycle = row.pstoRepeatCycles?.find((candidate) => candidate.id === position.relationId)
        if (!cycle) throw staleDocumentError()
        const updated = changePstoCyclePosition(cycle, reference, normalizedDate, nextTitle)
        replaceRelation(row.pstoRepeatCycles, updated)
        changedRepeatCycles.set(updated.id, updated)
      }
      touchedRowIds.add(row.id)
      positionCount += 1
    }
  } else {
    for (const row of proposedRows) {
      const changed = changePrimaryDocumentPositions(row, reference, normalizedDate, nextTitle)
      if (changed === 0) continue
      directRowIds.add(row.id)
      touchedRowIds.add(row.id)
      positionCount += changed
    }
  }

  if (positionCount === 0 || touchedRowIds.size === 0) throw staleDocumentError()
  if (sourcePositions.length > 0 && positionCount !== sourcePositions.length) throw staleDocumentError()

  return {
    nextReference,
    previousTitle: reference.title,
    nextTitle,
    previousDate: reference.date,
    nextDate: normalizedDate,
    rowCount: touchedRowIds.size,
    positionCount,
    rows: proposedRows,
    directRowIds: [...directRowIds].sort((left, right) => left - right),
    touchedRowIds: [...touchedRowIds].sort((left, right) => left - right),
    preHeatTreatmentControls: [...changedPreControls.values()],
    pstoRepeatCycles: [...changedRepeatCycles.values()],
  }
}

function changePrimaryDocumentPositions(
  row: WeldRow,
  reference: SystemDocumentReference,
  nextDate: string,
  nextTitle: string,
) {
  let changed = 0
  if (reference.type === 'lnkRequest') {
    for (const method of ALL_LNK_FIELD_METHODS) {
      if (reference.methodCode && method.code !== reference.methodCode) continue
      if (!reference.methodCode && method.code === 'ТВМТ') continue
      if (!isSamePosition(row[method.requestKey], row[method.requestDateKey], reference)) continue
      row[method.requestKey] = nextTitle
      row[method.requestDateKey] = nextDate
      changed += 1
    }
    return changed
  }
  if (reference.type === 'lnkConclusion') {
    const method = ALL_LNK_FIELD_METHODS.find((candidate) => candidate.code === reference.methodCode)
    if (!method || !isSamePosition(row[method.conclusionKey], row[method.conclusionDateKey], reference)) return 0
    row[method.conclusionKey] = nextTitle
    row[method.conclusionDateKey] = nextDate
    return 1
  }
  const fields = getPstoDocumentFields(reference)
  if (!fields || !isSamePosition(row[fields.nameKey], row[fields.dateKey], reference)) return 0
  const mutableRow = row as unknown as Record<string, unknown>
  mutableRow[fields.nameKey] = nextTitle
  mutableRow[fields.dateKey] = nextDate
  return 1
}

function changePreHeatTreatmentPosition(
  control: PreHeatTreatmentControlRecord,
  reference: SystemDocumentReference,
  nextDate: string,
  nextTitle: string,
) {
  const currentName = reference.type === 'lnkRequest' ? control.requestName : control.conclusionName
  const currentDate = reference.type === 'lnkRequest' ? control.requestDate : control.conclusionDate
  if (!isSamePosition(currentName, currentDate, reference)) throw staleDocumentError()
  return reference.type === 'lnkRequest'
    ? { ...control, requestName: nextTitle, requestDate: nextDate }
    : { ...control, conclusionName: nextTitle, conclusionDate: nextDate }
}

function changePstoCyclePosition<T extends WeldRow | PstoRepeatCycleRecord>(
  cycle: T,
  reference: SystemDocumentReference,
  nextDate: string,
  nextTitle: string,
): T {
  const fields = getPstoDocumentFields(reference)
  if (!fields || !isSamePosition(cycle[fields.nameKey as keyof T], cycle[fields.dateKey as keyof T], reference)) {
    throw staleDocumentError()
  }
  return {
    ...cycle,
    [fields.nameKey]: nextTitle,
    [fields.dateKey]: nextDate,
  }
}

function getPstoDocumentFields(reference: SystemDocumentReference): {
  nameKey: WeldFieldKey
  dateKey: WeldFieldKey
} | null {
  if (reference.type === 'pstoRequest') return { nameKey: 'pstoRequest', dateKey: 'pstoRequestDate' }
  if (reference.type === 'pstoConclusion') return { nameKey: 'heatTreatmentDiagram', dateKey: 'pstoDate' }
  if (reference.type === 'lnkRequest' && reference.methodCode === 'ТВМТ') {
    return { nameKey: 'tvmtRequest', dateKey: 'tvmtRequestDate' }
  }
  if (reference.type === 'lnkConclusion' && reference.methodCode === 'ТВМТ') {
    return { nameKey: 'tvmtConclusion', dateKey: 'tvmtConclusionDate' }
  }
  return null
}

function assertSourceMethod(
  reference: SystemDocumentReference,
  position: SystemDocumentSourcePosition,
  actualMethod: unknown,
) {
  const expected = reference.methodCode?.trim() ?? ''
  if (!expected) return
  const positionMethod = String(position.methodCode ?? actualMethod ?? '').trim()
  if (positionMethod !== expected) throw staleDocumentError()
}

function isSamePosition(name: unknown, date: unknown, reference: SystemDocumentReference) {
  return text(name) === reference.title && dateText(date) === reference.date
}

function cloneRow(row: WeldRow): WeldRow {
  return {
    ...row,
    preHeatTreatmentControls: row.preHeatTreatmentControls?.map((control) => ({ ...control })),
    pstoRepeatCycles: row.pstoRepeatCycles?.map((cycle) => ({ ...cycle })),
  }
}

function requireRow(rowsById: ReadonlyMap<number, WeldRow>, rowId: number) {
  const row = rowsById.get(rowId)
  if (!row) throw staleDocumentError()
  return row
}

function replaceRelation<T extends { id: number }>(relations: T[] | undefined, updated: T) {
  if (!relations) throw staleDocumentError()
  const index = relations.findIndex((relation) => relation.id === updated.id)
  if (index < 0) throw staleDocumentError()
  relations[index] = updated
}

function staleDocumentError() {
  return new Error('Состав или реквизиты документа уже изменились. Обновите данные и повторите действие. Ничего не сохранено.')
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function dateText(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  return text(value).slice(0, 10)
}
