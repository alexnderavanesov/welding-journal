import { createServerFn } from '@tanstack/react-start'
import { eq, inArray, sql } from 'drizzle-orm'

import { requireDb } from '@/db'
import {
  appSettings,
  preHeatTreatmentControls,
  weldJoints,
  type NewPreHeatTreatmentControl,
} from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  PRE_HEAT_TREATMENT_LNK_METHODS,
  type PreHeatTreatmentControlRecord,
  type PreHeatTreatmentLnkMethodCode,
} from '@/lib/lnk-control-stage'
import {
  buildPreHeatTreatmentRequestCorrectionWrite,
  buildPreHeatTreatmentRequestWrites,
  buildPreHeatTreatmentResultCorrectionWrite,
  buildPreHeatTreatmentResultWrite,
  getPreHeatTreatmentRequestRemovalBlockReason,
  getPreHeatTreatmentResultRemovalBlockReason,
  PRE_HEAT_TREATMENT_RESULT_OPTIONS,
  type PreHeatTreatmentControlWrite,
} from '@/lib/pre-heat-treatment-control-updates'
import { mergePreHeatTreatmentControlsIntoRows } from '@/lib/heat-treatment-control-relations'
import { buildSystemDocumentSummaries, type SystemDocumentType } from '@/lib/system-document-types'
import { buildPreHeatTreatmentSystemDocumentRow } from '@/lib/system-document-virtual-row'
import {
  DEFAULT_OTHER_SETTINGS,
  normalizeOtherSettings,
  type RkExposureTableSettings,
} from '@/lib/other-settings'
import { serializeRkExposureLines, type RkExposureLine } from '@/lib/rk-exposure'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { calculateFinalStatus } from '@/lib/weld-status'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { assertStoredEarlyCoilDecisionSourcesRemainValid } from '@/server/early-coil-decision-guard'
import { assertPstoWorkflowLinesFullyAssigned } from '@/server/psto-workflow-line-guard'
import { assertSecurityScope } from '@/server/security-functions'
import {
  removeSourcedSystemDocumentPositionsInTransaction,
  upsertSourcedSystemDocumentInTransaction,
} from '@/server/system-document-index'
import {
  reserveSystemDocumentName,
  type SystemDocumentSequenceTransaction,
  type SystemDocumentSequenceUpdate,
} from '@/server/system-document-sequences'

export type PreHeatTreatmentLnkWorkflowAction = 'request' | 'result'

export type PreHeatTreatmentLnkPosition = {
  rowId: number
  methodCode: PreHeatTreatmentLnkMethodCode
}

export type PreHeatTreatmentLnkWorkflowGroup = {
  positions: PreHeatTreatmentLnkPosition[]
  name: string
  useSystemName?: boolean
}

export type PreHeatTreatmentLnkResultEntry = PreHeatTreatmentLnkPosition & {
  result: string
  defectDescription?: string
  rkExposureConfirmedDiameter?: number | null
}

export type PreHeatTreatmentLnkWorkflowPayload = {
  action: PreHeatTreatmentLnkWorkflowAction
  date: string
  groups: PreHeatTreatmentLnkWorkflowGroup[]
  results?: PreHeatTreatmentLnkResultEntry[]
}

type NormalizedPayload = {
  action: PreHeatTreatmentLnkWorkflowAction
  date: string
  groups: Array<PreHeatTreatmentLnkWorkflowGroup & { useSystemName: boolean }>
  results: PreHeatTreatmentLnkResultEntry[]
}

export const savePreHeatTreatmentLnkWorkflow = createServerFn({ method: 'POST' })
  .validator(normalizePayload)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()
    return db.transaction(async (tx) => {
      await assertPreHeatTreatmentLnkEnabled(tx)
      const rowIds = [...new Set(data.groups.flatMap((group) =>
        group.positions.map((position) => position.rowId),
      ))]
      const storedRows = await tx
        .select()
        .from(weldJoints)
        .where(inArray(weldJoints.id, rowIds))
        .for('update')
      if (storedRows.length !== rowIds.length) {
        throw new Error('Один или несколько выбранных стыков больше не существуют. Обновите отчет ЛНК.')
      }
      await assertPstoWorkflowLinesFullyAssigned(tx, storedRows, { allowPerformedHistoryRows: true })
      await tx
        .select({ id: preHeatTreatmentControls.id })
        .from(preHeatTreatmentControls)
        .where(inArray(preHeatTreatmentControls.weldJointId, rowIds))
        .for('update')

      const rows = await attachDuplicateControlRelations(
        await attachHeatTreatmentControlRelations(storedRows as WeldRow[], tx),
        tx,
      )
      const rowsById = new Map(rows.map((row) => [row.id, row]))
      const resultByPosition = new Map(data.results.map((entry) => [positionKey(entry), entry]))
      const rkExposureTable = data.action === 'result'
        ? await loadRkExposureTable(tx)
        : null
      const resolvedGroups: Array<PreHeatTreatmentLnkWorkflowGroup & { useSystemName: boolean }> = []
      for (const group of data.groups) {
        const groupRows = uniqueRows(group.positions.map((position) => rowsById.get(position.rowId)!))
        const methodCodes = [...new Set(group.positions.map((position) => position.methodCode))]
        if (data.action === 'result' && methodCodes.length !== 1) {
          throw new Error('Заключения разных видов НК до ТО должны оформляться разными документами.')
        }
        const name = group.useSystemName
          ? (await reserveSystemDocumentName(
              tx,
              getSequenceRequest(data.action, data.date, group.name, methodCodes),
              groupRows,
            )).name
          : group.name
        resolvedGroups.push({ ...group, name })
      }

      const writes = resolvedGroups.flatMap((group) => buildGroupWrites({
        action: data.action,
        date: data.date,
        group,
        rowsById,
        resultByPosition,
        rkExposureTable,
      }))
      const savedControls = await saveControlWrites(tx, data.action, writes)
      await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, rowIds)
      await syncPreHeatTreatmentDocuments({
        tx,
        action: data.action,
        groups: resolvedGroups,
        rowsById,
        controls: savedControls,
      })
      const touchedRows = await touchLnkRows(tx, rows, savedControls)
      await markDispatcherTaskIndexDirty(tx)
      return attachHeatTreatmentControlRelations(touchedRows, tx)
    })
  })

export type UpdatePreHeatTreatmentRkExposurePayload = {
  rowId: number
  lines: RkExposureLine[]
  confirmedDiameter: number | null
}

export const updatePreHeatTreatmentRkExposure = createServerFn({ method: 'POST' })
  .validator(normalizePreHeatTreatmentRkExposurePayload)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()
    return db.transaction(async (tx) => {
      await assertPreHeatTreatmentLnkEnabled(tx)
      const [storedRow] = await tx
        .select()
        .from(weldJoints)
        .where(eq(weldJoints.id, data.rowId))
        .for('update')
        .limit(1)
      if (!storedRow) throw new Error('Стык больше не существует. Обновите отчет ЛНК.')

      const [control] = await tx
        .select()
        .from(preHeatTreatmentControls)
        .where(sql`${preHeatTreatmentControls.weldJointId} = ${data.rowId} and ${preHeatTreatmentControls.method} = 'РК'`)
        .for('update')
        .limit(1)
      const result = String(control?.result ?? '').trim().toLocaleLowerCase('ru-RU')
      if (!control || !PRE_HEAT_TREATMENT_RESULT_OPTIONS.includes(result as never)) {
        throw new Error('Сначала внесите действующий результат РК до ТО.')
      }

      await tx
        .update(preHeatTreatmentControls)
        .set({
          defectDescription: serializeRkExposureLines(data.lines),
          rkExposureConfirmedDiameter: data.confirmedDiameter,
          updatedAt: new Date(),
        })
        .where(eq(preHeatTreatmentControls.id, control.id))
      const now = new Date()
      const [savedRow] = await tx
        .update(weldJoints)
        .set({ lnkUpdatedAt: now, updatedAt: now })
        .where(eq(weldJoints.id, data.rowId))
        .returning()
      await markDispatcherTaskIndexDirty(tx)
      const controls = (await tx
        .select()
        .from(preHeatTreatmentControls)
        .where(eq(preHeatTreatmentControls.weldJointId, data.rowId))) as PreHeatTreatmentControlRecord[]
      return mergePreHeatTreatmentControlsIntoRows(
        [{ ...savedRow, preHeatTreatmentControls: controls } as WeldRow],
        controls,
      )[0]
    })
  })

export type CorrectPreHeatTreatmentLnkResultPayload = {
  relationId: number
  stage?: 'request' | 'result'
  action: 'update' | 'delete'
  requestDate?: string
  requestName?: string
  result?: string
  conclusionDate?: string
  conclusionName?: string
}

export const correctPreHeatTreatmentLnkResult = createServerFn({ method: 'POST' })
  .validator(normalizePreHeatTreatmentLnkResultCorrectionPayload)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()
    return db.transaction(async (tx) => {
      await assertPreHeatTreatmentLnkEnabled(tx)
      const [storedControl] = await tx
        .select()
        .from(preHeatTreatmentControls)
        .where(eq(preHeatTreatmentControls.id, data.relationId))
        .for('update')
        .limit(1)
      if (!storedControl) throw new Error('Позиция НК до ТО больше не существует. Обновите отчет.')
      const [storedRow] = await tx
        .select()
        .from(weldJoints)
        .where(eq(weldJoints.id, storedControl.weldJointId))
        .for('update')
        .limit(1)
      if (!storedRow) throw new Error('Стык больше не существует. Обновите отчет.')

      const [row] = await attachDuplicateControlRelations(
        await attachHeatTreatmentControlRelations([storedRow as WeldRow], tx),
        tx,
      )
      const currentControl = row.preHeatTreatmentControls?.find((control) => control.id === storedControl.id)
      if (!currentControl) throw new Error('Позиция НК до ТО изменилась. Обновите отчет.')

      await removeSourcedSystemDocumentPositionsInTransaction({
        tx,
        sourceKind: 'beforeHeatTreatment',
        relationIds: [currentControl.id],
      })

      if (data.stage === 'request' && data.action === 'delete') {
        const blockReason = getPreHeatTreatmentRequestRemovalBlockReason(row, currentControl)
        if (blockReason) throw new Error(blockReason)
        await tx
          .delete(preHeatTreatmentControls)
          .where(eq(preHeatTreatmentControls.id, currentControl.id))
        await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, [row.id])
        const [updatedRow] = await touchLnkRows(tx, [row], [], [currentControl.id])
        await markDispatcherTaskIndexDirty(tx)
        return (await attachDuplicateControlRelations(
          await attachHeatTreatmentControlRelations([updatedRow], tx),
          tx,
        ))[0]
      }

      let nextControl: PreHeatTreatmentControlWrite
      if (data.stage === 'request') {
        nextControl = buildPreHeatTreatmentRequestCorrectionWrite({
          row,
          control: currentControl,
          requestDate: data.requestDate,
          requestName: data.requestName,
        })
      } else if (data.action === 'delete') {
        const blockReason = getPreHeatTreatmentResultRemovalBlockReason(row, currentControl)
        if (blockReason) throw new Error(blockReason)
        nextControl = {
          ...currentControl,
          result: currentControl.requestName ? 'ожидает НК' : null,
          conclusionDate: null,
          conclusionName: null,
          defectDescription: null,
          rkExposureConfirmedDiameter: null,
        }
      } else {
        nextControl = buildPreHeatTreatmentResultCorrectionWrite({
          row,
          control: currentControl,
          controlDate: data.conclusionDate,
          result: data.result,
          conclusionName: data.conclusionName,
          rkExposureTable: await loadRkExposureTable(tx),
        })
      }

      const [savedControl] = await tx
        .update(preHeatTreatmentControls)
        .set({ ...toControlInsert(nextControl), updatedAt: new Date() })
        .where(eq(preHeatTreatmentControls.id, currentControl.id))
        .returning()
      await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, [row.id])

      const position = {
        rowId: row.id,
        methodCode: normalizeMethodCode(savedControl.method) as PreHeatTreatmentLnkMethodCode,
      }
      if (savedControl.requestName) {
        await syncPreHeatTreatmentDocuments({
          tx,
          action: 'request',
          groups: [{ positions: [position], name: savedControl.requestName, useSystemName: false }],
          rowsById: new Map([[row.id, row]]),
          controls: [savedControl],
        })
      }
      if (savedControl.conclusionName) {
        await syncPreHeatTreatmentDocuments({
          tx,
          action: 'result',
          groups: [{ positions: [position], name: savedControl.conclusionName, useSystemName: false }],
          rowsById: new Map([[row.id, row]]),
          controls: [savedControl],
        })
      }

      const [updatedRow] = await touchLnkRows(tx, [row], [savedControl])
      await markDispatcherTaskIndexDirty(tx)
      return (await attachDuplicateControlRelations(
        await attachHeatTreatmentControlRelations([updatedRow], tx),
        tx,
      ))[0]
    })
  })

export function normalizePreHeatTreatmentLnkResultCorrectionPayload(
  value: CorrectPreHeatTreatmentLnkResultPayload,
) {
  const relationId = Math.floor(Number(value?.relationId))
  if (relationId <= 0) throw new Error('Не указан результат НК до ТО.')
  const action = value?.action
  if (action !== 'update' && action !== 'delete') throw new Error('Неизвестное изменение НК до ТО.')
  const stage = value?.stage ?? 'result'
  if (stage !== 'request' && stage !== 'result') throw new Error('Неизвестный этап НК до ТО.')
  return {
    relationId,
    stage,
    action,
    requestDate: String(value?.requestDate ?? '').trim(),
    requestName: String(value?.requestName ?? '').trim(),
    result: String(value?.result ?? '').trim(),
    conclusionDate: String(value?.conclusionDate ?? '').trim(),
    conclusionName: String(value?.conclusionName ?? '').trim(),
  }
}

export function normalizePreHeatTreatmentRkExposurePayload(
  value: UpdatePreHeatTreatmentRkExposurePayload,
): UpdatePreHeatTreatmentRkExposurePayload {
  const rowId = Math.floor(Number(value?.rowId))
  if (rowId <= 0) throw new Error('Не указан стык для РК до ТО.')
  const lines = (Array.isArray(value?.lines) ? value.lines : []).map((line) => ({
    coordinate: String(line?.coordinate ?? '').trim(),
    description: String(line?.description ?? '').trim(),
  })).filter((line) => line.coordinate)
  if (lines.length === 0) throw new Error('Добавьте хотя бы один снимок или диапазон координат.')
  if (new Set(lines.map((line) => line.coordinate)).size !== lines.length) {
    throw new Error('Снимки и диапазоны координат не должны повторяться.')
  }
  return {
    rowId,
    lines,
    confirmedDiameter: normalizeNullableNumber(value?.confirmedDiameter),
  }
}

export function normalizePreHeatTreatmentLnkWorkflowPayload(
  value: PreHeatTreatmentLnkWorkflowPayload,
): NormalizedPayload {
  return normalizePayload(value)
}

function normalizePayload(value: PreHeatTreatmentLnkWorkflowPayload): NormalizedPayload {
  const action = value?.action
  if (action !== 'request' && action !== 'result') {
    throw new Error('Неизвестное действие НК до ТО.')
  }
  const date = String(value?.date ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Укажите дату документа НК до ТО.')

  const groups = (Array.isArray(value?.groups) ? value.groups : []).map((group) => ({
    positions: normalizePositions(group?.positions),
    name: String(group?.name ?? '').trim(),
    useSystemName: Boolean(group?.useSystemName),
  })).filter((group) => group.positions.length > 0)
  if (groups.length === 0) throw new Error('Выберите хотя бы одну позицию НК до ТО.')
  if (groups.some((group) => !group.name)) throw new Error('Укажите наименование документа НК до ТО.')

  const assigned = new Set<string>()
  for (const group of groups) {
    for (const position of group.positions) {
      const key = positionKey(position)
      if (assigned.has(key)) {
        throw new Error('Одну позицию НК до ТО нельзя включить в несколько документов одновременно.')
      }
      assigned.add(key)
    }
  }

  const resultsByPosition = new Map<string, PreHeatTreatmentLnkResultEntry>()
  for (const entry of Array.isArray(value?.results) ? value.results : []) {
    const positions = normalizePositions([entry])
    const position = positions[0]
    if (!position) continue
    const key = positionKey(position)
    if (!assigned.has(key)) continue
    if (resultsByPosition.has(key)) {
      throw new Error('Результат одной позиции НК до ТО указан несколько раз.')
    }
    const diameter = normalizeNullableNumber(entry.rkExposureConfirmedDiameter)
    resultsByPosition.set(key, {
      ...position,
      result: String(entry.result ?? '').trim(),
      defectDescription: String(entry.defectDescription ?? '').trim(),
      rkExposureConfirmedDiameter: diameter,
    })
  }
  const results = [...resultsByPosition.values()]
  if (action === 'result' && results.length !== assigned.size) {
    throw new Error('Укажите результат для каждой выбранной позиции НК до ТО.')
  }
  return { action, date, groups, results }
}

function normalizePositions(value: unknown): PreHeatTreatmentLnkPosition[] {
  if (!Array.isArray(value)) return []
  const unique = new Map<string, PreHeatTreatmentLnkPosition>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const record = candidate as Partial<PreHeatTreatmentLnkPosition>
    const rowId = Math.floor(Number(record.rowId))
    const methodCode = normalizeMethodCode(record.methodCode)
    if (rowId <= 0 || !isPreMethod(methodCode)) continue
    const position = { rowId, methodCode }
    unique.set(positionKey(position), position)
  }
  return [...unique.values()]
}

function buildGroupWrites({
  action,
  date,
  group,
  rowsById,
  resultByPosition,
  rkExposureTable,
}: {
  action: PreHeatTreatmentLnkWorkflowAction
  date: string
  group: PreHeatTreatmentLnkWorkflowGroup
  rowsById: ReadonlyMap<number, WeldRow>
  resultByPosition: ReadonlyMap<string, PreHeatTreatmentLnkResultEntry>
  rkExposureTable: RkExposureTableSettings | null
}) {
  if (action === 'request') {
    const positionsByRowId = new Map<number, PreHeatTreatmentLnkMethodCode[]>()
    for (const position of group.positions) {
      const current = positionsByRowId.get(position.rowId) ?? []
      current.push(position.methodCode)
      positionsByRowId.set(position.rowId, current)
    }
    return [...positionsByRowId].flatMap(([rowId, methodCodes]) =>
      buildPreHeatTreatmentRequestWrites({
        row: rowsById.get(rowId)!,
        methodCodes,
        requestName: group.name,
        requestDate: date,
      }),
    )
  }

  return group.positions.map((position) => {
    const result = resultByPosition.get(positionKey(position))!
    return buildPreHeatTreatmentResultWrite({
      row: rowsById.get(position.rowId)!,
      methodCode: position.methodCode,
      controlDate: date,
      result: result.result,
      conclusionName: group.name,
      defectDescription: result.defectDescription,
      rkExposureConfirmedDiameter: result.rkExposureConfirmedDiameter,
      rkExposureTable,
    })
  })
}

async function loadRkExposureTable(tx: SystemDocumentSequenceTransaction) {
  const [storedSettings] = await tx
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PROJECT_SETTING_KEYS.other))
    .limit(1)
  if (!storedSettings) return DEFAULT_OTHER_SETTINGS.rkExposureTable

  try {
    return normalizeOtherSettings(JSON.parse(storedSettings.value)).rkExposureTable
  } catch {
    return DEFAULT_OTHER_SETTINGS.rkExposureTable
  }
}

async function assertPreHeatTreatmentLnkEnabled(tx: SystemDocumentSequenceTransaction) {
  const settings = await loadControlProcessSettingsFromTransaction(tx)
  if (!settings.preHeatTreatmentLnkEnabled) {
    throw new Error('НК до ТО выключен в настройках проекта. Существующая история доступна только для просмотра.')
  }
}

function normalizeNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const normalized = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(normalized)) {
    throw new Error('Подтвержденный диаметр РК должен быть числом.')
  }
  return normalized
}

async function saveControlWrites(
  tx: SystemDocumentSequenceTransaction,
  action: PreHeatTreatmentLnkWorkflowAction,
  writes: PreHeatTreatmentControlWrite[],
) {
  const saved: PreHeatTreatmentControlRecord[] = []
  for (const write of writes) {
    if (action === 'request') {
      const [record] = await tx
        .insert(preHeatTreatmentControls)
        .values(toControlInsert(write))
        .onConflictDoUpdate({
          target: [preHeatTreatmentControls.weldJointId, preHeatTreatmentControls.method],
          set: {
            requestName: textOrNull(write.requestName),
            requestDate: textOrNull(write.requestDate),
            result: textOrNull(write.result),
            updatedAt: new Date(),
          },
        })
        .returning()
      saved.push(record)
      continue
    }

    if (!write.id) throw new Error('Позиция НК до ТО больше не существует. Обновите отчет ЛНК.')
    const [record] = await tx
      .update(preHeatTreatmentControls)
      .set({ ...toControlInsert(write), updatedAt: new Date() })
      .where(eq(preHeatTreatmentControls.id, write.id))
      .returning()
    if (!record) throw new Error('Позиция НК до ТО уже изменена. Обновите отчет ЛНК.')
    saved.push(record)
  }
  return saved
}

function toControlInsert(write: PreHeatTreatmentControlWrite): NewPreHeatTreatmentControl {
  return {
    weldJointId: write.weldJointId,
    method: write.method,
    requestName: textOrNull(write.requestName),
    requestDate: textOrNull(write.requestDate),
    result: textOrNull(write.result),
    conclusionDate: textOrNull(write.conclusionDate),
    conclusionName: textOrNull(write.conclusionName),
    defectDescription: textOrNull(write.defectDescription),
    rkExposureConfirmedDiameter: write.rkExposureConfirmedDiameter ?? null,
  }
}

async function syncPreHeatTreatmentDocuments({
  tx,
  action,
  groups,
  rowsById,
  controls,
}: {
  tx: SystemDocumentSequenceTransaction
  action: PreHeatTreatmentLnkWorkflowAction
  groups: PreHeatTreatmentLnkWorkflowGroup[]
  rowsById: ReadonlyMap<number, WeldRow>
  controls: PreHeatTreatmentControlRecord[]
}) {
  const controlByPosition = new Map(controls.map((control) => [
    positionKey({ rowId: control.weldJointId, methodCode: normalizeMethodCode(control.method) as PreHeatTreatmentLnkMethodCode }),
    control,
  ]))
  const type: SystemDocumentType = action === 'request' ? 'lnkRequest' : 'lnkConclusion'

  for (const group of groups) {
    const groupControls = group.positions.map((position) => controlByPosition.get(positionKey(position))!)
    const controlsByRowId = new Map<number, PreHeatTreatmentControlRecord[]>()
    for (const control of groupControls) {
      const current = controlsByRowId.get(control.weldJointId) ?? []
      current.push(control)
      controlsByRowId.set(control.weldJointId, current)
    }
    const virtualRows = [...controlsByRowId].map(([rowId, rowControls]) =>
      buildPreHeatTreatmentSystemDocumentRow(rowsById.get(rowId)!, rowControls),
    )
    const summaries = buildSystemDocumentSummaries(virtualRows, type)
      .filter((summary) => summary.title === group.name)
    if (summaries.length === 0) {
      throw new Error(`Не удалось сформировать индекс документа «${group.name}».`)
    }
    for (const summary of summaries) {
      await upsertSourcedSystemDocumentInTransaction({
        tx,
        summary: { ...summary, sourceKind: 'beforeHeatTreatment' },
        sourcePositions: groupControls
          .filter((control) => action === 'request' || control.method === summary.methodCode)
          .map((control) => ({
            kind: 'beforeHeatTreatment' as const,
            weldJointId: control.weldJointId,
            relationId: control.id,
            methodCode: control.method,
          })),
      })
    }
  }
}

async function touchLnkRows(
  tx: SystemDocumentSequenceTransaction,
  rows: WeldRow[],
  controls: PreHeatTreatmentControlRecord[],
  removedControlIds: number[] = [],
) {
  const removedIds = new Set(removedControlIds)
  const changedByRowId = new Map<number, PreHeatTreatmentControlRecord[]>()
  for (const control of controls) {
    const current = changedByRowId.get(control.weldJointId) ?? []
    current.push(control)
    changedByRowId.set(control.weldJointId, current)
  }
  const now = new Date()
  const updatedRows: WeldRow[] = []
  for (const row of rows) {
    const changed = changedByRowId.get(row.id)
    const hasRemovedControl = (row.preHeatTreatmentControls ?? []).some((control) => removedIds.has(control.id))
    if (!changed && !hasRemovedControl) continue
    const relations = [
      ...(row.preHeatTreatmentControls ?? []).filter((control) =>
        !removedIds.has(control.id) && !changed?.some((next) => next.method === control.method),
      ),
      ...(changed ?? []),
    ]
    const [nextRow] = mergePreHeatTreatmentControlsIntoRows([row], relations)
    const [updated] = await tx
      .update(weldJoints)
      .set({
        finalStatus: calculateFinalStatus(nextRow),
        lnkCreatedAt: sql`coalesce(${weldJoints.lnkCreatedAt}, ${now})`,
        lnkUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(weldJoints.id, row.id))
      .returning()
    updatedRows.push({ ...updated, preHeatTreatmentControls: relations } as WeldRow)
  }
  return updatedRows
}

function getSequenceRequest(
  action: PreHeatTreatmentLnkWorkflowAction,
  date: string,
  provisionalName: string,
  methodCodes: PreHeatTreatmentLnkMethodCode[],
): SystemDocumentSequenceUpdate {
  if (action === 'request') {
    return {
      type: 'lnkRequest',
      date,
      provisionalName,
      fieldKeys: methodCodes.map((code) => getPreMethod(code).requestKey),
    }
  }
  const methodCode = methodCodes[0]!
  return {
    type: 'lnkConclusion',
    date,
    provisionalName,
    methodCode,
    fieldKeys: [getPreMethod(methodCode).conclusionKey],
  }
}

function getPreMethod(methodCode: PreHeatTreatmentLnkMethodCode) {
  const method = PRE_HEAT_TREATMENT_LNK_METHODS.find((candidate) => candidate.code === methodCode)!
  const fieldKeys: Record<PreHeatTreatmentLnkMethodCode, { requestKey: WeldFieldKey; conclusionKey: WeldFieldKey }> = {
    ВИК: { requestKey: 'vikRequest', conclusionKey: 'vikConclusion' },
    РК: { requestKey: 'rkRequest', conclusionKey: 'rkConclusion' },
    УЗК: { requestKey: 'uzkRequest', conclusionKey: 'uzkConclusion' },
    ПВК: { requestKey: 'pvkRequest', conclusionKey: 'pvkConclusion' },
  }
  return { ...method, ...fieldKeys[methodCode] }
}

function positionKey(position: { rowId: number; methodCode: string }) {
  return `${position.rowId}:${normalizeMethodCode(position.methodCode)}`
}

function normalizeMethodCode(value: unknown) {
  return String(value ?? '').trim().toLocaleUpperCase('ru-RU')
}

function isPreMethod(value: string): value is PreHeatTreatmentLnkMethodCode {
  return PRE_HEAT_TREATMENT_LNK_METHODS.some((method) => method.code === value)
}

function uniqueRows(rows: WeldRow[]) {
  return [...new Map(rows.map((row) => [row.id, row])).values()]
}

function textOrNull(value: unknown) {
  const valueText = String(value ?? '').trim()
  return valueText || null
}
