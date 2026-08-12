import { eq, inArray } from 'drizzle-orm'

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

type Db = ReturnType<typeof requireDb>
type ValidationDb = Pick<Db, 'select'>

export type ServerWeldValidationContext = {
  saveCheckSettings: SaveCheckSettings
  dataListSettings: DataListSettings
  otherSettings: OtherSettings
  systemIndexSettings: SystemIndexSettings
  welderStamps: WelderStampRecord[]
  welderStampSuspensions: WelderStampSuspensionRecord[]
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
  const [settingRows, stampRows, suspensionRows] = await Promise.all([
    db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(inArray(appSettings.key, [
        PROJECT_SETTING_KEYS.saveCheck,
        PROJECT_SETTING_KEYS.dataList,
        PROJECT_SETTING_KEYS.other,
        PROJECT_SETTING_KEYS.systemIndex,
      ])),
    db.select().from(welderStamps),
    db.select().from(welderStampSuspensions),
  ])
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
  }
}

export function prepareServerWeldRecords({
  records,
  previousRows,
  context,
  importMode = false,
}: {
  records: WeldInput[]
  previousRows: ReadonlyMap<number, WeldJoint>
  context: ServerWeldValidationContext
  importMode?: boolean
}) {
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

export async function loadPreviousWeldRows(db: ValidationDb, records: WeldInput[]) {
  const ids = records
    .map((record) => Number(record.id))
    .filter((id) => Number.isInteger(id) && id > 0)
  if (ids.length === 0) return new Map<number, WeldJoint>()
  const rows = await db.select().from(weldJoints).where(inArray(weldJoints.id, [...new Set(ids)]))
  return new Map(rows.map((row) => [row.id, row]))
}

export function mergeWeldRecordsWithPrevious(
  records: WeldInput[],
  previousRows: ReadonlyMap<number, WeldJoint>,
) {
  return records.map((record) => {
    const previous = record.id ? previousRows.get(Number(record.id)) : undefined
    return previous
      ? ({ ...previous, ...record, id: previous.id } as WeldInput)
      : record
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
