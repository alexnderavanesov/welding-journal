import { createServerFn } from '@tanstack/react-start'
import { eq, inArray, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

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

export type SystemDocumentNameReservationInput = {
  request: SystemDocumentSequenceUpdate
  rows?: Array<Partial<Pick<WeldRow, 'projectTitle' | 'subtitleCode' | 'line'>>>
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
  const [reservation] = await reserveSystemDocumentNames(tx, [{ request: rawRequest, rows }])
  return reservation
}

export async function reserveSystemDocumentNames(
  tx: SystemDocumentSequenceTransaction,
  rawInputs: readonly SystemDocumentNameReservationInput[],
  options: {
    countersAlreadyLocked?: boolean
    occupiedNumbersBySequence?: ReadonlyMap<SystemDocumentTemplateId, ReadonlySet<number>>
  } = {},
) {
  if (rawInputs.length === 0) return []
  const inputs = rawInputs.map((input) => ({
    request: normalizeSystemDocumentSequenceUpdate(input.request),
    rows: input.rows ?? [],
  }))
  const sequenceIds = [...new Set(inputs.map(({ request }) => getSystemDocumentTemplateId(request)))].sort()
  if (!options.countersAlreadyLocked) {
    for (const sequenceId of sequenceIds) {
      await lockSystemDocumentNumberCounter(tx, sequenceId)
    }
  }
  const settings = await readRequestConclusionSettings(tx)
  const nextNumberBySequence = new Map<SystemDocumentTemplateId, number>()
  for (const sequenceId of sequenceIds) {
    nextNumberBySequence.set(sequenceId, await readSystemDocumentNextNumber(tx, sequenceId))
  }
  const occupiedNamesBySequence = await loadExistingSystemDocumentNameKeys(
    tx,
    inputs.map(({ request }) => request),
  )
  const occupiedNumbersBySequence = new Map(
    [...(options.occupiedNumbersBySequence ?? new Map())].map(([sequenceId, numbers]) => [
      sequenceId,
      new Set(numbers),
    ]),
  )
  const reservations: Array<ReservedSystemDocumentName & { number: number }> = []

  for (const { request, rows } of inputs) {
    const sequenceId = getSystemDocumentTemplateId(request)
    const pattern = settings[getRequestConclusionNamingKind(request)].systemPattern
    if (!hasSystemDocumentNumberField(pattern)) {
      throw new Error(
        'В системном имени обязательно поле «Порядковый номер». Добавьте его в настройках заявок и заключений.',
      )
    }
    const context = createNamingContext(request, rows)
    const occupiedNames = occupiedNamesBySequence.get(sequenceId) ?? new Set<string>()
    const occupiedNumbers = occupiedNumbersBySequence.get(sequenceId) ?? new Set<number>()
    occupiedNamesBySequence.set(sequenceId, occupiedNames)
    occupiedNumbersBySequence.set(sequenceId, occupiedNumbers)
    let number = nextNumberBySequence.get(sequenceId) ?? 1
    let name = buildSystemNameWithNumber(pattern, context, number)

    while (
      number < 1_000_000 &&
      (occupiedNumbers.has(number) || occupiedNames.has(systemDocumentNameKey(request.date, name)))
    ) {
      number += 1
      name = buildSystemNameWithNumber(pattern, context, number)
    }
    if (occupiedNumbers.has(number) || occupiedNames.has(systemDocumentNameKey(request.date, name))) {
      throw new Error('Не удалось назначить уникальный порядковый номер системного документа.')
    }
    occupiedNames.add(systemDocumentNameKey(request.date, name))
    occupiedNumbers.add(number)
    nextNumberBySequence.set(sequenceId, number + 1)
    reservations.push({ name, number, request })
  }

  for (const sequenceId of sequenceIds) {
    await writeSystemDocumentNextNumber(tx, sequenceId, nextNumberBySequence.get(sequenceId) ?? 1)
  }
  return reservations
}

type SystemDocumentNameSource = {
  table: SQLWrapper
  name: SQLWrapper
  date: SQLWrapper
  predicate?: SQL
}

const SYSTEM_DOCUMENT_NAME_DATE_BATCH_SIZE = 1_000
const SYSTEM_DOCUMENT_NAME_QUERY_PARAMETER_BUDGET = 10_000

export async function loadExistingSystemDocumentNameKeys(
  db: Pick<SystemDocumentSequenceTransaction, 'execute'>,
  requests: readonly SystemDocumentSequenceUpdate[],
) {
  const datesBySequence = new Map<SystemDocumentTemplateId, Set<string>>()
  for (const request of requests) {
    const sequenceId = getSystemDocumentTemplateId(request)
    const dates = datesBySequence.get(sequenceId) ?? new Set<string>()
    dates.add(request.date)
    datesBySequence.set(sequenceId, dates)
  }
  const sourceQueryBatches: SQL[][] = []
  let sourceQueries: SQL[] = []
  let estimatedParameterCount = 0
  const appendSourceQuery = (query: SQL, parameterCount: number) => {
    if (
      sourceQueries.length > 0 &&
      estimatedParameterCount + parameterCount > SYSTEM_DOCUMENT_NAME_QUERY_PARAMETER_BUDGET
    ) {
      sourceQueryBatches.push(sourceQueries)
      sourceQueries = []
      estimatedParameterCount = 0
    }
    sourceQueries.push(query)
    estimatedParameterCount += parameterCount
  }
  for (const [sequenceId, dates] of datesBySequence) {
    const orderedDates = [...dates].sort()
    for (let offset = 0; offset < orderedDates.length; offset += SYSTEM_DOCUMENT_NAME_DATE_BATCH_SIZE) {
      const dateBatch = orderedDates.slice(offset, offset + SYSTEM_DOCUMENT_NAME_DATE_BATCH_SIZE)
      for (const source of getSystemDocumentNameSources(sequenceId)) {
        const dateValues = sql.join(dateBatch.map((date) => sql`${date}`), sql`, `)
        appendSourceQuery(sql`
          select
            ${sequenceId}::text as "sequenceId",
            coalesce(${source.date}::text, '') as "date",
            btrim(coalesce(${source.name}, '')) as "name"
          from ${source.table}
          where ${source.date} in (${dateValues})
            and nullif(btrim(${source.name}), '') is not null
            ${source.predicate ? sql`and ${source.predicate}` : sql``}
        `, dateBatch.length + 2)
      }
      const generatedDateValues = sql.join(dateBatch.map((date) => sql`${date}`), sql`, `)
      appendSourceQuery(sql`
        select
          ${sequenceId}::text as "sequenceId",
          coalesce(${generatedDocuments.periodFrom}::text, '') as "date",
          btrim(coalesce(${generatedDocuments.title}, '')) as "name"
        from ${generatedDocuments}
        where ${generatedDocuments.type} = ${`system:${sequenceId}`}
          and ${generatedDocuments.periodFrom} in (${generatedDateValues})
          and nullif(btrim(${generatedDocuments.title}), '') is not null
      `, dateBatch.length + 3)
    }
  }
  if (sourceQueries.length > 0) sourceQueryBatches.push(sourceQueries)
  const occupiedNames = new Map<SystemDocumentTemplateId, Set<string>>()
  for (const queryBatch of sourceQueryBatches) {
    const result = await db.execute(sql.join(queryBatch, sql` union all `))
    for (const rawRow of result.rows) {
      const row = rawRow as { sequenceId?: unknown; date?: unknown; name?: unknown }
      const sequenceId = String(row.sequenceId ?? '') as SystemDocumentTemplateId
      if (!isSystemDocumentTemplateId(sequenceId)) continue
      const names = occupiedNames.get(sequenceId) ?? new Set<string>()
      names.add(systemDocumentNameKey(String(row.date ?? ''), String(row.name ?? '')))
      occupiedNames.set(sequenceId, names)
    }
  }
  return occupiedNames
}

function getSystemDocumentNameSources(sequenceId: SystemDocumentTemplateId): SystemDocumentNameSource[] {
  if (sequenceId === 'lnkRequest') {
    return [
      ...LNK_METHODS
        .filter((method) => method.code !== 'ТВМТ')
        .map((method) => ({
          table: weldJoints,
          name: weldJoints[method.requestKey],
          date: weldJoints[method.requestDateKey],
        })),
      {
        table: preHeatTreatmentControls,
        name: preHeatTreatmentControls.requestName,
        date: preHeatTreatmentControls.requestDate,
      },
    ]
  }
  if (sequenceId === 'tvmtRequest') {
    return [
      {
        table: weldJoints,
        name: weldJoints.tvmtRequest,
        date: weldJoints.tvmtRequestDate,
      },
      {
        table: pstoRepeatCycles,
        name: pstoRepeatCycles.tvmtRequest,
        date: pstoRepeatCycles.tvmtRequestDate,
      },
    ]
  }
  if (sequenceId === 'pstoRequest') {
    return [
      { table: weldJoints, name: weldJoints.pstoRequest, date: weldJoints.pstoRequestDate },
      { table: pstoRepeatCycles, name: pstoRepeatCycles.pstoRequest, date: pstoRepeatCycles.pstoRequestDate },
    ]
  }
  if (sequenceId === 'pstoConclusion') {
    return [
      { table: weldJoints, name: weldJoints.heatTreatmentDiagram, date: weldJoints.pstoDate },
      { table: pstoRepeatCycles, name: pstoRepeatCycles.heatTreatmentDiagram, date: pstoRepeatCycles.pstoDate },
    ]
  }
  if (sequenceId === 'tvmtConclusion') {
    return [
      { table: weldJoints, name: weldJoints.tvmtConclusion, date: weldJoints.tvmtConclusionDate },
      {
        table: pstoRepeatCycles,
        name: pstoRepeatCycles.tvmtConclusion,
        date: pstoRepeatCycles.tvmtConclusionDate,
      },
    ]
  }
  return LNK_METHODS
    .filter((method) => getSystemDocumentTemplateId({
      type: 'lnkConclusion',
      methodCode: method.code,
    }) === sequenceId)
    .flatMap((method) => [
      {
        table: weldJoints,
        name: weldJoints[method.conclusionKey],
        date: weldJoints[method.conclusionDateKey],
      },
      {
        table: preHeatTreatmentControls,
        name: preHeatTreatmentControls.conclusionName,
        date: preHeatTreatmentControls.conclusionDate,
        predicate: sql`${preHeatTreatmentControls.method} = ${method.code}`,
      },
    ])
}

function systemDocumentNameKey(date: string, name: string) {
  return `${date}\u0000${name}`
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

export async function readSystemDocumentNextNumbers<SequenceId extends SystemDocumentTemplateId>(
  db: Pick<Db, 'select'>,
  sequenceIds: readonly SequenceId[],
): Promise<Record<SequenceId, number>> {
  const requestedIds = [...new Set(sequenceIds)].sort()
  const stored = await readStoredSequenceNumbers(db)
  const missingIds = requestedIds.filter((sequenceId) => stored[sequenceId] == null)
  const initial = missingIds.length > 0 ? await readInitialSequenceNumbers(db) : null
  return Object.fromEntries(requestedIds.map((sequenceId) => [
    sequenceId,
    stored[sequenceId] ?? initial?.[sequenceId] ?? 1,
  ])) as Record<SequenceId, number>
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
