import { normalizeDateLikeForStorage, parseDateLikeToIso } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { hasRejectedLnkResult } from '@/lib/lnk-status'
import {
  createRequestDocumentIdentity,
  getLnkRequestDocumentIdentities,
  isSameRequestDocument,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'
import {
  hasText,
  isEnabledControlValue,
  isPendingLnkResultValue,
} from '@/lib/report-value-utils'
import { hasCompletedLnkRequestPosition } from '@/lib/report-control-state'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export type LnkRequestExtensionTarget = {
  rowId: number
  methodKey: WeldFieldKey
}

export type LnkRequestExtensionRequest = {
  requestName: string
  requestDate: string
  targets: LnkRequestExtensionTarget[]
}

export type LnkRequestExtensionIssue = {
  rowId: number
  methodKey: WeldFieldKey
  methodCode: string
  reason: string
}

export type LnkRequestExtensionAnalysis = {
  targets: LnkRequestExtensionTarget[]
  issues: LnkRequestExtensionIssue[]
}

export type LnkRequestExtensionOption = RequestDocumentIdentity & {
  rowCount: number
  positionCount: number
  methodCodes: string[]
  searchText: string
  disabledReason: string | null
}

export function normalizeLnkRequestExtensionRequest(value: LnkRequestExtensionRequest) {
  const requestName = String(value?.requestName ?? '').trim()
  const requestDate = normalizeDateLikeForStorage(value?.requestDate) ?? ''
  const targets = Array.isArray(value?.targets)
    ? value.targets.map((target) => ({
        rowId: Number(target?.rowId),
        methodKey: String(target?.methodKey ?? '') as WeldFieldKey,
      }))
    : []

  if (!requestName) throw new Error('Выберите существующую заявку ЛНК.')
  if (!parseDateLikeToIso(requestDate)) throw new Error('У существующей заявки не указана корректная дата.')
  if (targets.length === 0) throw new Error('Нет позиций для добавления в существующую заявку ЛНК.')

  const knownMethodKeys = new Set<WeldFieldKey>(LNK_METHODS.map((method) => method.requestKey))
  const uniqueTargets = new Set<string>()
  for (const target of targets) {
    const targetKey = `${target.rowId}:${target.methodKey}`
    if (
      !Number.isInteger(target.rowId) ||
      target.rowId <= 0 ||
      !knownMethodKeys.has(target.methodKey) ||
      uniqueTargets.has(targetKey)
    ) {
      throw new Error('Передан повторный или некорректный набор позиций заявки ЛНК.')
    }
    uniqueTargets.add(targetKey)
  }

  return { requestName, requestDate, targets } satisfies LnkRequestExtensionRequest
}

export function getLnkRequestExtensionOptions(rows: WeldRow[]): LnkRequestExtensionOption[] {
  const summaries = new Map<string, {
    rowIds: Set<number>
    positionCount: number
    methodCodes: Set<string>
    searchValues: Set<string>
    completedPosition?: ReturnType<typeof getLnkRequestPositions>[number]
  }>()

  for (const row of rows) {
    for (const method of LNK_METHODS) {
      const identity = createRequestDocumentIdentity(row[method.requestKey], row[method.requestDateKey])
      if (!identity) continue
      const summary = summaries.get(identity.key) ?? {
        rowIds: new Set<number>(),
        positionCount: 0,
        methodCodes: new Set<string>(),
        searchValues: new Set<string>(),
      }
      summary.rowIds.add(row.id)
      summary.positionCount += 1
      summary.methodCodes.add(method.code)
      for (const value of [row.projectTitle, row.subtitleCode, row.line, row.spool, row.joint]) {
        const text = String(value ?? '').trim()
        if (text) summary.searchValues.add(text.toLocaleLowerCase('ru'))
      }
      if (!summary.completedPosition && hasCompletedLnkRequestPosition(row, method)) {
        summary.completedPosition = { row, method }
      }
      summaries.set(identity.key, summary)
    }
  }

  return getLnkRequestDocumentIdentities(rows).map((identity) => {
    const summary = summaries.get(identity.key)
    return {
      ...identity,
      rowCount: summary?.rowIds.size ?? 0,
      positionCount: summary?.positionCount ?? 0,
      methodCodes: [...(summary?.methodCodes ?? [])],
      searchText: [...(summary?.searchValues ?? [])].join(' '),
      disabledReason: getLnkRequestExtensionIdentityDisabledReason(identity, summary?.completedPosition),
    }
  })
}

export function getLnkRequestExtensionDisabledReason(
  rows: WeldInput[],
  identity: Pick<RequestDocumentIdentity, 'name' | 'date'>,
) {
  const positions = getLnkRequestPositions(rows, identity)
  if (positions.length === 0) return 'Заявка больше не существует. Обновите список заявок.'
  return getLnkRequestExtensionIdentityDisabledReason(
    identity,
    positions.find(({ row, method }) => hasCompletedLnkRequestPosition(row, method)),
  )
}

export function analyzeLnkRequestExtensionTargets({
  rows,
  methodKeys,
  requestName,
  requestDate,
}: {
  rows: WeldInput[]
  methodKeys: WeldFieldKey[]
  requestName: string
  requestDate: string
}): LnkRequestExtensionAnalysis {
  const targets: LnkRequestExtensionTarget[] = []
  const issues: LnkRequestExtensionIssue[] = []
  const methods = methodKeys.flatMap((methodKey) => {
    const method = LNK_METHODS.find((candidate) => candidate.requestKey === methodKey)
    return method ? [method] : []
  })

  for (const row of rows) {
    for (const method of methods) {
      const reason = getLnkRequestExtensionTargetReason(row, method, requestName, requestDate)
      if (reason) {
        issues.push({
          rowId: Number(row.id),
          methodKey: method.requestKey,
          methodCode: method.code,
          reason,
        })
      } else {
        targets.push({ rowId: Number(row.id), methodKey: method.requestKey })
      }
    }
  }

  return { targets, issues }
}

export function buildLnkRequestExtensionRows({
  rows,
  targets,
  requestName,
  requestDate,
}: {
  rows: WeldInput[]
  targets: LnkRequestExtensionTarget[]
  requestName: string
  requestDate: string
}): WeldInput[] {
  const normalizedRequestName = requestName.trim()
  const normalizedRequestDate = normalizeDateLikeForStorage(requestDate) ?? ''
  if (!normalizedRequestName) throw new Error('Выберите существующую заявку ЛНК.')
  if (!parseDateLikeToIso(normalizedRequestDate)) throw new Error('У существующей заявки не указана корректная дата.')
  if (targets.length === 0) throw new Error('Нет позиций для добавления в существующую заявку ЛНК.')

  const rowsById = new Map(rows.map((row) => [Number(row.id), row]))
  const updatedById = new Map<number, WeldInput>()
  const seenTargets = new Set<string>()

  for (const target of targets) {
    const rowId = Number(target.rowId)
    const targetKey = `${rowId}:${target.methodKey}`
    if (!Number.isInteger(rowId) || rowId <= 0 || seenTargets.has(targetKey)) {
      throw new Error('Передан повторный или некорректный набор позиций заявки ЛНК.')
    }
    seenTargets.add(targetKey)

    const row = updatedById.get(rowId) ?? rowsById.get(rowId)
    if (!row) throw new Error(`Стык №${rowId} больше не существует. Обновите отчет ЛНК.`)
    const method = LNK_METHODS.find((candidate) => candidate.requestKey === target.methodKey)
    if (!method) throw new Error('Передан неизвестный вид контроля ЛНК.')

    const reason = getLnkRequestExtensionTargetReason(
      row,
      method,
      normalizedRequestName,
      normalizedRequestDate,
    )
    if (reason) {
      const joint = String(row.joint ?? '').trim() || `№${rowId}`
      throw new Error(`Стык ${joint}, ${method.code}: ${reason}`)
    }

    updatedById.set(rowId, {
      ...row,
      [method.requestKey]: normalizedRequestName,
      [method.requestDateKey]: normalizedRequestDate,
      [method.resultKey]: 'ожидает НК',
    })
  }

  return [...updatedById.values()]
}

function getLnkRequestPositions(
  rows: WeldInput[],
  identity: Pick<RequestDocumentIdentity, 'name' | 'date'>,
) {
  return rows.flatMap((row) =>
    LNK_METHODS.flatMap((method) =>
      isSameRequestDocument(row[method.requestKey], row[method.requestDateKey], identity)
        ? [{ row, method }]
        : [],
    ),
  )
}

function getLnkRequestExtensionIdentityDisabledReason(
  identity: Pick<RequestDocumentIdentity, 'date'>,
  completedPosition?: ReturnType<typeof getLnkRequestPositions>[number],
) {
  if (!parseDateLikeToIso(identity.date)) {
    return 'У заявки отсутствует корректная дата, поэтому проверить хронологию добавляемых стыков нельзя.'
  }
  if (!completedPosition) return null

  const joint = String(completedPosition.row.joint ?? '').trim() || `№${completedPosition.row.id}`
  return `Заявка закрыта для дополнения: по стыку ${joint}, ${completedPosition.method.code} уже внесен результат или заключение.`
}

function getLnkRequestExtensionTargetReason(
  row: WeldInput,
  method: (typeof LNK_METHODS)[number],
  requestName: string,
  requestDate: string,
) {
  if (!isEnabledControlValue(row[method.enabledKey])) {
    return 'вид НК должен быть назначен как «да» или «дополнительный».'
  }
  if (hasRejectedLnkResult(row)) {
    return 'стык уже имеет негодный результат, поэтому новые позиции НК для него не создаются.'
  }
  if (hasText(row[method.requestKey]) || hasText(row[method.requestDateKey])) {
    if (isSameRequestDocument(row[method.requestKey], row[method.requestDateKey], {
      name: requestName.trim(),
      date: normalizeDateLikeForStorage(requestDate) ?? requestDate,
    })) {
      return 'позиция уже входит в выбранную заявку.'
    }
    return 'позиция уже относится к другой заявке.'
  }

  const result = String(row[method.resultKey] ?? '').trim()
  if (
    (hasText(result) && !isPendingLnkResultValue(result)) ||
    hasText(row[method.conclusionDateKey]) ||
    hasText(row[method.conclusionKey])
  ) {
    return 'по позиции уже есть результат или заключение.'
  }

  const weldDate = parseDateLikeToIso(row.weldDate)
  const normalizedRequestDate = parseDateLikeToIso(requestDate)
  if (!weldDate) return 'не указана корректная дата сварки.'
  if (!normalizedRequestDate) return 'у выбранной заявки не указана корректная дата.'
  if (weldDate > normalizedRequestDate) {
    return 'дата сварки позднее даты выбранной заявки.'
  }

  return null
}
