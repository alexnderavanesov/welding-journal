import type { WeldRow } from '@/lib/dispatcher-types'
import {
  isPreHeatTreatmentLnkMethodCode,
  type PreHeatTreatmentControlRecord,
  type PreHeatTreatmentLnkMethodCode,
} from '@/lib/lnk-control-stage'
import { LNK_METHODS } from '@/lib/lnk-report-config'

export type LnkStageTransferPosition = {
  rowId: number
  methodCode: PreHeatTreatmentLnkMethodCode
}

export type LnkStageTransferControlWrite = Omit<
  PreHeatTreatmentControlRecord,
  'id' | 'createdAt' | 'updatedAt'
>

export type LnkDocumentStageTransferPreview = {
  documentId: number
  sourceStage: 'primary' | 'beforeHeatTreatment'
  targetStage: 'primary' | 'beforeHeatTreatment'
  rowCount: number
  positionCount: number
  completedResultCount: number
  methodCodes: PreHeatTreatmentLnkMethodCode[]
}

export function buildPrimaryToPreHeatTreatmentTransfer({
  rows,
  positions,
}: {
  rows: WeldRow[]
  positions: LnkStageTransferPosition[]
}) {
  const positionsByRowId = groupPositions(positions)
  const controls: LnkStageTransferControlWrite[] = []
  const nextRows = rows.map((row) => {
    const methodCodes = positionsByRowId.get(row.id)
    if (!methodCodes) return row
    let next = { ...row } as WeldRow
    for (const methodCode of methodCodes) {
      const method = getMethod(methodCode)
      if (getPreControl(row, methodCode)) {
        throw new Error(`Стык ${formatJoint(row)}: ${methodCode} до ТО уже заполнен.`)
      }
      const requestName = text(row[method.requestKey])
      const result = text(row[method.resultKey])
      if (!hasPrimaryTrace(row, methodCode)) {
        throw new Error(`Стык ${formatJoint(row)}: основной комплект ${methodCode} уже пуст.`)
      }
      controls.push({
        weldJointId: row.id,
        method: methodCode,
        requestName: textOrNull(row[method.requestKey]),
        requestDate: textOrNull(row[method.requestDateKey]),
        result: isFinalResult(result) ? result : requestName ? 'ожидает НК' : null,
        conclusionDate: textOrNull(row[method.conclusionDateKey]),
        conclusionName: textOrNull(row[method.conclusionKey]),
        defectDescription: methodCode === 'РК' ? textOrNull(row.lnkDefectDescription) : null,
        rkExposureConfirmedDiameter: methodCode === 'РК'
          ? numberOrNull(row.rkExposureConfirmedDiameter)
          : null,
      })
      next = clearPrimaryMethod(next, methodCode)
    }
    return next
  })
  assertAllPositionsResolved(positions, controls.map((control) => ({
    rowId: control.weldJointId,
    methodCode: normalizeMethodCode(control.method) as PreHeatTreatmentLnkMethodCode,
  })))
  return { rows: nextRows, controls }
}

export function buildClearedPrimaryLnkStageRows({
  rows,
  positions,
}: {
  rows: WeldRow[]
  positions: LnkStageTransferPosition[]
}) {
  const positionsByRowId = groupPositions(positions)
  const resolved: LnkStageTransferPosition[] = []
  const nextRows = rows.map((row) => {
    const methodCodes = positionsByRowId.get(row.id)
    if (!methodCodes) return row
    let next = { ...row } as WeldRow
    for (const methodCode of methodCodes) {
      if (!hasPrimaryTrace(row, methodCode)) {
        throw new Error(`Стык ${formatJoint(row)}: основной комплект ${methodCode} уже пуст.`)
      }
      next = clearPrimaryMethod(next, methodCode)
      resolved.push({ rowId: row.id, methodCode })
    }
    return next
  })
  assertAllPositionsResolved(positions, resolved)
  return nextRows
}

export function buildPreHeatTreatmentToPrimaryTransfer({
  rows,
  controls,
}: {
  rows: WeldRow[]
  controls: PreHeatTreatmentControlRecord[]
}) {
  const controlsByRowId = new Map<number, PreHeatTreatmentControlRecord[]>()
  for (const control of controls) {
    const methodCode = normalizeMethodCode(control.method)
    if (!isPreHeatTreatmentLnkMethodCode(methodCode)) continue
    const current = controlsByRowId.get(control.weldJointId) ?? []
    current.push(control)
    controlsByRowId.set(control.weldJointId, current)
  }

  const nextRows = rows.map((row) => {
    const rowControls = controlsByRowId.get(row.id)
    if (!rowControls) return row
    let next = { ...row } as WeldRow
    for (const control of rowControls) {
      const methodCode = normalizeMethodCode(control.method) as PreHeatTreatmentLnkMethodCode
      const method = getMethod(methodCode)
      if (hasPrimaryTrace(row, methodCode)) {
        throw new Error(`Стык ${formatJoint(row)}: основной комплект ${methodCode} уже заполнен.`)
      }
      next = {
        ...next,
        [method.requestKey]: textOrNull(control.requestName),
        [method.requestDateKey]: textOrNull(control.requestDate),
        [method.resultKey]: textOrNull(control.result),
        [method.conclusionDateKey]: textOrNull(control.conclusionDate),
        [method.conclusionKey]: textOrNull(control.conclusionName),
        ...(methodCode === 'РК'
          ? {
              lnkDefectDescription: textOrNull(control.defectDescription),
              rkExposureConfirmedDiameter: numberOrNull(control.rkExposureConfirmedDiameter),
            }
          : {}),
      }
    }
    return next
  })
  const resolved = nextRows.flatMap((row) => (controlsByRowId.get(row.id) ?? []).map((control) => ({
    rowId: row.id,
    methodCode: normalizeMethodCode(control.method) as PreHeatTreatmentLnkMethodCode,
  })))
  assertAllPositionsResolved(controls.map((control) => ({
    rowId: control.weldJointId,
    methodCode: normalizeMethodCode(control.method) as PreHeatTreatmentLnkMethodCode,
  })), resolved)
  return nextRows
}

export function hasPrimaryLnkStageTrace(row: WeldRow, methodCode: PreHeatTreatmentLnkMethodCode) {
  return hasPrimaryTrace(row, methodCode)
}

function groupPositions(positions: LnkStageTransferPosition[]) {
  const grouped = new Map<number, Set<PreHeatTreatmentLnkMethodCode>>()
  for (const position of positions) {
    const methodCode = normalizeMethodCode(position.methodCode)
    if (!isPreHeatTreatmentLnkMethodCode(methodCode)) {
      throw new Error(`${methodCode || 'Выбранный метод'} не поддерживает этап «До ТО».`)
    }
    const current = grouped.get(position.rowId) ?? new Set<PreHeatTreatmentLnkMethodCode>()
    current.add(methodCode)
    grouped.set(position.rowId, current)
  }
  return grouped
}

function getMethod(methodCode: PreHeatTreatmentLnkMethodCode) {
  return LNK_METHODS.find((method) => method.code === methodCode)!
}

function getPreControl(row: WeldRow, methodCode: PreHeatTreatmentLnkMethodCode) {
  return row.preHeatTreatmentControls?.find(
    (control) => normalizeMethodCode(control.method) === methodCode,
  )
}

function hasPrimaryTrace(row: WeldRow, methodCode: PreHeatTreatmentLnkMethodCode) {
  const method = getMethod(methodCode)
  const values = [
    row[method.requestKey],
    row[method.requestDateKey],
    row[method.conclusionDateKey],
    row[method.conclusionKey],
  ]
  if (isFinalResult(row[method.resultKey])) values.push(row[method.resultKey])
  if (methodCode === 'РК') values.push(row.lnkDefectDescription, row.rkExposureConfirmedDiameter)
  return values.some((value) => text(value).length > 0)
}

function clearPrimaryMethod(row: WeldRow, methodCode: PreHeatTreatmentLnkMethodCode) {
  const method = getMethod(methodCode)
  return {
    ...row,
    [method.requestKey]: null,
    [method.requestDateKey]: null,
    [method.resultKey]: null,
    [method.conclusionDateKey]: null,
    [method.conclusionKey]: null,
    ...(methodCode === 'РК'
      ? {
          lnkDefectDescription: null,
          rkExposureConfirmedDiameter: null,
        }
      : {}),
  } as WeldRow
}

function assertAllPositionsResolved(
  expected: Array<{ rowId: number; methodCode: PreHeatTreatmentLnkMethodCode }>,
  actual: Array<{ rowId: number; methodCode: PreHeatTreatmentLnkMethodCode }>,
) {
  const actualKeys = new Set(actual.map(positionKey))
  const missing = expected.find((position) => !actualKeys.has(positionKey(position)))
  if (missing) throw new Error(`Стык #${missing.rowId}: позиция ${missing.methodCode} больше не существует.`)
}

function positionKey(position: { rowId: number; methodCode: string }) {
  return `${position.rowId}:${normalizeMethodCode(position.methodCode)}`
}

function isFinalResult(value: unknown) {
  const result = text(value).toLocaleLowerCase('ru-RU')
  return result === 'годен' || result === 'ремонт' || result === 'вырез'
}

function textOrNull(value: unknown) {
  return text(value) || null
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeMethodCode(value: unknown) {
  return text(value).toLocaleUpperCase('ru-RU')
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function formatJoint(row: WeldRow) {
  return text(row.joint) || `#${row.id}`
}
