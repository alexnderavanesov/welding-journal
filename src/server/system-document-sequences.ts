import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

import { requireDb } from '@/db'
import {
  appSettings,
  generatedDocuments,
  preHeatTreatmentControls,
  pstoRepeatCycles,
  weldJoints,
} from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { ALL_LNK_FIELD_METHODS as LNK_METHODS } from '@/lib/lnk-report-config'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import {
  REQUEST_CONCLUSION_DEFAULT_SETTINGS,
  addRowsToNamingPatternContext,
  buildSystemNameWithNumber,
  getPstoConclusionDateParts,
  getRequestConclusionNamingKind,
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
import {
  buildPreHeatTreatmentSystemDocumentRow,
  buildPstoRepeatSystemDocumentRow,
} from '@/lib/system-document-virtual-row'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { assertSecurityScope } from '@/server/security-functions'

export type SystemDocumentSequenceUpdate = {
  type: SystemDocumentType
  date: string
  methodCode?: string
  fieldKeys: WeldFieldKey[]
  provisionalName: string
}

export type ReservedSystemDocumentName = {
  name: string
  request: SystemDocumentSequenceUpdate
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
  await assertSecurityScope('entry')
  const db = requireDb()
  return readAndInitializeSystemDocumentSequenceNumbers(
    db,
    SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map((profile) => profile.id),
  )
})

export const getSystemDocumentSequence = createServerFn({ method: 'GET' })
  .validator((data: { type: SystemDocumentTemplateId }) => ({
    type: requireSystemDocumentTemplateId(data?.type),
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    const db = requireDb()
    const sequences = await readAndInitializeSystemDocumentSequenceNumbers(db, [data.type])
    return {
      type: data.type,
      nextNumber: sequences[data.type],
    }
  })

export const resetSystemDocumentSequence = createServerFn({ method: 'POST' })
  .validator((data: { type: SystemDocumentTemplateId }) => ({
    type: requireSystemDocumentTemplateId(data?.type),
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('settings')
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
    const isTvmtRequest = fieldKeys.length === 1 && fieldKeys[0] === 'tvmtRequest'
    if (isTvmtRequest !== (methodCode === 'ТВМТ')) {
      throw new Error('Заявка ТВМТ должна иметь отдельный вид контроля.')
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

export function applyReservedSystemDocumentNames<
  Row extends Partial<Record<WeldFieldKey, unknown>>,
>(
  records: Row[],
  reservations: ReservedSystemDocumentName[],
) {
  return records.map((record) => {
    let nextRecord = record
    for (const reservation of reservations) {
      for (const fieldKey of reservation.request.fieldKeys) {
        if (
          String(record[fieldKey] ?? '').trim() !==
          reservation.request.provisionalName
        ) continue
        nextRecord = { ...nextRecord, [fieldKey]: reservation.name }
      }
    }
    return nextRecord
  })
}

export function getInitialSystemDocumentSequenceNumbers(
  weldRows: Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>,
  settings: RequestConclusionSettings = REQUEST_CONCLUSION_DEFAULT_SETTINGS,
) {
  const documentRows = weldRows.flatMap((row) => [
    row,
    ...(row.preHeatTreatmentControls?.length
      ? [buildPreHeatTreatmentSystemDocumentRow(
          row as WeldRow,
          row.preHeatTreatmentControls,
        )]
      : []),
    ...(row.pstoRepeatCycles ?? []).map((cycle) =>
      buildPstoRepeatSystemDocumentRow(row as WeldRow, cycle),
    ),
  ])
  const summariesByType = new Map(
    SYSTEM_DOCUMENT_TYPES.map((type) => [
      type,
      buildSystemDocumentSummaries(documentRows, type),
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
  const pattern = settings[getRequestConclusionNamingKind(request)].systemPattern
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

export async function readSystemDocumentNextNumber(
  db: Pick<SystemDocumentSequenceTransaction, 'select'>,
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

async function readAndInitializeSystemDocumentSequenceNumbers<SequenceId extends SystemDocumentTemplateId>(
  db: Db,
  sequenceIds: readonly SequenceId[],
): Promise<Record<SequenceId, number>> {
  const requestedIds = Array.from(new Set(sequenceIds)).sort()
  const stored = await readStoredSequenceNumbers(db)
  const missingIds = requestedIds.filter((sequenceId) => stored[sequenceId] === null)
  if (missingIds.length === 0) {
    return Object.fromEntries(
      requestedIds.map((sequenceId) => [sequenceId, stored[sequenceId] ?? 1]),
    ) as Record<SequenceId, number>
  }

  return db.transaction(async (tx) => {
    for (const sequenceId of missingIds) await lockSystemDocumentNumberCounter(tx, sequenceId)
    const currentStored = await readStoredSequenceNumbers(tx)
    const currentMissingIds = requestedIds.filter((sequenceId) => currentStored[sequenceId] === null)
    const initial = currentMissingIds.length > 0 ? await readInitialSequenceNumbers(tx) : null
    for (const sequenceId of currentMissingIds) {
      await writeSystemDocumentNextNumber(tx, sequenceId, initial?.[sequenceId] ?? 1)
    }
    return Object.fromEntries(
      requestedIds.map((sequenceId) => [
        sequenceId,
        currentStored[sequenceId] ?? initial?.[sequenceId] ?? 1,
      ]),
    ) as Record<SequenceId, number>
  })
}

async function readInitialSequenceNumbers(db: Pick<Db, 'select'>) {
  const rows = await db.select(SYSTEM_DOCUMENT_SEQUENCE_SELECT).from(weldJoints)
  const preControls = await db.select().from(preHeatTreatmentControls)
  const repeatCycles = await db.select().from(pstoRepeatCycles)
  const settings = await readRequestConclusionSettings(db)
  const preControlsByWeldJointId = new Map<number, typeof preControls>()
  for (const control of preControls) {
    const current = preControlsByWeldJointId.get(control.weldJointId) ?? []
    current.push(control)
    preControlsByWeldJointId.set(control.weldJointId, current)
  }
  const repeatCyclesByWeldJointId = new Map<number, typeof repeatCycles>()
  for (const cycle of repeatCycles) {
    const current = repeatCyclesByWeldJointId.get(cycle.weldJointId) ?? []
    current.push(cycle)
    repeatCyclesByWeldJointId.set(cycle.weldJointId, current)
  }
  const weldRows = rows.map((row) => ({
    ...row,
    preHeatTreatmentControls: preControlsByWeldJointId.get(row.id) ?? [],
    pstoRepeatCycles: repeatCyclesByWeldJointId.get(row.id) ?? [],
  })) as unknown as Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>
  return getInitialSystemDocumentSequenceNumbers(weldRows, settings)
}

export async function readRequestConclusionSettings(
  db: Pick<SystemDocumentSequenceTransaction, 'select'>,
): Promise<RequestConclusionSettings> {
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

export async function lockSystemDocumentNumberCounter(
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
  if (row) return true
  const preControlWhere = buildPreHeatTreatmentSystemDocumentNameWhere(request, name)
  if (preControlWhere) {
    const [preControl] = await db
      .select({ id: preHeatTreatmentControls.id })
      .from(preHeatTreatmentControls)
      .where(preControlWhere)
      .limit(1)
    if (preControl) return true
  }
  const repeatCycleWhere = buildPstoRepeatSystemDocumentNameWhere(request, name)
  if (repeatCycleWhere) {
    const [repeatCycle] = await db
      .select({ id: pstoRepeatCycles.id })
      .from(pstoRepeatCycles)
      .where(repeatCycleWhere)
      .limit(1)
    if (repeatCycle) return true
  }
  const [indexedDocument] = await db
    .select({ id: generatedDocuments.id })
    .from(generatedDocuments)
    .where(and(
      eq(generatedDocuments.type, `system:${getSystemDocumentTemplateId(request)}`),
      eq(generatedDocuments.title, name),
      sql`coalesce(${generatedDocuments.periodFrom}::text, '') = ${request.date}`,
    ))
    .limit(1)
  return Boolean(indexedDocument)
}

function buildSystemDocumentNameWhere(request: SystemDocumentSequenceUpdate, name: string): SQL {
  if (request.type === 'lnkRequest') {
    const requestMethods = request.methodCode === 'ТВМТ'
      ? LNK_METHODS.filter((method) => method.code === 'ТВМТ')
      : LNK_METHODS.filter((method) => method.code !== 'ТВМТ')
    return or(...requestMethods.map((method) => {
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

function buildPreHeatTreatmentSystemDocumentNameWhere(
  request: SystemDocumentSequenceUpdate,
  name: string,
): SQL | null {
  if (request.type === 'lnkRequest' && request.methodCode !== 'ТВМТ') {
    return and(
      textEquals(preHeatTreatmentControls.requestName, name),
      dateEquals(preHeatTreatmentControls.requestDate, request.date),
    ) ?? sql`false`
  }
  if (request.type === 'lnkConclusion') {
    const methodCode = request.methodCode
    if (!methodCode || methodCode === 'ТВМТ') return null
    return and(
      eq(preHeatTreatmentControls.method, methodCode),
      textEquals(preHeatTreatmentControls.conclusionName, name),
      dateEquals(preHeatTreatmentControls.conclusionDate, request.date),
    ) ?? sql`false`
  }
  return null
}

function buildPstoRepeatSystemDocumentNameWhere(
  request: SystemDocumentSequenceUpdate,
  name: string,
): SQL | null {
  if (request.type === 'lnkRequest' && request.methodCode === 'ТВМТ') {
    return and(
      textEquals(pstoRepeatCycles.tvmtRequest, name),
      dateEquals(pstoRepeatCycles.tvmtRequestDate, request.date),
    ) ?? sql`false`
  }
  if (request.type === 'lnkConclusion' && request.methodCode === 'ТВМТ') {
    return and(
      textEquals(pstoRepeatCycles.tvmtConclusion, name),
      dateEquals(pstoRepeatCycles.tvmtConclusionDate, request.date),
    ) ?? sql`false`
  }
  if (request.type === 'pstoRequest') {
    return and(
      textEquals(pstoRepeatCycles.pstoRequest, name),
      dateEquals(pstoRepeatCycles.pstoRequestDate, request.date),
    ) ?? sql`false`
  }
  if (request.type === 'pstoConclusion') {
    return and(
      textEquals(pstoRepeatCycles.heatTreatmentDiagram, name),
      dateEquals(pstoRepeatCycles.pstoDate, request.date),
    ) ?? sql`false`
  }
  return null
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
