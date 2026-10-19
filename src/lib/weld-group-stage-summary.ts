import type { WeldRow } from './dispatcher-types'
import { getPstoDisplayValue, getPendingWeldStatusLabel } from './lnk-status'
import { getPrimaryPstoStartStatusLabel } from './lnk-control-stage'
import { isControlCancelledValue } from './control-availability-values'
import { normalizeControlResultText } from './report-value-utils'
import { getCurrentPstoCycle, getPstoTvmtWorkflowLabel, getPstoTvmtWorkflowState, isCompletedPstoResult, normalizeTvmtResult } from './tvmt-cycle'

export type WeldGroupStageSummary = {
  status: string
  rejected: number
  errors: number
  partialChains: number
  /** Physical connections by their current stage summary, without history rows. */
  counts: Record<string, number>
}

const fields = ['pstoResult', 'tvmtResult'] as const
type StageField = typeof fields[number]
type RowStageResults = Record<StageField, string> & { errors: Record<StageField, boolean> }
const waiting = [
  'ожидает сварку', 'ожидает ремонт', 'ожидает заявку НК до ТО', 'ожидает НК до ТО',
  'ожидает заявку ПСТО', 'ожидает ПСТО', 'ожидает заявку ТВМТ', 'ожидает ТВМТ',
] as const

/** Compute current-cycle values once per loaded batch. The caller supplies the
 * same physical leaves and completeness checks as the journal's final result.
 * This is opt-in so ordinary journal grouping does no extra cycle work.
 */
export function createHeatTreatmentGroupSummarizer(rows: readonly WeldRow[]) {
  return createGroupStageSummarizer(rows, fields, getRowStageResults, waiting)
}

/** Shared aggregation only; each report keeps its own stage classification. */
export function createGroupStageSummarizer<Field extends string>(
  rows: readonly WeldRow[], fields: readonly Field[],
  getValues: (row: WeldRow) => Record<Field, string> & { errors: Record<Field, boolean> },
  pendingOrder: readonly string[],
) {
  const values = new Map(rows.map(row => [row.id, getValues(row)]))
  return () => {
    const summaries = Object.fromEntries(fields.map(field => [field,
      { status: '—', rejected: 0, errors: 0, partialChains: 0, counts: Object.create(null) },
    ])) as Record<Field, WeldGroupStageSummary>
    return {
      addHistory(row: WeldRow) {
        const result = values.get(row.id)
        for (const field of fields) if (result?.errors[field]) summaries[field].errors++
      },
      addBranch(leaves: readonly WeldRow[], partial: boolean) {
        for (const field of fields) {
          const current = new Set<string>(leaves.map(row => values.get(row.id)?.[field] ?? '—'))
          const summary = summaries[field]
          if (current.has('не годен')) summary.rejected++
          if (partial) summary.partialChains++
          const status = summarizeStatuses(current, partial, pendingOrder)
          summary.counts[status] = (summary.counts[status] ?? 0) + 1
        }
      },
      finish(rowCount: number) {
        for (const field of fields) {
          const summary = summaries[field]
          const current = new Set(Object.keys(summary.counts))
          summary.status = summary.errors ? 'ошибка'
            : current.size ? summarizeStatuses(current, summary.partialChains > 0, pendingOrder, summary.rejected > 0)
              : rowCount ? 'заменены катушкой' : '—'
        }
        return summaries
      },
    }
  }
}

function summarizeStatuses(values: ReadonlySet<string>, partial: boolean, pendingOrder: readonly string[], rejected = values.has('не годен')) {
  if (values.has('ошибка')) return 'ошибка'
  const pending = pendingOrder.find(status => values.has(status))
  if (pending) return pending
  if (rejected) return 'не годен'
  if (partial) return 'неполная цепочка'
  return values.size === 1 ? values.values().next().value! : values.size ? 'разные результаты' : '—'
}

function getRowStageResults(row: WeldRow): RowStageResults {
  const cycle = getCurrentPstoCycle(row)
  const state = getPstoTvmtWorkflowState(row)
  const psto = String(getPstoDisplayValue(row, 'pstoResult') ?? '').trim()
  const tvmt = String(getPstoDisplayValue(row, 'tvmtResult') ?? '').trim()
  const errors = {
    pstoResult: hasStageError(row, 'pstoResult'),
    tvmtResult: hasStageError(row, 'tvmtResult'),
  }
  const inactive = isControlCancelledValue(row.pstoRequired) ? 'отменен' : 'не требуется'
  // Pending labels and retained requests alone never start an inactive process.
  // A performed cycle still has to finish after cancellation or a line move.
  const pending = () => {
    if (!String(row.weldDate ?? '').trim()) {
      return row.finalStatus === 'ожидает ремонт' ? row.finalStatus : getPendingWeldStatusLabel(row)
    }
    if (state === 'waiting-psto-request' && cycle?.source !== 'repeat') {
      const prerequisite = getPrimaryPstoStartStatusLabel(row)
      if (prerequisite.startsWith('ожидает')) return prerequisite.split(':')[0]
    }
    return getPstoTvmtWorkflowLabel(state)
  }
  const pstoResult = normalizeControlResultText(cycle?.pstoResult ?? row.pstoResult) === 'ошибка' ? 'ошибка'
    : isCompletedPstoResult(psto)
      ? isControlCancelledValue(row.pstoRequired) || psto.toLowerCase().includes('отменен') ? 'проведено · назначение отменено' : 'проведено'
      : psto === 'нет потребности' ? psto
        : state === 'not-required' ? inactive
          : psto && !isPending(psto) && psto !== 'отменен' ? psto : pending()
  const tvmtFact = normalizeTvmtResult(tvmt)
  const tvmtResult = normalizeControlResultText(tvmt) === 'ошибка' ? 'ошибка'
    : tvmtFact === 'good' ? 'годен' : tvmtFact === 'failed' ? 'не годен'
      : tvmt && !isPending(tvmt) ? tvmt
        : state === 'not-required' ? inactive
          : pstoResult === 'нет потребности' ? pstoResult : pending()
  return { pstoResult, tvmtResult, errors }
}

function isPending(value: string) {
  return normalizeControlResultText(value).startsWith('ожидает')
}

function hasStageError(row: WeldRow, field: StageField) {
  return normalizeControlResultText(row[field]) === 'ошибка'
    || (row.pstoRepeatCycles ?? []).some(cycle => normalizeControlResultText(cycle[field]) === 'ошибка')
}
