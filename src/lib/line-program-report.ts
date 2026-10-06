import type { PrintableReport } from './printable-report'
import type { LineProgramRecord } from './line-program'
import type { LineProgramOverview } from './line-program-overview'
import type { buildLineProgramDisplay } from './line-program-display'

export type ProgramReportLine = { line: LineProgramRecord; overview: LineProgramOverview; stamps: Array<ReturnType<typeof buildLineProgramDisplay>['stampRows'][number] & { welderName?: string }> }
export function buildLineProgramReport(lines: ProgramReportLine[], mode: 'lines' | 'stamps', context: string): PrintableReport {
  const physical = lines.reduce((sum, item) => sum + item.overview.joints, 0)
  const commonMissing = lines.reduce((sum, item) => sum + (item.overview.common?.missing ?? 0), 0)
  const pvkMissing = lines.reduce((sum, item) => sum + (item.overview.pvk?.missing ?? 0), 0)
  const uncalculated = lines.filter(item => !item.overview.common || !item.overview.pvk).length
  const quota = (demand: { covered: number; actionableRequired: number } | null) => demand ? `${Math.min(demand.covered, demand.actionableRequired)} / ${demand.actionableRequired}` : '—'
  const identity = (line: LineProgramRecord) => [line.projectTitle || '—', line.subtitleCode || '—', line.line]
  const note = (overview: LineProgramOverview, text: string) => [text,
    overview.integrityIssues ? 'СП-04: нарушена целостность физической цепочки; расчёт требует проверки истории' : '',
  ].filter(Boolean).join(' · ')
  const columns = ['Проект', 'Шифр', 'Линия', ...(mode === 'stamps' ? ['Клеймо / сварщик'] : ['Клейм']), 'Стыков', 'РК - УЗК · зачтено / нужно', 'ПВК · зачтено / нужно', 'К назначению', 'Лишнее', 'Можно снять', 'Примечание']
  const records: Array<Array<string | number>> = mode === 'lines' ? lines.map(({ line, overview: o }) => [...identity(line), o.stamps, o.joints, quota(o.common), quota(o.pvk),
    o.common && o.pvk ? o.common.missing + o.pvk.missing : '—', o.common && o.pvk ? o.common.excess + o.pvk.excess : '—', o.reducible,
    note(o, line.configurationIssue ?? `РК - УЗК ${line.weldControlPercent}% · ПВК ${line.pvkControlPercent}%`)]) :
    lines.flatMap<{ line: LineProgramRecord; overview: LineProgramOverview; stamp: ProgramReportLine['stamps'][number] | null }>(({ line, overview, stamps }) => stamps.length ? stamps.map(stamp => ({ line, overview, stamp })) : [{ line, overview, stamp: null }])
      .sort((a, b) => (a.stamp?.stamp ?? '').localeCompare(b.stamp?.stamp ?? '', 'ru') || a.line.line.localeCompare(b.line.line, 'ru'))
      .map(({ line, overview, stamp }) => [...identity(line), stamp ? [stamp.stamp, stamp.welderName].filter(Boolean).join(' · ') : 'Нет расчётных клейм', stamp?.count ?? '—', quota(stamp?.common ?? null), quota(stamp?.pvk ?? null),
        stamp ? stamp.common.missing + stamp.pvk.missing : '—', stamp ? stamp.common.excess + stamp.common.duplicateAssignments + stamp.pvk.excess + stamp.pvk.duplicateAssignments : '—', stamp?.reducible ?? '—',
        note(overview, line.configurationIssue ?? (stamp?.fullControlRequired ? '100% по браку' : line.weldControlPercent === 100 ? 'Разбивка 100%-ной линии — справочно' : ''))])
  return { title: mode === 'lines' ? 'Программа линий — сводка по линиям' : 'Программа линий — сводка по клеймам',
    subtitle: '«Стыков» — физические соединения, без R/W и заменённых исходных соединений. Зачтено / нужно — покрытие нормы назначениями, не количество годных заключений. Недостижимая расчётная норма не показана как долг.',
    meta: [{ label: 'Отбор', value: context }, { label: 'Область', value: 'Все страницы выбранного списка; только сохранённые данные' }],
    metrics: [{ label: 'Линий', value: String(lines.length) }, { label: 'Физических стыков', value: String(physical), detail: 'Без повторов по клеймам' },
      { label: 'РК - УЗК к назначению', value: String(commonMissing) }, { label: 'ПВК к назначению', value: String(pvkMissing) },
      ...(uncalculated ? [{ label: 'Без расчёта', value: String(uncalculated), detail: 'Линии с неполной настройкой не включены в итоги потребности' }] : [])],
    tables: records.length ? [{ title: mode === 'lines' ? 'Линии' : 'Клейма в отдельных линиях', subtitle: mode === 'stamps' ? 'Норма каждого клейма относится только к указанной линии. Общие стыки повторяются у участников: строки клейм и справочные нормы 100%-ных линий не складываются в физический итог. Несваренные стыки без клейма входят только в физический итог.' : 'Лишнее и «Можно снять» считаются в назначениях (стык + метод), а не в физических стыках.', columns, rows: records }] : [],
    emptyMessage: 'В выбранном списке нет линий.' }
}
