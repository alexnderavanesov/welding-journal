import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { GetGroupRowAggParams, ICellRendererParams } from 'ag-grid-community'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { createWeldGroupSummarizer, WeldGroupSummary } from '@/lib/weld-group-summary'

export const JournalGroupAnchor = createContext('line')
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
export function aggregateJournalGroup(params: GetGroupRowAggParams<WeldRow>, summarize: ReturnType<typeof createWeldGroupSummarizer>) {
  const rows = params.nodes.flatMap(node => node.group ? (node.aggData?.__summary as WeldGroupSummary | undefined)?.rows ?? [] : node.data ? [node.data] : [])
  const summary = summarize(rows)
  return { __summary: summary, line: summary.lines, joint: summary.joints, wdi: summary.wdi,
    weldDate: summary.weldDate, projectTitle: summary.projectTitle, subtitleCode: summary.subtitleCode, finalStatus: summary.status,
    ...(summary.pstoResult ? { pstoResult: summary.pstoResult.status, tvmtResult: summary.tvmtResult?.status } : {}) }
}

export function JournalGroupCell({ node, column }: ICellRendererParams<WeldRow>) {
  const anchor = useContext(JournalGroupAnchor)
  const subscribe = useCallback((update: () => void) => {
    node.addEventListener('expandedChanged', update)
    return () => node.removeEventListener('expandedChanged', update)
  }, [node])
  const expanded = useSyncExternalStore(subscribe, () => Boolean(node.expanded), () => false)
  const summary = node.aggData?.__summary as WeldGroupSummary | undefined
  if (!summary) return null
  const field = column?.getColId()
  const title = 'Итог группы по загруженным строкам с текущими фильтрами.'
  const value = groupValue(summary, field)
  const stage = field === 'pstoResult' ? summary.pstoResult : field === 'tvmtResult' ? summary.tvmtResult : undefined
  const result = field === 'finalStatus' ? summary : stage
  const detail = field === 'joint' ? `Физических соединений: ${summary.joints}. Строк истории: ${summary.rows.length}. Ремонты не увеличивают количество; вырезанное соединение после замены катушкой исключено.`
    : field === 'line' ? `Различных линий: ${summary.lines}. Линии разных проектов и шифров считаются отдельно.`
    : field === 'wdi' ? `Сумма WDI физических соединений без повторов ремонта.${summary.missingWdi ? ` Нет WDI у ${summary.missingWdi} соединений; сумма неполная.` : ''}`
    : field === 'weldDate' ? `Ранняя и поздняя даты сварки всех строк группы.${summary.missingDates ? ` Без даты: ${summary.missingDates}.` : ''}`
    : field === 'finalStatus' ? `Ошибка имеет высший приоритет, включая историю. Затем: сварка, ремонт, заявка, НК. Оставшийся брак: ${summary.rejected}.${summary.partialChains ? ` Частично представленных или неоднозначных цепочек: ${summary.partialChains}.` : ''}`
    : stage ? `Текущий цикл каждого физического соединения. Ошибка этапа, включая историю, имеет высший приоритет; затем раннее ожидание. Оставшийся брак: ${stage.rejected}. ${Object.entries(stage.counts).map(([status, count]) => `${status}: ${count}`).join('; ')}.${stage.partialChains ? ` Частично представленных или неоднозначных цепочек: ${stage.partialChains}.` : ''}` : ''
  if (field === anchor) return <div className="journal-group-identity" style={{ paddingLeft: Math.min(node.level, 4) * 10 }} title={`${node.rowGroupColumn?.getColDef().headerName ?? 'Группа'}: ${node.key || '(Пусто)'}. ${title} ${detail}`}>
    <button type="button" className={`journal-group-toggle ${expanded ? 'ag-group-expanded' : 'ag-group-contracted'}`} aria-label={`${expanded ? 'Свернуть' : 'Развернуть'} группу ${node.key || '(Пусто)'}`} aria-expanded={expanded} onClick={() => node.setExpanded(!node.expanded)}>
      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
    </button>
    <span className="ag-group-value">{node.key || '(Пусто)'}</span>
    {field === 'line' && node.rowGroupColumn?.getColId() !== 'line' || field === 'joint' ? <span className="ag-group-child-count">{field === 'line' ? `${summary.lines} лин.` : `${summary.joints} ст.`}</span> : null}
  </div>
  if (!value) return null
  return <div data-group-summary={field} className={`journal-group-summary ${result ? `journal-group-status-${result.status === 'ошибка' || result.status === 'не годен' ? 'bad' : result.status === 'годен' || result.status === 'проведено' ? 'good' : 'pending'}` : ''}`} title={`${title} ${detail}`}>
    <span>{value}</span>
    {result && result.status !== 'не годен' && result.rejected > 0 ? <small className="journal-group-rejected">не годен: {result.rejected}</small> : null}
    {result && result.errors > 0 ? <small>{result.errors}</small> : null}
    {field === 'wdi' && summary.missingWdi > 0 ? <small aria-label="Неполная сумма WDI">*</small> : null}
  </div>
}

function groupValue(summary: WeldGroupSummary, field?: string) {
  switch (field) {
    case 'line': return number.format(summary.lines)
    case 'joint': return number.format(summary.joints)
    case 'wdi': return summary.wdi == null ? '—' : number.format(summary.wdi)
    case 'weldDate': return summary.weldDate
    case 'projectTitle': return summary.projectTitle
    case 'subtitleCode': return summary.subtitleCode
    case 'finalStatus': return summary.status
    case 'pstoResult': return summary.pstoResult?.status
    case 'tvmtResult': return summary.tvmtResult?.status
    default: return ''
  }
}
