import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

import { requireDb } from '@/db'
import { appSettings, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import {
  REQUEST_CONCLUSION_DEFAULT_SETTINGS,
  addRowsToNamingPatternContext,
  buildSystemNameWithNumber,
  getPstoConclusionDateParts,
  hasSystemDocumentNumberField,
  normalizeRequestConclusionSettings,
  type NamingPatternContext,
  type RequestConclusionSettings,
} from '@/lib/request-conclusion-settings'
import {
  SYSTEM_DOCUMENT_TYPES,
  buildSystemDocumentSummaries,
  getSystemDocumentNumber,
  isSystemDocumentType,
  type SystemDocumentType,
} from '@/lib/system-document-types'
import {
  SYSTEM_DOCUMENT_TEMPLATE_PROFILES,
  getSystemDocumentTemplateId,
  isSystemDocumentTemplateId,
  type SystemDocumentTemplateId,
} from '@/lib/system-document-template-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

export type SystemDocumentSequenceUpdate = {
  type: SystemDocumentType
  date: string
  methodCode?: string
  fieldKeys: WeldFieldKey[]
  provisionalName: string
}

type Db = ReturnType<typeof requireDb>
export type SystemDocumentSequenceTransaction = Parameters<Parameters<Db['transaction']>[0]>[0]

const LNK_REQUEST_KEYS = new Set<WeldFieldKey>(LNK_METHODS.map((method) => method.requestKey))

const SYSTEM_DOCUMENT_SEQUENCE_SELECT = {
  id: weldJoints.id,
  projectTitle: weldJoints.projectTitle,
  subtitleCode: weldJoints.subtitleCode,
  line: weldJoints.line,
  ...Object.fromEntries(
    LNK_METHODS.flatMap((method) => [
      [method.requestKey, weldJoints[method.requestKey]],
      [method.requestDateKey, weldJoints[method.requestDateKey]],
      [method.conclusionKey, weldJoints[method.conclusionKey]],
      [method.conclusionDateKey, weldJoints[method.conclusionDateKey]],
    ]),
  ),
  pstoRequest: weldJoints.pstoRequest,
  pstoRequestDate: weldJoints.pstoRequestDate,
  heatTreatmentDiagram: weldJoints.heatTreatmentDiagram,
  pstoDate: weldJoints.pstoDate,
}

export const getSystemDocumentSequences = createServerFn({ method: 'GET' }).handler(async () => {
  const db = requireDb()
  const stored = await readStoredSequenceNumbers(db)
  const needsInitialValues = SYSTEM_DOCUMENT_TEMPLATE_PROFILES.some(
    (profile) => stored[profile.id] === null,
  )
  const initial = needsInitialValues ? await readInitialSequenceNumbers(db) : null
  return Object.fromEntries(
    SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map((profile) => [
      profile.id,
      stored[profile.id] ?? initial?.[profile.id] ?? 1,
    ]),
  ) as Record<SystemDocumentTemplateId, number>
})

export const getSystemDocumentSequence = createServerFn({ method: 'GET' })
  .validator((data: { type: SystemDocumentTemplateId }) => ({
    type: requireSystemDocumentTemplateId(data?.type),
  }))
  .handler(async ({ data }) => {
    const db = requireDb()
    return {
      type: data.type,
      nextNumber: await readSystemDocumentNextNumber(db, data.type),
    }
  })

export const resetSystemDocumentSequence = createServerFn({ method: 'POST' })
  .validator((data: { type: SystemDocumentTemplateId }) => ({
    type: requireSystemDocumentTemplateId(data?.type),
  }))
  .handler(async ({ data }) => {
    const db = requireDb()
    await db.transaction(async (tx) => {
      await lockSystemDocumentNumberCounter(tx, data.type)
      await writeSystemDocumentNextNumber(tx, data.type, 1)
    })
    return { type: data.type, nextNumber: 1 }
  })

export function normalizeSystemDocumentSequenceUpdate(
  value: SystemDocumentSequenceUpdate,
): SystemDocumentSequenceUpdate {
  const type = requireSystemDocumentType(value?.type)
  const date = String(value?.date ?? '').trim().slice(0, 10)
  const methodCode = String(value?.methodCode ?? '').trim()
  const fieldKeys = Array.from(new Set(value?.fieldKeys ?? []))
  const provisionalName = String(value?.provisionalName ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Не указана дата системного документа.')
  }
  if (fieldKeys.length === 0) throw new Error('Не указано поле системного документа.')
  if (!provisionalName) throw new Error('Не указано предварительное имя системного документа.')

  if (type === 'lnkRequest') {
    if (fieldKeys.some((fieldKey) => !LNK_REQUEST_KEYS.has(fieldKey))) {
      throw new Error('Передано неизвестное поле заявки ЛНК.')
    }
  } else if (type === 'lnkConclusion') {
    const method = LNK_METHODS.find((candidate) => candidate.code === methodCode)
    if (!method || fieldKeys.length !== 1 || fieldKeys[0] !== method.conclusionKey) {
      throw new Error('Не указан вид контроля заключения ЛНК.')
    }
  } else if (type === 'pstoRequest') {
    if (fieldKeys.length !== 1 || fieldKeys[0] !== 'pstoRequest') {
      throw new Error('Передано неизвестное поле заявки ПСТО.')
    }
  } else if (fieldKeys.length !== 1 || fieldKeys[0] !== 'heatTreatmentDiagram') {
    throw new Error('Передано неизвестное поле заключения ПСТО.')
  }

  return {
    type,
    date,
    fieldKeys,
    provisionalName,
    ...(methodCode ? { methodCode } : {}),
  }
}

export function getInitialSystemDocumentSequenceNumbers(
  weldRows: Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>,
  settings: RequestConclusionSettings = REQUEST_CONCLUSION_DEFAULT_SETTINGS,
) {
  const summariesByType = new Map(
    SYSTEM_DOCUMENT_TYPES.map((type) => [
      type,
      buildSystemDocumentSummaries(weldRows, type),
    ] as const),
  )
  return Object.fromEntries(
    SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map((profile) => {
      const maxNumber = (summariesByType.get(profile.documentType) ?? [])
        .filter((reference) => getSystemDocumentTemplateId(reference) === profile.id)
        .reduce((currentMax, reference) => {
          const number = Number(getSystemDocumentNumber(reference, settings))
          return Number.isInteger(number) ? Math.max(currentMax, number) : currentMax
        }, 0)
      return [profile.id, maxNumber + 1]
    }),
  ) as Record<SystemDocumentTemplateId, number>
}

export async function reserveSystemDocumentName(
  tx: SystemDocumentSequenceTransaction,
  rawRequest: SystemDocumentSequenceUpdate,
  rows: Array<Partial<Pick<WeldRow, 'projectTitle' | 'subtitleCode' | 'line'>>> = [],
) {
  const request = normalizeSystemDocumentSequenceUpdate(rawRequest)
  const sequenceId = getSystemDocumentTemplateId(request)
  await lockSystemDocumentNumberCounter(tx, sequenceId)
  const settings = await readRequestConclusionSettings(tx)
  const pattern = settings[request.type].systemPattern
  if (!hasSystemDocumentNumberField(pattern)) {
    throw new Error(
      'В системном имени обязательно поле «Порядковый номер». Добавьте его в настройках заявок и заключений.',
    )
  }
  const context = createNamingContext(request, rows)
  let number = await readSystemDocumentNextNumber(tx, sequenceId)
  let name = buildSystemNameWithNumber(pattern, context, number)

  while (number < 1_000_000 && await systemDocumentNameExists(tx, request, name)) {
    number += 1
    name = buildSystemNameWithNumber(pattern, context, number)
  }

  await writeSystemDocumentNextNumber(tx, sequenceId, number + 1)
  return { name, number, request }
}

async function readSystemDocumentNextNumber(
  db: Pick<Db, 'select'>,
  sequenceId: SystemDocumentTemplateId,
) {
  const [setting] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, systemDocumentCounterKey(sequenceId)))
    .limit(1)
  const stored = parsePositiveIntegerSetting(setting?.value)
  if (stored) return stored
  const initial = await readInitialSequenceNumbers(db)
  return initial[sequenceId]
}

async function readStoredSequenceNumbers(db: Pick<Db, 'select'>) {
  const keys = SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map((profile) =>
    systemDocumentCounterKey(profile.id),
  )
  const settings = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, keys))
  const values = new Map(settings.map((setting) => [setting.key, parsePositiveIntegerSetting(setting.value)]))
  return Object.fromEntries(
    SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map((profile) => [
      profile.id,
      values.get(systemDocumentCounterKey(profile.id)) ?? null,
    ]),
  ) as Record<SystemDocumentTemplateId, number | null>
}

async function readInitialSequenceNumbers(db: Pick<Db, 'select'>) {
  const rows = await db.select(SYSTEM_DOCUMENT_SEQUENCE_SELECT).from(weldJoints)
  const settings = await readRequestConclusionSettings(db)
  const weldRows = rows as unknown as Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>
  return getInitialSystemDocumentSequenceNumbers(weldRows, settings)
}

async function readRequestConclusionSettings(db: Pick<Db, 'select'>): Promise<RequestConclusionSettings> {
  const [setting] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PROJECT_SETTING_KEYS.requestConclusion))
    .limit(1)
  if (!setting?.value) return REQUEST_CONCLUSION_DEFAULT_SETTINGS
  try {
    return normalizeRequestConclusionSettings(JSON.parse(setting.value))
  } catch {
    return REQUEST_CONCLUSION_DEFAULT_SETTINGS
  }
}

async function lockSystemDocumentNumberCounter(
  tx: Pick<SystemDocumentSequenceTransaction, 'execute'>,
  sequenceId: SystemDocumentTemplateId,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${systemDocumentCounterKey(sequenceId)}))`,
  )
}

async function writeSystemDocumentNextNumber(
  tx: Pick<SystemDocumentSequenceTransaction, 'insert'>,
  sequenceId: SystemDocumentTemplateId,
  nextNumber: number,
) {
  const value = JSON.stringify(Math.max(1, Math.floor(nextNumber)))
  await tx
    .insert(appSettings)
    .values({ key: systemDocumentCounterKey(sequenceId), value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: sql`now()` },
    })
}

async function systemDocumentNameExists(
  db: Pick<Db, 'select'>,
  request: SystemDocumentSequenceUpdate,
  name: string,
) {
  const where = buildSystemDocumentNameWhere(request, name)
  const [row] = await db.select({ id: weldJoints.id }).from(weldJoints).where(where).limit(1)
  return Boolean(row)
}

function buildSystemDocumentNameWhere(request: SystemDocumentSequenceUpdate, name: string): SQL {
  if (request.type === 'lnkRequest') {
    return or(...LNK_METHODS.map((method) => {
      return and(textEquals(weldJoints[method.requestKey], name), dateEquals(weldJoints[method.requestDateKey], request.date))!
    })) ?? sql`false`
  }
  if (request.type === 'lnkConclusion') {
    const method = LNK_METHODS.find((candidate) => candidate.code === request.methodCode)!
    return and(textEquals(weldJoints[method.conclusionKey], name), dateEquals(weldJoints[method.conclusionDateKey], request.date)) ?? sql`false`
  }
  if (request.type === 'pstoRequest') {
    return and(textEquals(weldJoints.pstoRequest, name), dateEquals(weldJoints.pstoRequestDate, request.date)) ?? sql`false`
  }
  return and(textEquals(weldJoints.heatTreatmentDiagram, name), dateEquals(weldJoints.pstoDate, request.date)) ?? sql`false`
}

function createNamingContext(
  request: SystemDocumentSequenceUpdate,
  rows: Array<Partial<Pick<WeldRow, 'projectTitle' | 'subtitleCode' | 'line'>>>,
): NamingPatternContext {
  if (request.type === 'pstoConclusion') {
    return addRowsToNamingPatternContext(getPstoConclusionDateParts(request.date), rows)
  }
  return addRowsToNamingPatternContext({
    date: new Date(`${request.date}T00:00:00`),
    ...(request.methodCode ? { methodCode: request.methodCode } : {}),
  }, rows)
}

function textEquals(column: SQLWrapper, value: string) {
  return sql`btrim(coalesce(${column}, '')) = ${value}`
}

function dateEquals(column: SQLWrapper, value: string) {
  return sql`coalesce(${column}::text, '') = ${value}`
}

function systemDocumentCounterKey(sequenceId: SystemDocumentTemplateId) {
  return `system-document-next-number:${sequenceId}`
}

function parsePositiveIntegerSetting(value: string | undefined) {
  if (!value) return null
  try {
    const parsed = Number(JSON.parse(value))
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  } catch {
    return null
  }
}

function requireSystemDocumentType(value: unknown): SystemDocumentType {
  if (!isSystemDocumentType(value)) throw new Error('Неизвестный тип системного документа.')
  return value
}

function requireSystemDocumentTemplateId(value: unknown): SystemDocumentTemplateId {
  if (!isSystemDocumentTemplateId(value)) {
    throw new Error('Неизвестный счетчик системного документа.')
  }
  return value
}
