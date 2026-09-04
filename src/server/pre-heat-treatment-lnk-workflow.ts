import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm'

import { requireDb } from '@/db'
import {
  preHeatTreatmentControls,
  weldJoints,
  type NewPreHeatTreatmentControl,
  type NewWeldJoint,
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
  type RkExposureTableSettings,
} from '@/lib/other-settings'
import { serializeRkExposureLines, type RkExposureLine } from '@/lib/rk-exposure'
import type { SaveCheckSettings } from '@/lib/save-check-settings'
import type { SystemIndexSettings } from '@/lib/system-index-settings'
import { calculateFinalStatus } from '@/lib/weld-status'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import { getSystemDocumentTemplateId } from '@/lib/system-document-template-types'
import {
  getDispatcherDirtyScopes,
  markDispatcherTaskIndexDirty,
} from '@/server/dispatcher-task-index-dirty'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { assertStoredEarlyCoilDecisionSourcesRemainValid } from '@/server/early-coil-decision-guard'
import {
  haveSameWeldLineMemberships,
  lockWeldLineMembershipsForWeldIds,
} from '@/server/weld-line-membership-lock'
import { assertPstoWorkflowLinesFullyAssigned } from '@/server/psto-workflow-line-guard'
import { assertSecurityScope } from '@/server/security-functions'
import { WELD_TABLE_COLUMNS, WELD_TABLE_RETURNING } from '@/server/weld-server-shared'
import {
  assertExpectedInteractiveWeldVersions,
  lockInteractiveWeldRows,
} from '@/server/weld-row-version'
import { splitNumberBatches } from '@/server/weld-request-utils'
import {
  removeSourcedSystemDocumentPositionsInTransaction,
  upsertSourcedSystemDocumentsInTransaction,
} from '@/server/system-document-index'
import {
  lockSystemDocumentNumberCounter,
  reserveSystemDocumentNames,
  type SystemDocumentSequenceTransaction,
  type SystemDocumentSequenceUpdate,
} from '@/server/system-document-sequences'
import { loadWeldWorkflowSettingsFromTransaction } from '@/server/weld-workflow-settings'

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
  expectedVersions: WeldRowVersionTarget[]
}

type NormalizedPayload = {
  action: PreHeatTreatmentLnkWorkflowAction
  date: string
  groups: Array<PreHeatTreatmentLnkWorkflowGroup & { useSystemName: boolean }>
  results: PreHeatTreatmentLnkResultEntry[]
  expectedVersions: WeldRowVersionTarget[]
}

export const savePreHeatTreatmentLnkWorkflow = createServerFn({ method: 'POST' })
  .validator(normalizePayload)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()
    return db.transaction(async (tx) => {
      await assertPreHeatTreatmentLnkEnabled(tx)
      const workflowSettings = await loadWeldWorkflowSettingsFromTransaction(tx)
      const rowIds = [...new Set(data.groups.flatMap((group) =>
        group.positions.map((position) => position.rowId),
      ))]
      const sequenceRequests = data.groups.map((group) => {
        const methodCodes = [...new Set(group.positions.map((position) => position.methodCode))]
        if (data.action === 'result' && methodCodes.length !== 1) {
          throw new Error('Заключения разных видов НК до ТО должны оформляться разными документами.')
        }
        return group.useSystemName
          ? getSequenceRequest(data.action, data.date, group.name, methodCodes)
          : null
      })
      const sequenceIds = [...new Set(sequenceRequests
        .filter((request): request is SystemDocumentSequenceUpdate => Boolean(request))
        .map(getSystemDocumentTemplateId))]
        .sort()
      for (const sequenceId of sequenceIds) {
        await lockSystemDocumentNumberCounter(tx, sequenceId)
      }
      const lineMembershipSnapshot = await lockWeldLineMembershipsForWeldIds(tx, rowIds)
      if (lineMembershipSnapshot.length !== rowIds.length) {
        throw new Error('Один или несколько выбранных стыков больше не существуют. Обновите отчет ЛНК.')
      }
      const storedRows = await lockInteractiveWeldRows(tx, rowIds)
      if (storedRows.length !== rowIds.length) {
        throw new Error('Один или несколько выбранных стыков больше не существуют. Обновите отчет ЛНК.')
      }
      if (!haveSameWeldLineMemberships(lineMembershipSnapshot, storedRows)) {
        throw new Error('Один или несколько выбранных стыков уже перенесены на другую линию. Обновите отчет ЛНК.')
      }
      assertExpectedInteractiveWeldVersions(rowIds, data.expectedVersions, storedRows)
      await assertPstoWorkflowLinesFullyAssigned(tx, storedRows, { allowPerformedHistoryRows: true })
      for (const rowIdBatch of splitNumberBatches([...rowIds].sort((left, right) => left - right), 1000)) {
        await tx
          .select({ id: preHeatTreatmentControls.id })
          .from(preHeatTreatmentControls)
          .where(inArray(preHeatTreatmentControls.weldJointId, rowIdBatch))
          .orderBy(asc(preHeatTreatmentControls.id))
          .for('update')
      }

      const rows = await attachDuplicateControlRelations(
        await attachHeatTreatmentControlRelations(storedRows as WeldRow[], tx),
        tx,
      )
      const rowsById = new Map(rows.map((row) => [row.id, row]))
      const resultByPosition = new Map(data.results.map((entry) => [positionKey(entry), entry]))
      const rkExposureTable = data.action === 'result'
        ? workflowSettings.otherSettings.rkExposureTable
        : null
      const systemNameGroups = data.groups.flatMap((group, index) => {
        const request = sequenceRequests[index]
        return request
          ? [{
              index,
              request,
              rows: uniqueRows(group.positions.map((position) => rowsById.get(position.rowId)!)),
            }]
          : []
      })
      const reservations = await reserveSystemDocumentNames(
        tx,
        systemNameGroups,
        { countersAlreadyLocked: true },
      )
      const systemNameByGroupIndex = new Map(
        systemNameGroups.map((group, index) => [group.index, reservations[index]!.name]),
      )
      const resolvedGroups = data.groups.map((group, index) => ({
        ...group,
        name: systemNameByGroupIndex.get(index) ?? group.name,
      }))
      const writes = resolvedGroups.flatMap((group) => buildGroupWrites({
        action: data.action,
        date: data.date,
        group,
        rowsById,
        resultByPosition,
        rkExposureTable,
        saveCheckSettings: workflowSettings.saveCheckSettings,
        systemIndexSettings: workflowSettings.systemIndexSettings,
      }))
      const savedControls = await savePreHeatTreatmentControlWrites(tx, data.action, writes)
      await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, rowIds)
      await syncPreHeatTreatmentDocuments({
        tx,
        action: data.action,
        groups: resolvedGroups,
        rowsById,
        controls: savedControls,
      })
      const touchedRows = await touchLnkRows(tx, rows, savedControls)
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes(touchedRows, new Map()),
      })
      return attachHeatTreatmentControlRelations(touchedRows, tx)
    })
  })

export type UpdatePreHeatTreatmentRkExposurePayload = {
  rowId: number
  expectedVersion: string
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
        .select(WELD_TABLE_RETURNING)
        .from(weldJoints)
        .where(eq(weldJoints.id, data.rowId))
        .for('update')
        .limit(1)
      if (!storedRow) throw new Error('Стык больше не существует. Обновите отчет ЛНК.')
      assertExpectedInteractiveWeldVersions(
        [data.rowId],
        [{ id: data.rowId, version: data.expectedVersion }],
        [storedRow],
      )

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
        .returning(WELD_TABLE_RETURNING)
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes([savedRow], new Map()),
      })
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
  expectedVersion: string
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
      const workflowSettings = await loadWeldWorkflowSettingsFromTransaction(tx)
      const [controlReference] = await tx
        .select({ weldJointId: preHeatTreatmentControls.weldJointId })
        .from(preHeatTreatmentControls)
        .where(eq(preHeatTreatmentControls.id, data.relationId))
        .limit(1)
      if (!controlReference) throw new Error('Позиция НК до ТО больше не существует. Обновите отчет.')
      const [storedRow] = await tx
        .select(WELD_TABLE_RETURNING)
        .from(weldJoints)
        .where(eq(weldJoints.id, controlReference.weldJointId))
        .for('update')
        .limit(1)
      if (!storedRow) throw new Error('Стык больше не существует. Обновите отчет.')
      assertExpectedInteractiveWeldVersions(
        [storedRow.id],
        [{ id: storedRow.id, version: data.expectedVersion }],
        [storedRow],
      )
      const [storedControl] = await tx
        .select()
        .from(preHeatTreatmentControls)
        .where(and(
          eq(preHeatTreatmentControls.id, data.relationId),
          eq(preHeatTreatmentControls.weldJointId, storedRow.id),
        ))
        .for('update')
        .limit(1)
      if (!storedControl) throw new Error('Позиция НК до ТО больше не существует. Обновите отчет.')

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
        await markDispatcherTaskIndexDirty(tx, {
          scopes: getDispatcherDirtyScopes([updatedRow], new Map()),
        })
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
          saveCheckSettings: workflowSettings.saveCheckSettings,
        })
      } else if (data.action === 'delete') {
        const blockReason = getPreHeatTreatmentResultRemovalBlockReason(
          row,
          currentControl,
          workflowSettings.saveCheckSettings,
        )
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
          rkExposureTable: workflowSettings.otherSettings.rkExposureTable,
          saveCheckSettings: workflowSettings.saveCheckSettings,
          systemIndexSettings: workflowSettings.systemIndexSettings,
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
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes([updatedRow], new Map()),
      })
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
    expectedVersion: String(value?.expectedVersion ?? '').trim(),
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
    expectedVersion: String(value?.expectedVersion ?? '').trim(),
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
  const rawDate = String(value?.date ?? '').trim()
  const date = action === 'result' ? rawDate : rawDate.slice(0, 10)
  if (action === 'request' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Укажите дату документа НК до ТО.')
  }

  const groups = (Array.isArray(value?.groups) ? value.groups : []).map((group) => ({
    positions: normalizePositions(group?.positions),
    name: String(group?.name ?? '').trim(),
    useSystemName: Boolean(group?.useSystemName),
  })).filter((group) => group.positions.length > 0)
  if (groups.length === 0) throw new Error('Выберите хотя бы одну позицию НК до ТО.')
  if (action === 'request' && groups.some((group) => !group.name)) {
    throw new Error('Укажите наименование документа НК до ТО.')
  }

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
  const expectedVersions = (Array.isArray(value?.expectedVersions) ? value.expectedVersions : []).map((entry) => ({
    id: Number(entry?.id),
    version: String(entry?.version ?? '').trim(),
  }))
  return { action, date, groups, results, expectedVersions }
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
  saveCheckSettings,
  systemIndexSettings,
}: {
  action: PreHeatTreatmentLnkWorkflowAction
  date: string
  group: PreHeatTreatmentLnkWorkflowGroup
  rowsById: ReadonlyMap<number, WeldRow>
  resultByPosition: ReadonlyMap<string, PreHeatTreatmentLnkResultEntry>
  rkExposureTable: RkExposureTableSettings | null
  saveCheckSettings: SaveCheckSettings
  systemIndexSettings: SystemIndexSettings
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
        saveCheckSettings,
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
      saveCheckSettings,
      systemIndexSettings,
    })
  })
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

const PRE_HEAT_TREATMENT_WRITE_BATCH_SIZE = 500

const PRE_HEAT_TREATMENT_REQUEST_UPDATE_FIELDS = [
  'requestName',
  'requestDate',
  'result',
  'defectDescription',
  'updatedAt',
] as const satisfies readonly (keyof NewPreHeatTreatmentControl)[]

const PRE_HEAT_TREATMENT_RESULT_UPDATE_FIELDS = [
  'requestName',
  'requestDate',
  'result',
  'conclusionDate',
  'conclusionName',
  'defectDescription',
  'rkExposureConfirmedDiameter',
  'updatedAt',
] as const satisfies readonly (keyof NewPreHeatTreatmentControl)[]

const PRE_HEAT_TREATMENT_CONTROL_COLUMN_NAMES: Record<
  (typeof PRE_HEAT_TREATMENT_RESULT_UPDATE_FIELDS)[number],
  string
> = {
  requestName: 'request_name',
  requestDate: 'request_date',
  result: 'result',
  conclusionDate: 'conclusion_date',
  conclusionName: 'conclusion_name',
  defectDescription: 'defect_description',
  rkExposureConfirmedDiameter: 'rk_exposure_confirmed_diameter',
  updatedAt: 'updated_at',
}

function getPreHeatTreatmentControlUpdateSet(
  fields: readonly (keyof NewPreHeatTreatmentControl)[],
) {
  return Object.fromEntries(fields.map((field) => [
    field,
    sql.raw(`excluded."${PRE_HEAT_TREATMENT_CONTROL_COLUMN_NAMES[field as keyof typeof PRE_HEAT_TREATMENT_CONTROL_COLUMN_NAMES]}"`),
  ]))
}

export async function savePreHeatTreatmentControlWrites(
  tx: SystemDocumentSequenceTransaction,
  action: PreHeatTreatmentLnkWorkflowAction,
  writes: PreHeatTreatmentControlWrite[],
) {
  if (action === 'result' && writes.some((write) => !write.id)) {
    throw new Error('Позиция НК до ТО больше не существует. Обновите отчет ЛНК.')
  }

  const saved: PreHeatTreatmentControlRecord[] = []
  const now = new Date()
  const updateFields = action === 'request'
    ? PRE_HEAT_TREATMENT_REQUEST_UPDATE_FIELDS
    : PRE_HEAT_TREATMENT_RESULT_UPDATE_FIELDS
  for (const batch of splitPreHeatTreatmentWriteBatches(writes)) {
    const records = await tx
      .insert(preHeatTreatmentControls)
      .values(batch.map((write) => ({ ...toControlInsert(write), updatedAt: now })))
      .onConflictDoUpdate({
        target: [preHeatTreatmentControls.weldJointId, preHeatTreatmentControls.method],
        set: getPreHeatTreatmentControlUpdateSet(updateFields),
      })
      .returning()
    if (records.length !== batch.length) {
      throw new Error('Не удалось сохранить все позиции НК до ТО. Ничего не сохранено.')
    }
    saved.push(...records)
  }

  const savedByPosition = new Map(saved.map((record) => [
    positionKey({
      rowId: record.weldJointId,
      methodCode: normalizeMethodCode(record.method) as PreHeatTreatmentLnkMethodCode,
    }),
    record,
  ]))
  return writes.map((write) => {
    const record = savedByPosition.get(positionKey({
      rowId: write.weldJointId,
      methodCode: normalizeMethodCode(write.method) as PreHeatTreatmentLnkMethodCode,
    }))
    if (!record) throw new Error('Позиция НК до ТО уже изменена. Обновите отчет ЛНК.')
    if (action === 'result' && record.id !== write.id) {
      throw new Error('Позиция НК до ТО уже изменена. Обновите отчет ЛНК.')
    }
    return record
  })
}

export function splitPreHeatTreatmentWriteBatches<T>(records: readonly T[]) {
  const batches: T[][] = []
  for (let start = 0; start < records.length; start += PRE_HEAT_TREATMENT_WRITE_BATCH_SIZE) {
    batches.push(records.slice(start, start + PRE_HEAT_TREATMENT_WRITE_BATCH_SIZE))
  }
  return batches
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
  const documents = [] as Parameters<typeof upsertSourcedSystemDocumentsInTransaction>[0]['documents'][number][]

  for (const group of groups) {
    if (!group.name.trim()) continue
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
      documents.push({
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
  await upsertSourcedSystemDocumentsInTransaction({ tx, documents })
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
  const nextRows: WeldRow[] = []
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
    nextRows.push({ ...nextRow, preHeatTreatmentControls: relations } as WeldRow)
  }
  return persistPreHeatTreatmentTouchedRows(tx, nextRows)
}

const PRE_HEAT_TREATMENT_WELD_UPDATE_FIELDS = [
  'finalStatus',
  'lnkCreatedAt',
  'lnkUpdatedAt',
  'updatedAt',
] as const satisfies readonly (keyof NewWeldJoint)[]

const PRE_HEAT_TREATMENT_WELD_UPDATE_SET = Object.fromEntries(
  PRE_HEAT_TREATMENT_WELD_UPDATE_FIELDS.map((field) => [
    field,
    sql.raw(`excluded."${WELD_TABLE_COLUMNS[field].name}"`),
  ]),
) as Partial<Record<keyof NewWeldJoint, SQL>>

export async function persistPreHeatTreatmentTouchedRows(
  tx: SystemDocumentSequenceTransaction,
  rows: WeldRow[],
  now = new Date(),
) {
  if (rows.length === 0) return []
  const payloads = rows.map((row) => ({
    id: row.id,
    finalStatus: textOrNull(calculateFinalStatus(row)),
    lnkCreatedAt: timestampOrNull(row.lnkCreatedAt) ?? now,
    lnkUpdatedAt: now,
    updatedAt: now,
  })) satisfies NewWeldJoint[]
  const savedRows: WeldRow[] = []
  for (const batch of splitPreHeatTreatmentWriteBatches(payloads)) {
    const saved = await tx
      .insert(weldJoints)
      .values(batch)
      .onConflictDoUpdate({
        target: weldJoints.id,
        set: PRE_HEAT_TREATMENT_WELD_UPDATE_SET,
      })
      .returning(WELD_TABLE_RETURNING)
    if (saved.length !== batch.length) {
      throw new Error('Не удалось обновить все стыки НК до ТО. Ничего не сохранено.')
    }
    savedRows.push(...saved as WeldRow[])
  }
  const savedRowsById = new Map(savedRows.map((row) => [row.id, row]))
  return rows.map((row) => {
    const saved = savedRowsById.get(row.id)
    if (!saved) throw new Error(`Стык #${row.id} больше не существует. Обновите отчет ЛНК.`)
    return {
      ...saved,
      preHeatTreatmentControls: row.preHeatTreatmentControls ?? [],
      duplicateControls: row.duplicateControls ?? [],
      pstoRepeatCycles: row.pstoRepeatCycles ?? [],
    } as WeldRow
  })
}

function timestampOrNull(value: unknown) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
  const text = String(value ?? '').trim()
  if (!text) return null
  const timestamp = new Date(text)
  return Number.isFinite(timestamp.getTime()) ? timestamp : null
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
