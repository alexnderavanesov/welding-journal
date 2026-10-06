import type { LineProgramRecord } from './line-program'
import type { LineProgramOverview } from './line-program-overview'
import type { ProgramSelection } from './line-program-workspace'
import { PROGRAM_DEMAND_LABELS } from './line-program-labels'

export type ProgramSectionLine = LineProgramRecord & { overview?: LineProgramOverview }
export const PROGRAM_SECTION_METRICS = {
  lines: 'Линий', joints: 'Учитываемых соединений', stamps: 'Клейм в линиях',
  common: `${PROGRAM_DEMAND_LABELS.common} · зачтено / нужно`, pvk: 'ПВК · зачтено / нужно',
  missing: 'К назначению', excess: 'Лишнее', reduction: 'Возможное сокращение',
  approved: 'Согласовано', additional: 'Дополнительные стыки', configuration: 'Нужна настройка',
} as const
export type ProgramSectionMetric = keyof typeof PROGRAM_SECTION_METRICS
export const PROGRAM_SECTION_EXPLANATIONS: Record<ProgramSectionMetric, string> = {
  lines: 'Каждая линия учитывается один раз в своей связке проекта и шифра. Одинаковые названия в разных проектах — разные линии.',
  joints: 'Физические соединения суммируются по линиям без повторов по клеймам. Ремонтные записи не добавляют соединений. Это не количество записей журнала.',
  stamps: 'Суммируется число клейм в каждой линии. Одно клеймо на двух линиях даёт два участия; это не число уникальных сварщиков во всём журнале.',
  common: 'Складываются места, зачтённые в пределах нормы каждой расчётной группы, и текущая достижимая потребность. Превышение одной группы не закрывает недобор другой. Общий стык может закрывать места нескольких клейм; это не число годных заключений.',
  pvk: 'ПВК считается отдельно от РК/УЗК. Складываются зачёт в пределах нормы каждой расчётной группы и её текущая достижимая потребность. Зачёт не означает получение годных заключений.',
  missing: 'Общий остаток — сумма «К назначению» по РК/УЗК и ПВК всех линий. Он уже ограничен доступными кандидатами. Недостижимая часть расчётной нормы не добавляется к долгу. Одно назначение может закрывать места нескольких клейм.',
  excess: 'Складываются лишние назначения по РК/УЗК и ПВК. Единица — стык и метод, без повторного счёта по клеймам. Назначение, необходимое другому клейму, не становится лишним. История может запрещать снятие даже лишнего контроля.',
  reduction: 'Суммируются назначения «да», предложенные к совместному безопасному снятию в каждой линии. Учитываются нормы всех клейм, обязательность и защита истории. Это только подсказка; назначения не снимаются автоматически.',
  approved: 'Суммируются действующие согласования по линиям. Они показаны отдельно от лишних назначений; просмотр расчёта не отменяет согласования или контроль.',
  additional: 'Суммируются стыки с дополнительным контролем. Несколько дополнительных методов одного стыка не увеличивают этот счётчик. Участие в зачёте проверяется отдельно в расчёте линии.',
  configuration: 'Линии с неполными или противоречивыми требованиями показаны отдельно. Их неизвестная потребность не считается нулевой: сначала настройте программу линии.',
}

const emptyDemand = () => ({ required: 0, covered: 0, missing: 0, actionableRequired: 0, excess: 0 })

/** Add the existing compact results; never recalculate welds or offset deficits with other groups' surplus. */
export function summarizeProgramSection(lines: readonly ProgramSectionLine[]) {
  return lines.reduce((total, line) => {
    const o = line.overview
    if (o) {
      total.joints += o.joints; total.stamps += o.stamps; total.approved += o.approved; total.additional += o.additional; total.reducible += o.reducible
      for (const kind of ['common', 'pvk'] as const) for (const key of ['required', 'covered', 'missing', 'actionableRequired', 'excess'] as const) total[kind][key] += o[kind]?.[key] ?? 0
    }
    if (line.configurationIssue) total.issues++
    return total
  }, { lines: lines.length, joints: 0, stamps: 0, approved: 0, additional: 0, reducible: 0, issues: 0, common: emptyDemand(), pvk: emptyDemand() })
}
export type ProgramSectionSummary = ReturnType<typeof summarizeProgramSection>

export function programSectionMetricValue(summary: ProgramSectionSummary, metric: ProgramSectionMetric): string {
  if (metric === 'common' || metric === 'pvk') return `${summary[metric].covered} / ${summary[metric].actionableRequired}`
  if (metric === 'missing' || metric === 'excess') return String(summary.common[metric] + summary.pvk[metric])
  return String(summary[metric === 'reduction' ? 'reducible' : metric === 'configuration' ? 'issues' : metric])
}

export function programSectionMetricSelection(metric: ProgramSectionMetric): ProgramSelection {
  if (metric === 'common' || metric === 'pvk') return { slice: 'covered', kind: metric }
  if (metric === 'missing' || metric === 'excess' || metric === 'reduction' || metric === 'approved' || metric === 'additional') return { slice: metric }
  return { slice: 'all' }
}
