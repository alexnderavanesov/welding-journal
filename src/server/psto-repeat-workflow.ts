import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'

import { requireDb } from '@/db'
import { pstoRepeatCycles, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  buildRepeatPstoRequestCycle,
  buildRepeatPstoResultCycle,
  buildRepeatTvmtRequestCycle,
  buildRepeatTvmtResultCycle,
} from '@/lib/psto-repeat-cycle-updates'
import type { PstoCycleSnapshot } from '@/lib/psto-cycle'
import {
  applyPstoCycleCorrection,
  applyPstoTvmtCorrectionWithLaterCycleRemoval,
  PSTO_CYCLE_STAGES,
  type PstoCycleCorrectionInput,
  type PstoCycleStage,
  type PstoTvmtCorrectionWithLaterCycleRemovalInput,
} from '@/lib/psto-cycle-corrections'
import {
  buildPstoRequestRows,
  buildPstoResultRows,
} from '@/lib/psto-report-mutation-updates'
import { buildSystemDocumentSummaries, type SystemDocumentType } from '@/lib/system-document-types'
import {
  buildPrimaryPstoSystemDocumentRow,
  buildPstoRepeatSystemDocumentRow,
} from '@/lib/system-document-virtual-row'
import {
  buildPrimaryTvmtRequestRows,
  buildPrimaryTvmtResultRows,
} from '@/lib/tvmt-field-updates'
import {
  canCreateRepeatPstoCycle,
  getCurrentPstoCycle,
  getPstoTvmtWorkflowState,
} from '@/lib/tvmt-cycle'
import { calculateFinalStatus } from '@/lib/weld-status'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import { getSystemDocumentTemplateId } from '@/lib/system-document-template-types'
import { DEFAULT_SAVE_CHECK_SETTINGS, type SaveCheckSettings } from '@/lib/save-check-settings'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import {
  getDispatcherDirtyScopes,
  markDispatcherTaskIndexDirty,
} from '@/server/dispatcher-task-index-dirty'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import {
  haveSameWeldLineMemberships,
  lockWeldLineMembershipsForWeldIds,
} from '@/server/weld-line-membership-lock'
import { assertPstoWorkflowLinesFullyAssigned } from '@/server/psto-workflow-line-guard'
import {
  deletePstoRepeatCyclesInTransaction,
  getPstoCycleState,
  persistPstoCycleCorrection,
  persistPstoCycleWorkflowWrites,
  saveRepeatCycleWrites,
  type PstoCycleWorkflowAction,
} from '@/server/psto-cycle-state'
import { assertSecurityScope } from '@/server/security-functions'
import {
  removeSourcedSystemDocumentPositionsInTransaction,
  syncSystemDocumentsForWeldChangesInTransaction,
  upsertSourcedSystemDocumentsInTransaction,
} from '@/server/system-document-index'
import {
  lockSystemDocumentNumberCounter,
  reserveSystemDocumentNames,
  type SystemDocumentSequenceUpdate,
  type SystemDocumentSequenceTransaction,
} from '@/server/system-document-sequences'
import { WELD_TABLE_RETURNING } from '@/server/weld-server-shared'
import {
  assertExpectedInteractiveWeldVersions,
  lockInteractiveWeldRows,
} from '@/server/weld-row-version'
import { loadWeldWorkflowSettingsFromTransaction } from '@/server/weld-workflow-settings'

export type PstoRepeatWorkflowAction = PstoCycleWorkflowAction

export { saveRepeatCycleWrites }

export type PstoRepeatWorkflowGroup = {
  rowIds: number[]
  name: string
  useSystemName?: boolean
}

export type PstoRepeatWorkflowPayload = {
  action: PstoRepeatWorkflowAction
  date: string
  groups: PstoRepeatWorkflowGroup[]
  results?: Array<{ rowId: number; result: string }>
  expectedVersions: WeldRowVersionTarget[]
}

export const savePstoRepeatWorkflow = createServerFn({ method: 'POST' })
  .validator(normalizePstoCycleWorkflowPayload)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()
    return db.transaction(async (tx) => {
      await loadControlProcessSettingsFromTransaction(tx)
      const { saveCheckSettings } = await loadWeldWorkflowSettingsFromTransaction(tx)
      const rowIds = [...new Set(data.groups.flatMap((group) => group.rowIds))]
      const sequenceRequests = data.groups.map((group) => (
        group.useSystemName
          ? getSequenceRequest(data.action, data.date, group.name)
          : null
      ))
      const sequenceIds = [...new Set(sequenceRequests
        .filter((request): request is SystemDocumentSequenceUpdate => Boolean(request))
        .map(getSystemDocumentTemplateId))]
        .sort()
      for (const sequenceId of sequenceIds) {
        await lockSystemDocumentNumberCounter(tx, sequenceId)
      }
      const lineMembershipSnapshot = await lockWeldLineMembershipsForWeldIds(tx, rowIds)
      if (lineMembershipSnapshot.length !== rowIds.length) {
        throw new Error('Один или несколько выбранных стыков больше не существуют. Обновите отчет ПСТО.')
      }
      const storedRows = await lockInteractiveWeldRows(tx, rowIds)
      if (storedRows.length !== rowIds.length) {
        throw new Error('Один или несколько выбранных стыков больше не существуют. Обновите отчет ПСТО.')
      }
      if (!haveSameWeldLineMemberships(lineMembershipSnapshot, storedRows)) {
        throw new Error('Один или несколько выбранных стыков уже перенесены на другую линию. Обновите отчет ПСТО.')
      }
      assertExpectedInteractiveWeldVersions(rowIds, data.expectedVersions, storedRows)
      await assertPstoWorkflowLinesFullyAssigned(tx, storedRows, { allowPerformedHistoryRows: true })
      const rows = await attachDuplicateControlRelations(
        await attachHeatTreatmentControlRelations(
          storedRows as WeldRow[],
          tx,
        ),
        tx,
      )
      const rowsById = new Map(rows.map((row) => [row.id, row]))
      const resultByRowId = new Map(data.results.map((entry) => [entry.rowId, entry.result]))
      const systemNameGroups = data.groups.flatMap((group, index) => {
        const request = sequenceRequests[index]
        return request
          ? [{ index, request, rows: group.rowIds.map((rowId) => rowsById.get(rowId)!) }]
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

      const writes = resolvedGroups.flatMap((group) =>
        group.rowIds.map((rowId) => buildWorkflowWrite({
          action: data.action,
          row: rowsById.get(rowId)!,
          date: data.date,
          name: group.name,
          result: resultByRowId.get(rowId) ?? '',
          saveCheckSettings,
        })),
      )
      const persistedRows = await persistPstoCycleWorkflowWrites({
        tx,
        action: data.action,
        sourceRows: rows,
        writes,
      })
      const updatedRows = await attachDuplicateControlRelations(
        await attachHeatTreatmentControlRelations(
          persistedRows,
          tx,
        ),
        tx,
      )
      await syncPstoCycleDocuments(tx, data.action, resolvedGroups, updatedRows)
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes(updatedRows, new Map()),
      })
      return updatedRows
    })
  })

export type CorrectPstoCycleStagePayload = {
  rowId: number
  expectedVersion: string
  sequence: number
  cycleId?: number
  stage: PstoCycleStage
  action: 'update' | 'delete'
  date?: string
  name?: string
  result?: string
}

export const correctPstoCycleStage = createServerFn({ method: 'POST' })
  .validator(normalizePstoCycleStageCorrectionPayload)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()
    return db.transaction(async (tx) => {
      await loadControlProcessSettingsFromTransaction(tx)
      const { saveCheckSettings } = await loadWeldWorkflowSettingsFromTransaction(tx)
      const [storedRow] = await tx
        .select(WELD_TABLE_RETURNING)
        .from(weldJoints)
        .where(eq(weldJoints.id, data.rowId))
        .for('update')
        .limit(1)
      if (!storedRow) throw new Error('Стык больше не существует. Обновите отчет ПСТО.')
      assertExpectedInteractiveWeldVersions(
        [data.rowId],
        [{ id: data.rowId, version: data.expectedVersion }],
        [storedRow],
      )
      await tx
        .select({ id: pstoRepeatCycles.id })
        .from(pstoRepeatCycles)
        .where(eq(pstoRepeatCycles.weldJointId, data.rowId))
        .for('update')

      const [currentRow] = await attachDuplicateControlRelations(
        await attachHeatTreatmentControlRelations([storedRow as WeldRow], tx),
        tx,
      )
      const correction = applyPstoCycleCorrection(currentRow, data, saveCheckSettings)
      const sourceRelationId = data.sequence === 1
        ? data.rowId
        : correction.repeatCycle?.id ?? correction.deletedRepeatCycleId
      if (!sourceRelationId) throw new Error('Цикл ПСТО больше не существует. Обновите отчет ПСТО.')
      await removeSourcedSystemDocumentPositionsInTransaction({
        tx,
        sourceKind: 'pstoCycle',
        sourcePositions: [
          {
            weldJointId: data.rowId,
            relationId: sourceRelationId,
            sequence: data.sequence,
          },
          {
            weldJointId: data.rowId,
            relationId: sourceRelationId,
            sequence: data.sequence,
            methodCode: 'ТВМТ',
          },
        ],
      })

      const savedRow = await persistPstoCycleCorrection({
        tx,
        currentRow,
        correction,
        sequence: data.sequence,
      })
      if (data.sequence === 1) {
        await syncSystemDocumentsForWeldChangesInTransaction(
          tx,
          [savedRow],
          new Map([[currentRow.id, currentRow]]),
        )
        await syncAllPstoCycleDocuments(tx, savedRow, 1)
      } else {
        const relationId = correction.repeatCycle?.id ?? correction.deletedRepeatCycleId
        if (!relationId) throw new Error('Повторный цикл больше не существует. Обновите отчет ПСТО.')
        await removeSourcedSystemDocumentPositionsInTransaction({
          tx,
          sourceKind: 'pstoRepeat',
          relationIds: [relationId],
        })
        if (!correction.deletedRepeatCycleId) {
          await syncAllPstoCycleDocuments(tx, savedRow, data.sequence)
        }
      }

      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes([savedRow], new Map()),
      })
      return (await attachDuplicateControlRelations(
        await attachHeatTreatmentControlRelations([savedRow], tx),
        tx,
      ))[0]
    })
  })

export type CorrectPstoTvmtAndRemoveLaterCyclesPayload = {
  rowId: number
  expectedVersion: string
  sequence: number
  cycleId?: number
  date?: string
  name?: string
  result?: string
}

export const correctPstoTvmtAndRemoveLaterCycles = createServerFn({ method: 'POST' })
  .validator(normalizePstoTvmtAndRemoveLaterCyclesPayload)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()
    return db.transaction(async (tx) => {
      await loadControlProcessSettingsFromTransaction(tx)
      const { saveCheckSettings } = await loadWeldWorkflowSettingsFromTransaction(tx)
      const [storedRow] = await tx
        .select(WELD_TABLE_RETURNING)
        .from(weldJoints)
        .where(eq(weldJoints.id, data.rowId))
        .for('update')
        .limit(1)
      if (!storedRow) throw new Error('Стык больше не существует. Обновите отчет ПСТО.')
      assertExpectedInteractiveWeldVersions(
        [data.rowId],
        [{ id: data.rowId, version: data.expectedVersion }],
        [storedRow],
      )
      await tx
        .select({ id: pstoRepeatCycles.id })
        .from(pstoRepeatCycles)
        .where(eq(pstoRepeatCycles.weldJointId, data.rowId))
        .for('update')

      const [currentRow] = await attachDuplicateControlRelations(
        await attachHeatTreatmentControlRelations([storedRow as WeldRow], tx),
        tx,
      )
      const correction = applyPstoTvmtCorrectionWithLaterCycleRemoval(currentRow, data, saveCheckSettings)
      const currentRelationId = data.sequence === 1
        ? data.rowId
        : correction.repeatCycle?.id
      if (!currentRelationId) throw new Error('Цикл ПСТО больше не существует. Обновите отчет ПСТО.')

      const removedCyclePositions = correction.deletedRepeatCycles.flatMap((cycle) => [
        {
          weldJointId: data.rowId,
          relationId: cycle.id,
          sequence: cycle.sequence,
        },
        {
          weldJointId: data.rowId,
          relationId: cycle.id,
          sequence: cycle.sequence,
          methodCode: 'ТВМТ',
        },
      ])
      await removeSourcedSystemDocumentPositionsInTransaction({
        tx,
        sourceKind: 'pstoCycle',
        sourcePositions: [
          {
            weldJointId: data.rowId,
            relationId: currentRelationId,
            sequence: data.sequence,
          },
          {
            weldJointId: data.rowId,
            relationId: currentRelationId,
            sequence: data.sequence,
            methodCode: 'ТВМТ',
          },
          ...removedCyclePositions,
        ],
      })

      const deletedCycleIds = correction.deletedRepeatCycles.map((cycle) => cycle.id)
      await removeSourcedSystemDocumentPositionsInTransaction({
        tx,
        sourceKind: 'pstoRepeat',
        relationIds: [
          ...(data.sequence === 1 ? [] : [currentRelationId]),
          ...deletedCycleIds,
        ],
      })
      await deletePstoRepeatCyclesInTransaction(tx, deletedCycleIds)

      const persistedRow = await persistPstoCycleCorrection({
        tx,
        currentRow,
        correction: {
          row: correction.row,
          repeatCycle: correction.repeatCycle,
          deletedRepeatCycleId: null,
        },
        sequence: data.sequence,
      })
      const savedRow = {
        ...persistedRow,
        pstoRepeatCycles: correction.row.pstoRepeatCycles ?? [],
      }
      if (data.sequence === 1) {
        await syncSystemDocumentsForWeldChangesInTransaction(
          tx,
          [savedRow],
          new Map([[currentRow.id, currentRow]]),
        )
      }
      await syncAllPstoCycleDocuments(tx, savedRow, data.sequence)

      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes([savedRow], new Map()),
      })
      return (await attachDuplicateControlRelations(
        await attachHeatTreatmentControlRelations([savedRow], tx),
        tx,
      ))[0]
    })
  })

export function normalizePstoCycleStageCorrectionPayload(
  value: CorrectPstoCycleStagePayload,
): CorrectPstoCycleStagePayload & PstoCycleCorrectionInput {
  const rowId = Math.floor(Number(value?.rowId))
  if (rowId <= 0) throw new Error('Не указан стык.')
  const sequence = Math.floor(Number(value?.sequence))
  if (sequence <= 0) throw new Error('Не указан цикл ПСТО/ТВМТ.')
  const cycleIdValue = Math.floor(Number(value?.cycleId))
  const cycleId = cycleIdValue > 0 ? cycleIdValue : undefined
  if (sequence > 1 && !cycleId) {
    throw new Error('Не указан идентификатор повторного цикла. Обновите отчет.')
  }
  const stage = value?.stage
  if (!PSTO_CYCLE_STAGES.includes(stage)) throw new Error('Неизвестный этап ПСТО/ТВМТ.')
  const action = value?.action
  if (action !== 'update' && action !== 'delete') throw new Error('Неизвестное изменение цикла ПСТО/ТВМТ.')
  return {
    rowId,
    expectedVersion: String(value?.expectedVersion ?? '').trim(),
    sequence,
    cycleId,
    stage,
    action,
    date: String(value?.date ?? '').trim(),
    name: String(value?.name ?? '').trim(),
    result: String(value?.result ?? '').trim(),
  }
}

export function normalizePstoTvmtAndRemoveLaterCyclesPayload(
  value: CorrectPstoTvmtAndRemoveLaterCyclesPayload,
): CorrectPstoTvmtAndRemoveLaterCyclesPayload & PstoTvmtCorrectionWithLaterCycleRemovalInput {
  const normalized = normalizePstoCycleStageCorrectionPayload({
    ...value,
    stage: 'tvmtResult',
    action: 'update',
  })
  return {
    rowId: normalized.rowId,
    expectedVersion: normalized.expectedVersion,
    sequence: normalized.sequence,
    cycleId: normalized.cycleId,
    date: normalized.date,
    name: normalized.name,
    result: normalized.result,
  }
}

export function normalizePstoCycleWorkflowPayload(
  value: PstoRepeatWorkflowPayload,
): Required<PstoRepeatWorkflowPayload> {
  const action = value?.action
  if (!['pstoRequest', 'pstoResult', 'tvmtRequest', 'tvmtResult'].includes(action)) {
    throw new Error('Неизвестное действие повторного цикла ПСТО/ТВМТ.')
  }
  const rawDate = String(value?.date ?? '').trim()
  const date = action === 'pstoResult' ? rawDate : rawDate.slice(0, 10)
  if (action !== 'pstoResult' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Укажите дату документа.')
  }
  const groups = (Array.isArray(value?.groups) ? value.groups : []).map((group) => ({
    rowIds: [...new Set((Array.isArray(group?.rowIds) ? group.rowIds : [])
      .map(Number)
      .filter((rowId) => Number.isInteger(rowId) && rowId > 0))],
    name: String(group?.name ?? '').trim(),
    useSystemName: Boolean(group?.useSystemName),
  })).filter((group) => group.rowIds.length > 0)
  if (groups.length === 0) throw new Error('Выберите хотя бы один стык.')
  if (action !== 'pstoResult' && groups.some((group) => !group.name)) {
    throw new Error('Укажите наименование документа.')
  }
  const assigned = new Set<number>()
  for (const group of groups) {
    for (const rowId of group.rowIds) {
      if (assigned.has(rowId)) throw new Error('Один стык нельзя включить в несколько документов одновременно.')
      assigned.add(rowId)
    }
  }
  const resultsByRowId = new Map<number, { rowId: number; result: string }>()
  for (const entry of Array.isArray(value?.results) ? value.results : []) {
    const normalized = { rowId: Number(entry.rowId), result: String(entry.result ?? '').trim() }
    if (!assigned.has(normalized.rowId)) continue
    if (resultsByRowId.has(normalized.rowId)) {
      throw new Error('Результат ТВМТ одного стыка указан несколько раз.')
    }
    resultsByRowId.set(normalized.rowId, normalized)
  }
  const results = [...resultsByRowId.values()]
  if (action === 'tvmtResult' && results.length !== assigned.size) {
    throw new Error('Укажите результат ТВМТ для каждого выбранного стыка.')
  }
  const expectedVersions = (Array.isArray(value?.expectedVersions) ? value.expectedVersions : []).map((entry) => ({
    id: Number(entry?.id),
    version: String(entry?.version ?? '').trim(),
  }))
  return { action, date, groups, results, expectedVersions }
}

export function buildWorkflowWrite({
  action,
  row,
  date,
  name,
  result,
  saveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
}: {
  action: PstoRepeatWorkflowAction
  row: WeldRow
  date: string
  name: string
  result: string
  saveCheckSettings?: SaveCheckSettings
}) {
  const currentCycle = getCurrentPstoCycle(row)
  const workflowState = getPstoTvmtWorkflowState(row)
  if (action === 'pstoRequest' && canCreateRepeatPstoCycle(row)) {
    return {
      source: 'repeat' as const,
      cycle: buildRepeatPstoRequestCycle({
        row,
        requestName: name,
        requestDate: date,
        saveCheckSettings,
      }),
    }
  }
  if (action === 'pstoRequest') {
    assertCurrentWorkflowStage(row, currentCycle?.source, workflowState, 'primary', 'waiting-psto-request')
    const [updatedRow] = buildPstoRequestRows({
      records: [row],
      requestName: name,
      requestDate: date,
      saveCheckSettings,
    })
    return {
      source: 'primary' as const,
      row: { ...updatedRow, finalStatus: calculateFinalStatus(updatedRow) },
    }
  }
  if (action === 'pstoResult' && currentCycle?.source === 'primary') {
    assertCurrentWorkflowStage(row, currentCycle.source, workflowState, 'primary', 'waiting-psto')
    const [updatedRow] = buildPstoResultRows({
      records: [row],
      pstoDate: date,
      result: 'проведено',
      diagramName: name,
      rows: [row],
      saveCheckSettings,
    })
    return {
      source: 'primary' as const,
      row: { ...updatedRow, finalStatus: calculateFinalStatus(updatedRow) },
    }
  }
  if ((action === 'tvmtRequest' || action === 'tvmtResult') && currentCycle?.source === 'primary') {
    const [updatedRow] = action === 'tvmtRequest'
      ? buildPrimaryTvmtRequestRows({
          records: [row],
          requestName: name,
          requestDate: date,
          saveCheckSettings,
        })
      : buildPrimaryTvmtResultRows({
          records: [row],
          controlDate: date,
          result,
          conclusionName: name,
          saveCheckSettings,
        })
    return { source: 'primary' as const, row: updatedRow }
  }
  if (action === 'pstoResult') {
    return {
      source: 'repeat' as const,
      cycle: buildRepeatPstoResultCycle({
        row,
        pstoDate: date,
        diagramName: name,
        saveCheckSettings,
      }),
    }
  }
  if (action === 'tvmtRequest') {
    return {
      source: 'repeat' as const,
      cycle: buildRepeatTvmtRequestCycle({
        row,
        requestName: name,
        requestDate: date,
        saveCheckSettings,
      }),
    }
  }
  return {
    source: 'repeat' as const,
    cycle: buildRepeatTvmtResultCycle({
      row,
      controlDate: date,
      result,
      conclusionName: name,
      saveCheckSettings,
    }),
  }
}

function assertCurrentWorkflowStage(
  row: WeldRow,
  actualSource: 'primary' | 'repeat' | undefined,
  actualState: ReturnType<typeof getPstoTvmtWorkflowState>,
  expectedSource: 'primary' | 'repeat',
  expectedState: ReturnType<typeof getPstoTvmtWorkflowState>,
) {
  if (actualSource === expectedSource && actualState === expectedState) return
  throw new Error(
    `Стык ${formatJoint(row)}: действие не соответствует текущему циклу ПСТО/ТВМТ. Обновите отчет.`,
  )
}

function formatJoint(row: WeldRow) {
  return String(row.joint ?? '').trim() || `ID ${row.id}`
}

async function syncPstoCycleDocuments(
  tx: SystemDocumentSequenceTransaction,
  action: PstoRepeatWorkflowAction,
  groups: PstoRepeatWorkflowGroup[],
  rows: WeldRow[],
  targetSequences: ReadonlyMap<number, number> = new Map(),
) {
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const type = getDocumentType(action)
  const documents = [] as Parameters<typeof upsertSourcedSystemDocumentsInTransaction>[0]['documents'][number][]
  for (const group of groups) {
    if (!text(group.name)) continue
    const groupRows = group.rowIds.map((rowId) => rowsById.get(rowId)).filter(Boolean) as WeldRow[]
    const virtualRows = groupRows.map((row) => {
      const cycle = getWorkflowCycle(row, targetSequences.get(row.id))
      const repeatCycle = cycle?.source === 'repeat' ? getRepeatCycleRecord(row, cycle.id) : null
      return repeatCycle
        ? buildPstoRepeatSystemDocumentRow(row, repeatCycle)
        : buildPrimaryPstoSystemDocumentRow(row)
    })
    const summary = buildSystemDocumentSummaries(virtualRows, type).find((candidate) => (
      candidate.title === group.name &&
      candidate.date === text(getWorkflowDocumentDate(
        action,
        groupRows[0] ? getWorkflowCycle(groupRows[0], targetSequences.get(groupRows[0].id)) : null,
      )) &&
      (action === 'tvmtResult' ? candidate.methodCode === 'ТВМТ' : true)
    ))
    if (!summary) throw new Error(`Не удалось собрать системный документ «${group.name}».`)
    const sourcePositions = groupRows.map((row) => {
      const cycle = getWorkflowCycle(row, targetSequences.get(row.id))
      const sequence = cycle?.sequence ?? 1
      return {
        kind: 'pstoCycle' as const,
        weldJointId: row.id,
        relationId: cycle?.source === 'repeat' ? Number(cycle.id) : row.id,
        sequence,
        ...((action === 'tvmtRequest' || action === 'tvmtResult') ? { methodCode: 'ТВМТ' } : {}),
      }
    })
    documents.push({
      summary: {
        ...summary,
        ...((action === 'tvmtRequest' || action === 'tvmtResult') ? { methodCode: 'ТВМТ' } : {}),
        sourceKind: 'pstoCycle',
        cycleSequences: [...new Set(sourcePositions.map((position) => position.sequence))].sort((a, b) => a - b),
      },
      sourcePositions,
    })
  }
  await upsertSourcedSystemDocumentsInTransaction({ tx, documents })
}

function getRepeatCycleRecord(row: WeldRow, cycleId: number | undefined) {
  if (!cycleId) return null
  return (row.pstoRepeatCycles ?? []).find((cycle) => cycle.id === cycleId) ?? null
}

function getWorkflowDocumentDate(action: PstoRepeatWorkflowAction, cycle: PstoCycleSnapshot | null) {
  if (action === 'pstoRequest') return cycle?.pstoRequestDate
  if (action === 'pstoResult') return cycle?.pstoDate
  if (action === 'tvmtRequest') return cycle?.tvmtRequestDate
  return cycle?.tvmtConclusionDate
}

function getWorkflowCycle(row: WeldRow, sequence?: number) {
  if (!sequence) return getCurrentPstoCycle(row)
  return getPstoCycleState(row)
    .find((cycle) => cycle.sequence === sequence) ?? null
}

async function syncAllPstoCycleDocuments(
  tx: SystemDocumentSequenceTransaction,
  row: WeldRow,
  sequence: number,
) {
  const cycle = getWorkflowCycle(row, sequence)
  if (!cycle) return
  const targetSequences = new Map([[row.id, sequence]])
  const documents: Array<{ action: PstoRepeatWorkflowAction; name: string }> = [
    { action: 'tvmtRequest', name: text(cycle.tvmtRequest) },
    { action: 'tvmtResult', name: text(cycle.tvmtConclusion) },
    { action: 'pstoRequest', name: text(cycle.pstoRequest) },
    { action: 'pstoResult', name: text(cycle.heatTreatmentDiagram) },
  ]
  for (const document of documents) {
    if (!document.name) continue
    await syncPstoCycleDocuments(
      tx,
      document.action,
      [{ rowIds: [row.id], name: document.name }],
      [row],
      targetSequences,
    )
  }
}

function getDocumentType(action: PstoRepeatWorkflowAction): SystemDocumentType {
  if (action === 'pstoRequest') return 'pstoRequest'
  if (action === 'pstoResult') return 'pstoConclusion'
  if (action === 'tvmtRequest') return 'lnkRequest'
  return 'lnkConclusion'
}

function getSequenceRequest(
  action: PstoRepeatWorkflowAction,
  date: string,
  provisionalName: string,
): SystemDocumentSequenceUpdate {
  const config: Record<PstoRepeatWorkflowAction, {
    type: SystemDocumentType
    fieldKeys: WeldFieldKey[]
    methodCode?: string
  }> = {
    pstoRequest: { type: 'pstoRequest', fieldKeys: ['pstoRequest'] },
    pstoResult: { type: 'pstoConclusion', fieldKeys: ['heatTreatmentDiagram'] },
    tvmtRequest: { type: 'lnkRequest', fieldKeys: ['tvmtRequest'], methodCode: 'ТВМТ' },
    tvmtResult: { type: 'lnkConclusion', fieldKeys: ['tvmtConclusion'], methodCode: 'ТВМТ' },
  }
  return { ...config[action], date, provisionalName }
}

function textOrNull(value: unknown) {
  const normalized = text(value)
  return normalized || null
}

function text(value: unknown) {
  return String(value ?? '').trim()
}
