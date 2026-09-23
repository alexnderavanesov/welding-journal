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
  id: SQLWrapper
  name: SQLWrapper
  date: SQLWrapper
  methodCode?: string
  predicate?: SQL
}

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
  const sourceQueries: SQL[] = []
  for (const [sequenceId, dates] of datesBySequence) {
    const orderedDates = [...dates].sort()
    for (const source of getSystemDocumentNameSources(sequenceId)) {
      sourceQueries.push(sql`
        select
          ${sequenceId}::text as "sequenceId",
          coalesce(${source.date}::text, '') as "date",
          btrim(coalesce(${source.name}, '')) as "name"
        from ${source.table}
        where ${source.date} = any(${sql.param(orderedDates)}::date[])
          and nullif(btrim(${source.name}), '') is not null
          ${source.predicate ? sql`and ${source.predicate}` : sql``}
      `)
    }
    sourceQueries.push(sql`
      select
        ${sequenceId}::text as "sequenceId",
        coalesce(${generatedDocuments.periodFrom}::text, '') as "date",
        btrim(coalesce(${generatedDocuments.title}, '')) as "name"
      from ${generatedDocuments}
      where ${generatedDocuments.type} = ${`system:${sequenceId}`}
        and ${generatedDocuments.periodFrom} = any(${sql.param(orderedDates)}::date[])
        and nullif(btrim(${generatedDocuments.title}), '') is not null
    `)
  }
  const occupiedNames = new Map<SystemDocumentTemplateId, Set<string>>()
  if (sourceQueries.length > 0) {
    const result = await db.execute(sql.join(sourceQueries, sql` union all `))
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
          id: weldJoints.id,
          name: weldJoints[method.requestKey],
          date: weldJoints[method.requestDateKey],
        })),
      {
        table: preHeatTreatmentControls,
        id: preHeatTreatmentControls.id,
        name: preHeatTreatmentControls.requestName,
        date: preHeatTreatmentControls.requestDate,
      },
    ]
  }
  if (sequenceId === 'tvmtRequest') {
    return [
      {
        table: weldJoints,
        id: weldJoints.id,
        name: weldJoints.tvmtRequest,
        date: weldJoints.tvmtRequestDate,
        methodCode: 'ТВМТ',
      },
      {
        table: pstoRepeatCycles,
        id: pstoRepeatCycles.id,
        name: pstoRepeatCycles.tvmtRequest,
        date: pstoRepeatCycles.tvmtRequestDate,
        methodCode: 'ТВМТ',
      },
    ]
  }
  if (sequenceId === 'pstoRequest') {
    return [
      { table: weldJoints, id: weldJoints.id, name: weldJoints.pstoRequest, date: weldJoints.pstoRequestDate },
      { table: pstoRepeatCycles, id: pstoRepeatCycles.id, name: pstoRepeatCycles.pstoRequest, date: pstoRepeatCycles.pstoRequestDate },
    ]
  }
  if (sequenceId === 'pstoConclusion') {
    return [
      { table: weldJoints, id: weldJoints.id, name: weldJoints.heatTreatmentDiagram, date: weldJoints.pstoDate },
      { table: pstoRepeatCycles, id: pstoRepeatCycles.id, name: pstoRepeatCycles.heatTreatmentDiagram, date: pstoRepeatCycles.pstoDate },
    ]
  }
  if (sequenceId === 'tvmtConclusion') {
    return [
      { table: weldJoints, id: weldJoints.id, name: weldJoints.tvmtConclusion, date: weldJoints.tvmtConclusionDate, methodCode: 'ТВМТ' },
      {
        table: pstoRepeatCycles,
        id: pstoRepeatCycles.id,
        name: pstoRepeatCycles.tvmtConclusion,
        date: pstoRepeatCycles.tvmtConclusionDate,
        methodCode: 'ТВМТ',
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
        id: weldJoints.id,
        name: weldJoints[method.conclusionKey],
        date: weldJoints[method.conclusionDateKey],
        methodCode: method.code,
      },
      {
        table: preHeatTreatmentControls,
        id: preHeatTreatmentControls.id,
        name: preHeatTreatmentControls.conclusionName,
        date: preHeatTreatmentControls.conclusionDate,
        methodCode: method.code,
        predicate: sql`${preHeatTreatmentControls.method} = ${method.code}`,
      },
    ])
}

function systemDocumentNameKey(date: string, name: string) {
  return `${date}\u0000${name}`
}

export async function readSystemDocumentNextNumber(
  db: Pick<SystemDocumentSequenceTransaction, 'select' | 'execute'>,
  sequenceId: SystemDocumentTemplateId,
) {
  const [setting] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, systemDocumentCounterKey(sequenceId)))
    .limit(1)
  const stored = parsePositiveIntegerSetting(setting?.value)
  if (stored) return stored
  const initial = await readInitialSequenceNumbers(db, [sequenceId])
  return initial[sequenceId]
}

export async function readSystemDocumentNextNumbers<SequenceId extends SystemDocumentTemplateId>(
  db: Pick<Db, 'select' | 'execute'>,
  sequenceIds: readonly SequenceId[],
): Promise<Record<SequenceId, number>> {
  const requestedIds = [...new Set(sequenceIds)].sort()
  const stored = await readStoredSequenceNumbers(db)
  const missingIds = requestedIds.filter((sequenceId) => stored[sequenceId] == null)
  const initial = missingIds.length > 0 ? await readInitialSequenceNumbers(db, missingIds) : null
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
    const initial = currentMissingIds.length > 0
      ? await readInitialSequenceNumbers(tx, currentMissingIds)
      : null
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

export async function readInitialSequenceNumbers(
  db: Pick<Db, 'select' | 'execute'>,
  sequenceIds: readonly SystemDocumentTemplateId[],
) {
  const settings = await readRequestConclusionSettings(db)
  const requestedIds = [...new Set(sequenceIds)]
  const query = buildInitialSystemDocumentSequenceQuery(settings, requestedIds)
  const result = query ? await db.execute(query) : { rows: [] }
  const maximums = new Map(
    result.rows.map((rawRow) => {
      const row = rawRow as { sequenceId?: unknown; maxNumber?: unknown }
      return [String(row.sequenceId ?? ''), Number(row.maxNumber)] as const
    }),
  )
  return Object.fromEntries(requestedIds.map((sequenceId) => {
    const maximum = maximums.get(sequenceId)
    return [
      sequenceId,
      Number.isSafeInteger(maximum) && Number(maximum) > 0 ? Number(maximum) + 1 : 1,
    ]
  })) as Record<SystemDocumentTemplateId, number>
}

export function buildInitialSystemDocumentSequenceQuery(
  settings: RequestConclusionSettings,
  sequenceIds: readonly SystemDocumentTemplateId[],
) {
  const entriesByTable = new Map<SQLWrapper, SQL[]>()
  let sourceKey = 0
  for (const sequenceId of [...new Set(sequenceIds)]) {
    for (const source of getSystemDocumentNameSources(sequenceId)) {
      sourceKey += 1
      const patterns = getSystemDocumentNumberPatterns(settings, sequenceId, source.methodCode)
      const entries = entriesByTable.get(source.table) ?? []
      for (const pattern of patterns) {
        entries.push(sql`(
          ${source.id}::bigint,
          ${sourceKey}::integer,
          btrim(coalesce(${source.name}::text, '')),
          ${sequenceId}::text,
          ${buildSystemDocumentNumberRegex(pattern, source.date, source.methodCode)},
          ${getSystemDocumentPatternLiteralPrefix(pattern)}::text,
          (${source.predicate ?? sql`true`})::boolean
        )`)
      }
      if (entries.length > 0) entriesByTable.set(source.table, entries)
    }
  }
  const tableQueries = [...entriesByTable].map(([table, entries]) => sql`
    select
      "source_numbers"."sequenceId",
      max("source_numbers"."documentNumber") as "maxNumber"
    from (
      select
        "sources"."sequenceId",
        "sources"."sourceId",
        "sources"."sourceKey",
        min(
          case
            when char_length(("matched"."parts")[1]) <= 16
              and (("matched"."parts")[1])::numeric between 1 and 9007199254740991
            then (("matched"."parts")[1])::numeric
            else null
          end
        ) as "documentNumber"
      from ${table}
      cross join lateral (values ${sql.join(entries, sql`, `)}) as "sources"(
        "sourceId",
        "sourceKey",
        "name",
        "sequenceId",
        "pattern",
        "literalPrefix",
        "eligible"
      )
      cross join lateral regexp_match(
        "sources"."name",
        "sources"."pattern"
      ) as "matched"("parts")
      where "sources"."eligible"
        and nullif("sources"."name", '') is not null
        and starts_with("sources"."name", "sources"."literalPrefix")
      group by "sources"."sequenceId", "sources"."sourceId", "sources"."sourceKey"
    ) as "source_numbers"
    group by "source_numbers"."sequenceId"
  `)
  if (tableQueries.length === 0) return null
  return sql`
    select "sequence_maximums"."sequenceId", max("sequence_maximums"."maxNumber") as "maxNumber"
    from (${sql.join(tableQueries, sql` union all `)}) as "sequence_maximums"
    group by "sequence_maximums"."sequenceId"
  `
}

function getSystemDocumentNumberPatterns(
  settings: RequestConclusionSettings,
  sequenceId: SystemDocumentTemplateId,
  methodCode?: string,
) {
  const type = sequenceId === 'pstoRequest' || sequenceId === 'pstoConclusion'
    ? sequenceId
    : sequenceId === 'lnkRequest' || sequenceId === 'tvmtRequest'
      ? 'lnkRequest'
      : 'lnkConclusion'
  const namingKind = getRequestConclusionNamingKind({ type, methodCode })
  const namingSettings = settings[namingKind]
  return [...new Set([
    namingSettings.systemPattern,
    ...(namingSettings.systemPatternHistory ?? []),
    REQUEST_CONCLUSION_DEFAULT_SETTINGS[namingKind].systemPattern,
  ])].filter(hasSystemDocumentNumberField)
}

function buildSystemDocumentNumberRegex(
  pattern: string,
  dateColumn: SQLWrapper,
  methodCode?: string,
) {
  const parts: SQL[] = [sql`${'^'}::text`]
  const tokenPattern = /\{\{\s*([^{}]+?)\s*\}\}/g
  let cursor = 0
  for (const match of pattern.matchAll(tokenPattern)) {
    const matchIndex = match.index ?? cursor
    appendSystemDocumentRegexLiteral(parts, pattern.slice(cursor, matchIndex))
    const token = match[1].trim().toLocaleLowerCase('ru-RU')
    if (token === 'дата') {
      parts.push(buildSystemDocumentDateRegex(dateColumn, false))
    } else if (token === 'датакороткая' || token === 'короткая дата') {
      parts.push(buildSystemDocumentDateRegex(dateColumn, true))
    } else if (token === 'метод') {
      appendSystemDocumentRegexLiteral(parts, methodCode ?? '')
    } else if (token === '№' || token === 'номер') {
      parts.push(sql`${'([0-9]+)'}::text`)
    } else if (token === 'проект' || token === 'шифр' || token === 'линия') {
      parts.push(sql`${'.*?'}::text`)
    }
    cursor = matchIndex + match[0].length
  }
  appendSystemDocumentRegexLiteral(parts, pattern.slice(cursor))
  parts.push(sql`${'$'}::text`)
  return sql`concat(${sql.join(parts, sql`, `)})`
}

function getSystemDocumentPatternLiteralPrefix(pattern: string) {
  const tokenIndex = pattern.search(/\{\{\s*[^{}]+?\s*\}\}/)
  return tokenIndex < 0 ? pattern : pattern.slice(0, tokenIndex)
}

function buildSystemDocumentDateRegex(dateColumn: SQLWrapper, short: boolean) {
  const date = sql`coalesce(${dateColumn}::date, current_date)`
  return sql`concat(
    to_char(${date}, 'DD'),
    ${'\\.'}::text,
    to_char(${date}, 'MM'),
    ${'\\.'}::text,
    to_char(${date}, ${short ? 'YY' : 'YYYY'}::text)
  )`
}

function appendSystemDocumentRegexLiteral(parts: SQL[], value: string) {
  if (!value) return
  parts.push(sql`${value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}::text`)
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
