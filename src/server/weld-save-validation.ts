import { asc, eq, inArray, sql } from 'drizzle-orm'

import type { requireDb } from '@/db'
import {
  appSettings,
  welderStampSuspensions,
  welderStamps,
  weldJoints,
  type WeldJoint,
} from '@/db/schema'
import {
  DEFAULT_DATA_LIST_SETTINGS,
  normalizeDataListOption,
  normalizeDataListSettings,
  type DataListSettings,
} from '@/lib/data-list-settings'
import {
  DEFAULT_OTHER_SETTINGS,
  normalizeOtherSettings,
  type OtherSettings,
} from '@/lib/other-settings'
import { getRequiredRootStampMessage } from '@/lib/weld-import-export'
import { validateJointNameStructure } from '@/lib/joint-name'
import { getWeldFormSaveBlockReason } from '@/lib/weld-form-save-reasons'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import { calculateFinalStatus } from '@/lib/weld-status'
import {
  DEFAULT_SAVE_CHECK_SETTINGS,
  formatSaveCheckBlockReason,
  normalizeSaveCheckSettings,
  type SaveCheckSettings,
} from '@/lib/save-check-settings'
import { getOfficialStampCompatibilitySaveBlockReason } from '@/lib/welder-stamp-compatibility'
import type {
  WelderStampDlsPermit,
  WelderStampNaksPermit,
  WelderStampRecord,
  WelderStampSuspensionRecord,
} from '@/lib/welder-stamp-types'
import { applySystemWdi, getSystemWdiValidationError, isSystemWdiMode } from '@/lib/wdi'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import {
  DEFAULT_SYSTEM_INDEX_SETTINGS,
  normalizeSystemIndexSettings,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'
import { getMissingWeldImportIdentityFields } from '@/lib/weld-import-identity'
import {
  getPstoLineIdentityKey,
  hasPstoLifecycleData,
  normalizePstoLineIdentity,
  requiresPrimaryStageResolutionForAssignedPstoLine,
} from '@/lib/psto-line-assignment'
import {
  isControlCancelledValue,
  isControlEnabledValue,
} from '@/lib/control-availability-values'
import {
  getPreHeatTreatmentControl,
  getPrimaryLnkStageBlockReason,
  getPrimaryPstoStartBlockReason,
  isPreHeatTreatmentLnkMethodCode,
  PRE_HEAT_TREATMENT_LNK_METHODS,
  type PreHeatTreatmentControlRecord,
} from '@/lib/lnk-control-stage'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { isFinalLnkResultValue } from '@/lib/lnk-status'
import {
  getCurrentPstoCycle,
  getPstoTvmtWorkflowLabel,
  getPstoTvmtWorkflowState,
  normalizeTvmtResult,
  requiresPostHeatTreatmentCompletion,
} from '@/lib/tvmt-cycle'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'

type Db = ReturnType<typeof requireDb>
type ValidationDb = Pick<Db, 'select'>

export type ServerWeldValidationContext = {
  saveCheckSettings: SaveCheckSettings
  dataListSettings: DataListSettings
  otherSettings: OtherSettings
  systemIndexSettings: SystemIndexSettings
  welderStamps: WelderStampRecord[]
  welderStampSuspensions: WelderStampSuspensionRecord[]
  pstoLineAssignments: ReadonlyMap<string, PstoLineAssignmentState>
}

export type PstoLineAssignmentState = {
  rowCount: number
  assignedCount: number
  cancelledCount?: number
  cancellationDate?: string
  cancellationBasis?: string
  basis?: string
}

const OFFICIAL_VALIDATION_FIELDS = new Set<WeldFieldKey>([
  'weldDate',
  'weldingMethod',
  'connectionType',
  'materialGroup',
  'd1',
  'd2',
  't1',
  't2',
  'stamp1K',
  'stamp1Z',
  'stamp1O',
  'stamp2K',
  'stamp2Z',
  'stamp2O',
])

export async function loadServerWeldValidationContext(db: ValidationDb): Promise<ServerWeldValidationContext> {
  const normalizedProjectTitle = sql<string>`btrim(coalesce(${weldJoints.projectTitle}, ''))`
  const normalizedSubtitleCode = sql<string>`btrim(coalesce(${weldJoints.subtitleCode}, ''))`
  const normalizedLine = sql<string>`btrim(coalesce(${weldJoints.line}, ''))`
  // This loader also runs on a transaction-bound client. Keep its queries sequential:
  // node-postgres no longer supports concurrent queries on the same transaction client.
  const settingRows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, [
      PROJECT_SETTING_KEYS.saveCheck,
      PROJECT_SETTING_KEYS.dataList,
      PROJECT_SETTING_KEYS.other,
      PROJECT_SETTING_KEYS.systemIndex,
    ]))
  const stampRows = await db.select().from(welderStamps)
  const suspensionRows = await db.select().from(welderStampSuspensions)
  const pstoLineRows = await db
    .select({
      projectTitle: normalizedProjectTitle,
      subtitleCode: normalizedSubtitleCode,
      line: normalizedLine,
      rowCount: sql<number>`count(*)::int`,
      assignedCount: sql<number>`count(*) filter (where lower(btrim(coalesce(${weldJoints.pstoRequired}, ''))) in ('да', 'дополнительный', 'замена рк/узк'))::int`,
      cancelledCount: sql<number>`count(*) filter (where lower(btrim(coalesce(${weldJoints.pstoRequired}, ''))) = 'отменен')::int`,
      cancellationDate: sql<string | null>`max(${weldJoints.pstoCancellationDate})`,
      cancellationBasis: sql<string | null>`max(nullif(btrim(coalesce(${weldJoints.pstoControlBasis}, '')), '')) filter (where lower(btrim(coalesce(${weldJoints.pstoRequired}, ''))) = 'отменен')`,
    })
    .from(weldJoints)
    .where(sql`btrim(coalesce(${weldJoints.line}, '')) <> ''`)
    .groupBy(normalizedProjectTitle, normalizedSubtitleCode, normalizedLine)
  const settingsByKey = new Map(settingRows.map((row) => [row.key, parseStoredValue(row.value)]))
  return {
    saveCheckSettings: settingsByKey.has(PROJECT_SETTING_KEYS.saveCheck)
      ? normalizeSaveCheckSettings(settingsByKey.get(PROJECT_SETTING_KEYS.saveCheck))
      : DEFAULT_SAVE_CHECK_SETTINGS,
    dataListSettings: settingsByKey.has(PROJECT_SETTING_KEYS.dataList)
      ? normalizeDataListSettings(settingsByKey.get(PROJECT_SETTING_KEYS.dataList))
      : DEFAULT_DATA_LIST_SETTINGS,
    otherSettings: settingsByKey.has(PROJECT_SETTING_KEYS.other)
      ? normalizeOtherSettings(settingsByKey.get(PROJECT_SETTING_KEYS.other))
      : DEFAULT_OTHER_SETTINGS,
    systemIndexSettings: settingsByKey.has(PROJECT_SETTING_KEYS.systemIndex)
      ? normalizeSystemIndexSettings(settingsByKey.get(PROJECT_SETTING_KEYS.systemIndex))
      : DEFAULT_SYSTEM_INDEX_SETTINGS,
    welderStamps: stampRows.map(toWelderStampRecord),
    welderStampSuspensions: suspensionRows.map((row) => ({
      id: row.id,
      naksStamp: row.naksStamp ?? '',
      suspendedFrom: row.suspendedFrom ?? '',
      suspendedTo: row.suspendedTo ?? '',
    })),
    pstoLineAssignments: new Map(pstoLineRows.map((row) => [
      getPstoLineIdentityKey(row),
      {
        rowCount: Number(row.rowCount) || 0,
        assignedCount: Number(row.assignedCount) || 0,
        cancelledCount: Number(row.cancelledCount) || 0,
        cancellationDate: String(row.cancellationDate ?? '').trim(),
        cancellationBasis: String(row.cancellationBasis ?? '').trim(),
      },
    ])),
  }
}

export function prepareServerWeldRecords({
  records,
  previousRows,
  context,
  importMode = false,
  allowPstoLineLifecycleMove = false,
}: {
  records: WeldInput[]
  previousRows: ReadonlyMap<number, WeldJoint>
  context: ServerWeldValidationContext
  importMode?: boolean
  allowPstoLineLifecycleMove?: boolean
}) {
  applyPstoLineAssignments({
    records,
    previousRows,
    context,
    importMode,
    allowPstoLineLifecycleMove,
  })
  records.forEach((record) => {
    record.finalStatus = calculateFinalStatus(record)
  })
  if (!isSystemWdiMode(context.otherSettings)) return records

  records.forEach((record, index) => {
    const previous = record.id ? previousRows.get(Number(record.id)) : undefined
    const dimensionsChanged = !previous || ['connectionType', 'd1', 'd2', 't1', 't2'].some(
      (fieldKey) => normalizeComparable(record[fieldKey as WeldFieldKey]) !== normalizeComparable(previous[fieldKey as keyof WeldJoint]),
    )
    const wdiChanged = !previous || normalizeComparable(record.wdi) !== normalizeComparable(previous.wdi)
    if (!dimensionsChanged && !wdiChanged) return
    if (previous && dimensionsChanged && !wdiChanged) {
      applySystemWdi(record, context.otherSettings)
      return
    }
    const validationError = getSystemWdiValidationError(record, context.otherSettings)
    if (validationError) {
      const prefix = importMode
        ? `Импорт остановлен: строка ${index + 2}, стык "${String(record.joint ?? '').trim() || 'пусто'}". `
        : 'Сохранение невозможно: '
      throw new Error(`${prefix}${validationError}`)
    }
    applySystemWdi(record, context.otherSettings)
  })
  return records
}

function applyPstoLineAssignments({
  records,
  previousRows,
  context,
  importMode,
  allowPstoLineLifecycleMove,
}: {
  records: WeldInput[]
  previousRows: ReadonlyMap<number, WeldJoint>
  context: ServerWeldValidationContext
  importMode: boolean
  allowPstoLineLifecycleMove: boolean
}) {
  records.forEach((record, index) => {
    const previous = record.id ? previousRows.get(Number(record.id)) : undefined
    const targetIdentity = normalizePstoLineIdentity(record)
    const targetKey = getPstoLineIdentityKey(targetIdentity)
    const previousKey = previous ? getPstoLineIdentityKey(previous) : ''
    const identityChanged = Boolean(previous && targetKey !== previousKey)
    const lineState = targetIdentity.line ? context.pstoLineAssignments.get(targetKey) : undefined
    const lineIsPartial = Boolean(
      lineState &&
      lineState.assignedCount !== lineState.rowCount &&
      (lineState.cancelledCount ?? 0) !== lineState.rowCount &&
      (lineState.assignedCount > 0 || (lineState.cancelledCount ?? 0) > 0),
    )

    if (lineIsPartial) {
      if (previous && !identityChanged) {
        record.pstoRequired = previous.pstoRequired
        record.pstoControlBasis = previous.pstoControlBasis
        return
      }
      throw buildPstoLineAssignmentError({
        record,
        index,
        importMode,
        details: 'целевая линия содержит смешанное назначение ПСТО. Сначала выровняйте ее в «Программе ПСТО».',
      })
    }

    const targetAssigned = Boolean(lineState && lineState.rowCount > 0 && lineState.assignedCount === lineState.rowCount)
    const targetCancelled = Boolean(lineState && lineState.rowCount > 0 && lineState.cancelledCount === lineState.rowCount)
    if (
      importMode &&
      identityChanged &&
      targetAssigned &&
      previous &&
      requiresPrimaryStageResolutionForAssignedPstoLine(previous as unknown as WeldRow)
    ) {
      throw buildPstoLineAssignmentError({
        record,
        index,
        importMode,
        details: 'стык переносится на линию с ПСТО, но у него уже есть основной комплект ВИК/РК/УЗК/ПВК. Выполните перенос через карточку стыка и выберите: перенести комплект в «До ТО» или удалить.',
      })
    }
    if (
      identityChanged &&
      !targetAssigned &&
      hasPstoLifecycleHistory(previous) &&
      !allowPstoLineLifecycleMove
    ) {
      throw buildPstoLineAssignmentError({
        record,
        index,
        importMode,
        details: targetCancelled
          ? 'стык переносится на отмененную линию ПСТО, но у него уже есть документы ПСТО/ТВМТ, повторные циклы или НК до ТО. Выполните перенос через карточку стыка.'
          : 'стык переносится на линию без ПСТО, но у него уже есть документы ПСТО/ТВМТ, повторные циклы или НК до ТО. Сначала нужно выбрать судьбу этих данных в профильном процессе.',
      })
    }

    record.pstoRequired = targetAssigned ? 'да' : targetCancelled ? 'отменен' : null
    record.pstoCancellationDate = targetCancelled ? lineState?.cancellationDate || null : null
    record.pstoControlBasis = targetCancelled ? lineState?.cancellationBasis || null : null
  })
}

export function hasPstoLifecycleHistory(previous: WeldJoint | undefined) {
  return previous ? hasPstoLifecycleData(previous) : false
}

function buildPstoLineAssignmentError({
  record,
  index,
  importMode,
  details,
}: {
  record: WeldInput
  index: number
  importMode: boolean
  details: string
}) {
  const joint = String(record.joint ?? '').trim() || 'без номера'
  const prefix = importMode ? `Импорт остановлен: строка ${index + 2}, стык «${joint}».` : `Стык «${joint}».`
  return new Error(`${prefix} ${details}`)
}

export async function loadPreviousWeldRows(db: ValidationDb, records: WeldInput[]) {
  const ids = records
    .map((record) => Number(record.id))
    .filter((id) => Number.isInteger(id) && id > 0)
  if (ids.length === 0) return new Map<number, WeldJoint>()
  const rows = await attachDuplicateControlRelations(
    await attachHeatTreatmentControlRelations(
      await db
        .select()
        .from(weldJoints)
        .where(inArray(weldJoints.id, [...new Set(ids)]))
        .orderBy(asc(weldJoints.id))
        .for('update'),
      db,
    ),
    db,
  )
  return new Map(rows.map((row) => [row.id, row]))
}

export function mergeWeldRecordsWithPrevious(
  records: WeldInput[],
  previousRows: ReadonlyMap<number, WeldJoint>,
) {
  return records.map((record) => {
    const previous = record.id ? previousRows.get(Number(record.id)) : undefined
    if (!previous) return record
    const relations = previous as WeldJoint & {
      duplicateControls?: unknown[]
      preHeatTreatmentControls?: unknown[]
      pstoRepeatCycles?: unknown[]
    }
    return {
      ...previous,
      ...record,
      id: previous.id,
      duplicateControls: relations.duplicateControls ?? [],
      preHeatTreatmentControls: relations.preHeatTreatmentControls ?? [],
      pstoRepeatCycles: relations.pstoRepeatCycles ?? [],
    } as WeldInput
  })
}

export function validateServerWeldRecords({
  records,
  previousRows,
  context,
  importMode = false,
  allowSystemJointNames = false,
}: {
  records: WeldInput[]
  previousRows: ReadonlyMap<number, WeldJoint>
  context: ServerWeldValidationContext
  importMode?: boolean
  allowSystemJointNames?: boolean
}) {
  records.forEach((record, index) => {
    const previous = record.id ? previousRows.get(Number(record.id)) : undefined
    const isNew = !previous
    const prefix = importMode
      ? `Импорт остановлен: строка ${index + 2}, стык "${String(record.joint ?? '').trim() || 'пусто'}". `
      : 'Сохранение невозможно: '

    if (context.saveCheckSettings.manualJointName) {
      const structureReason = validateJointNameStructure(record.joint, context.systemIndexSettings)
      if (structureReason) throw new Error(`${prefix}${formatSaveCheckBlockReason('manualJointName', structureReason)}`)
    }

    if (importMode) validateRequiredImportIdentity(record, prefix)

    if (context.saveCheckSettings.requiredRootStampWithWeldDate) {
      const rootReason = getRequiredRootStampMessage(record)
      if (rootReason) {
        throw new Error(`${prefix}${formatSaveCheckBlockReason('requiredRootStampWithWeldDate', rootReason)}`)
      }
    }
    const pstoLifecycleReason = getPrimaryPstoLifecycleDestructiveChangeReason(record, previous)
    if (pstoLifecycleReason) throw new Error(`${prefix}${pstoLifecycleReason}`)
    const workflowStageReason = getSystemWorkflowStageTransitionReason(record, previous, context)
    if (workflowStageReason) throw new Error(`${prefix}${workflowStageReason}`)
    const formReason = getWeldFormSaveBlockReason(
      record,
      (previous ?? {}) as WeldInput,
      context.saveCheckSettings,
      {
        allowSystemJointName: allowSystemJointNames,
        systemIndexSettings: context.systemIndexSettings,
      },
    )
    if (formReason) throw new Error(`${prefix}${formReason}`)

    if (isNew || hasAnyChangedField(record, previous, OFFICIAL_VALIDATION_FIELDS)) {
      const stampReason = getOfficialStampCompatibilitySaveBlockReason(record, context.welderStamps, {
        materialGroups: context.dataListSettings.materialGroups,
        saveCheckSettings: context.saveCheckSettings,
        suspensions: context.welderStampSuspensions,
        weldingTypes: context.dataListSettings.weldingTypes,
      })
      if (stampReason) throw new Error(`${prefix}${stampReason}`)
    }

    validateConfiguredListValue(record, previous, context.dataListSettings, 'weldingMethod', 'Способ сварки', 'weldingTypes', prefix)
    validateConfiguredListValue(record, previous, context.dataListSettings, 'connectionType', 'Тип соединения', 'connectionTypes', prefix)
    validateConfiguredListValue(record, previous, context.dataListSettings, 'materialGroup', 'Группа материалов', 'materialGroups', prefix)
  })
}

export function getSystemWorkflowStageTransitionReason(
  record: WeldInput,
  previous: WeldJoint | undefined,
  context: Pick<ServerWeldValidationContext, 'pstoLineAssignments'>,
) {
  const preControlAssignmentReason = getPreHeatTreatmentAssignmentRemovalReason(record, previous)
  if (preControlAssignmentReason) return preControlAssignmentReason

  const startsPrimaryPsto = (
    (!hasText(previous?.pstoRequest) && hasText(record.pstoRequest)) ||
    (!isCompletedPstoValue(previous?.pstoResult) && isCompletedPstoValue(record.pstoResult))
  )
  if (startsPrimaryPsto) {
    const lineReason = getFullyAssignedPstoLineReason(record, context.pstoLineAssignments)
    if (lineReason) return lineReason
    const preControlReason = getPrimaryPstoStartBlockReason(record)
    if (preControlReason) return preControlReason
  }

  const startsPrimaryTvmtRequest = !hasText(previous?.tvmtRequest) && hasText(record.tvmtRequest)
  const startsPrimaryTvmtResult = (
    !normalizeTvmtResult(previous?.tvmtResult) && Boolean(normalizeTvmtResult(record.tvmtResult))
  )
  if (startsPrimaryTvmtRequest || startsPrimaryTvmtResult) {
    const lineReason = getFullyAssignedPstoLineReason(record, context.pstoLineAssignments)
    if (lineReason) return lineReason
    const previousCycle = previous ? getCurrentPstoCycle(previous) : null
    if (previousCycle?.source !== 'primary') {
      return 'Первичная ТВМТ недоступна: текущим является повторный цикл ПСТО.'
    }
    const expectedState = startsPrimaryTvmtResult ? 'waiting-tvmt' : 'waiting-tvmt-request'
    const previousState = previous ? getPstoTvmtWorkflowState(previous) : 'not-required'
    if (previousState !== expectedState) {
      return `ТВМТ сейчас недоступна: ${getPstoTvmtWorkflowLabel(previousState)}.`
    }
  }

  if (isControlEnabledValue(record.pstoRequired) || requiresPostHeatTreatmentCompletion(record)) {
    for (const method of LNK_METHODS) {
      if (!isPreHeatTreatmentLnkMethodCode(method.code)) continue
      const startsRequest = !hasText(previous?.[method.requestKey]) && hasText(record[method.requestKey])
      const startsResult = (
        !isFinalLnkResultValue(previous?.[method.resultKey]) &&
        isFinalLnkResultValue(record[method.resultKey])
      )
      if (!startsRequest && !startsResult) continue
      if (isControlEnabledValue(record.pstoRequired)) {
        const lineReason = getFullyAssignedPstoLineReason(record, context.pstoLineAssignments)
        if (lineReason) return lineReason
      }
      const stageReason = getPrimaryLnkStageBlockReason(record, method.code)
      if (stageReason) return stageReason
    }
  }

  return ''
}

function getPreHeatTreatmentAssignmentRemovalReason(
  record: WeldInput,
  previous: WeldJoint | undefined,
) {
  if (!previous) return ''
  const previousWithRelations = previous as unknown as WeldInput & {
    preHeatTreatmentControls?: PreHeatTreatmentControlRecord[]
  }

  for (const method of PRE_HEAT_TREATMENT_LNK_METHODS) {
    const wasAssigned = isControlEnabledValue(previous[method.enabledKey]) ||
      isControlCancelledValue(previous[method.enabledKey])
    const remainsAssigned = isControlEnabledValue(record[method.enabledKey]) ||
      isControlCancelledValue(record[method.enabledKey])
    if (!wasAssigned || remainsAssigned) continue

    const control = getPreHeatTreatmentControl(previousWithRelations, method.code)
    if (!control) continue
    return `${method.code}: нельзя снять назначение, пока существует заявка или результат НК до ТО. Сначала удалите позицию ${method.code} до ТО через отчет ЛНК либо выберите «отменен».`
  }

  return ''
}

function getFullyAssignedPstoLineReason(
  record: WeldInput,
  lineAssignments: ServerWeldValidationContext['pstoLineAssignments'],
) {
  const identity = normalizePstoLineIdentity(record)
  if (!identity.line) return 'Стык не привязан к линии. Назначение ПСТО выполняется для всей линии.'
  const state = lineAssignments.get(getPstoLineIdentityKey(identity))
  if (!state || state.rowCount === 0 || state.assignedCount !== state.rowCount) {
    const label = [identity.projectTitle, identity.subtitleCode, identity.line].filter(Boolean).join(' · ')
    return `Линия ${label} имеет частичное или отсутствующее назначение ПСТО. Сначала выровняйте ее в «Программе ПСТО».`
  }
  return ''
}

export function getPrimaryPstoLifecycleDestructiveChangeReason(
  record: WeldInput,
  previous: WeldJoint | undefined,
) {
  if (!previous || !hasPstoDownstreamHistory(previous)) return ''
  const removesRequest = hasText(previous.pstoRequest) && !hasText(record.pstoRequest)
  const removesResult = isCompletedPstoValue(previous.pstoResult) && !isCompletedPstoValue(record.pstoResult)
  const removesResultDate = hasText(previous.pstoDate) && !hasText(record.pstoDate)
  if (!removesRequest && !removesResult && !removesResultDate) return ''

  return 'Нельзя удалить первичную заявку, результат или дату ПСТО, пока сохранены данные ТВМТ либо повторные циклы. Сначала удалите последующие этапы через профильный процесс ПСТО/ТВМТ.'
}

function hasPstoDownstreamHistory(previous: WeldJoint) {
  const repeatCycles = (previous as WeldJoint & { pstoRepeatCycles?: unknown[] }).pstoRepeatCycles ?? []
  return repeatCycles.length > 0 || [
    previous.tvmtRequest,
    previous.tvmtRequestDate,
    previous.tvmtResult,
    previous.tvmtConclusionDate,
    previous.tvmtConclusion,
  ].some(hasText)
}

function isCompletedPstoValue(value: unknown) {
  const normalized = String(value ?? '').trim().toLocaleLowerCase('ru-RU')
  return normalized === 'проведено' || normalized === 'проведено (отменен)' || normalized === 'да'
}

function hasText(value: unknown) {
  return String(value ?? '').trim().length > 0
}

function validateRequiredImportIdentity(record: WeldInput, prefix: string) {
  const missing = getMissingWeldImportIdentityFields(record).map(({ label }) => label)
  if (missing.length > 0) {
    throw new Error(`${prefix}обязательные поля не могут быть пустыми: ${missing.join(', ')}.`)
  }
}

function validateConfiguredListValue(
  record: WeldInput,
  previous: WeldJoint | undefined,
  settings: DataListSettings,
  fieldKey: 'weldingMethod' | 'connectionType' | 'materialGroup',
  label: string,
  settingKey: 'weldingTypes' | 'connectionTypes' | 'materialGroups',
  prefix: string,
) {
  if (previous && normalizeComparable(record[fieldKey]) === normalizeComparable(previous[fieldKey])) return
  const rawValue = String(record[fieldKey] ?? '').trim()
  if (!rawValue) return
  const allowed = settings[settingKey]
  const values = fieldKey === 'weldingMethod'
    ? rawValue.split(/[,+]+/).map(normalizeDataListOption).filter(Boolean)
    : [normalizeDataListOption(rawValue)]
  if (allowed.length > 0 && values.every((value) => allowed.includes(value))) return
  throw new Error(`${prefix}${label} должен содержать значение из настроек: ${allowed.join(', ') || 'список не заполнен'}.`)
}

function hasAnyChangedField(
  record: WeldInput,
  previous: WeldJoint | undefined,
  fieldKeys: ReadonlySet<WeldFieldKey>,
) {
  if (!previous) return true
  const previousValues = previous as unknown as Record<string, unknown>
  return [...fieldKeys].some(
    (fieldKey) => normalizeComparable(record[fieldKey]) !== normalizeComparable(previousValues[fieldKey]),
  )
}

function normalizeComparable(value: unknown) {
  return value === null || value === undefined ? '' : String(value).trim()
}

function parseStoredValue(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function toWelderStampRecord(row: typeof welderStamps.$inferSelect): WelderStampRecord {
  return {
    id: row.id,
    naksStamp: row.naksStamp ?? '',
    welderName: row.welderName ?? '',
    internalStamp: row.internalStamp ?? '',
    weldType: row.weldType ?? '',
    materialGroups: row.materialGroups ?? '',
    diameterFrom: row.diameterFrom ?? '',
    diameterTo: row.diameterTo ?? '',
    thicknessFrom: row.thicknessFrom ?? '',
    thicknessTo: row.thicknessTo ?? '',
    validFrom: row.validFrom ?? '',
    validTo: row.validTo ?? '',
    naksPermits: parseJsonArray<WelderStampNaksPermit>(row.naksPermits),
    dlsPermits: parseJsonArray<WelderStampDlsPermit>(row.dlsPermits),
    archived: Boolean(row.archived),
    archivedAt: row.archivedAt ?? '',
  }
}
