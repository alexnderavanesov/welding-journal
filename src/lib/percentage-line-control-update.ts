import type { WeldRow } from '@/lib/dispatcher-types'
import {
  buildPercentageLineSummaries,
  isPercentageControlMethodAvailableForRow,
  type PercentageControlMethod,
} from '@/lib/percentage-line-summary'
import { getPstoLineIdentityKey } from '@/lib/psto-line-assignment'
import type { SystemIndexSettings } from '@/lib/system-index-settings'

export type PercentageLineControlScope = {
  projectTitle: string
  subtitleCode: string
  line: string
  stamp: string
}

export type PercentageLineControlAction = 'assign' | 'cancel'

export function buildPercentageLineControlUpdateRows({
  action,
  method,
  rows,
  scope,
  systemIndexSettings,
  targetIds,
}: {
  action: PercentageLineControlAction
  method?: PercentageControlMethod
  rows: WeldRow[]
  scope: PercentageLineControlScope
  systemIndexSettings?: SystemIndexSettings
  targetIds: readonly number[]
}): WeldRow[] {
  const normalizedTargetIds = [...new Set(targetIds.map(Number))]
  if (
    normalizedTargetIds.length === 0 ||
    normalizedTargetIds.some((id) => !Number.isInteger(id) || id <= 0) ||
    normalizedTargetIds.length !== targetIds.length
  ) {
    throw new Error('Выберите хотя бы один актуальный стык процентной линии.')
  }

  const lineKey = getPstoLineIdentityKey(scope)
  const lineSummary = buildPercentageLineSummaries(rows, systemIndexSettings)
    .find((summary) => getPstoLineIdentityKey(summary) === lineKey)
  const stampSummary = lineSummary?.stamps.find(
    (summary) => normalizeText(summary.stamp) === normalizeText(scope.stamp),
  )

  if (!stampSummary || stampSummary.missingControls <= 0) {
    throwPercentageLineChangedError()
  }
  if (normalizedTargetIds.length > stampSummary.missingControls) {
    throw new Error(
      `Расчет линии изменился: сейчас нужно закрыть не больше ${stampSummary.missingControls}. Ничего не сохранено. Обновите статистику и повторите действие.`,
    )
  }

  const candidateIds = new Set(
    action === 'cancel'
      ? stampSummary.missingCandidateRowIds
      : stampSummary.assignmentCandidateRowIds,
  )
  if (normalizedTargetIds.some((id) => !candidateIds.has(id))) {
    throwPercentageLineChangedError()
  }

  if (action === 'assign' && method !== 'РК' && method !== 'УЗК' && method !== 'ПВК') {
    throw new Error('Выберите вид контроля для процентной линии.')
  }

  const rowsById = new Map(rows.map((row) => [row.id, row]))
  return normalizedTargetIds.map((id) => {
    const row = rowsById.get(id)
    if (!row) throwPercentageLineChangedError()
    if (action === 'cancel') {
      return { ...row, hasRk: 'отменен', hasUzk: 'отменен' } as WeldRow
    }
    if (!isPercentageControlMethodAvailableForRow(method!, row)) {
      throw new Error('ПВК по расчету процентной линии можно назначить только на стык типа «У…».')
    }
    const fieldKey = method === 'УЗК' ? 'hasUzk' : method === 'ПВК' ? 'hasPvk' : 'hasRk'
    return { ...row, [fieldKey]: 'да' } as WeldRow
  })
}

function throwPercentageLineChangedError(): never {
  throw new Error(
    'Расчет процентной линии уже изменился другим пользователем или в другом окне. Ничего не сохранено. Обновите статистику и повторите действие.',
  )
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU')
}
