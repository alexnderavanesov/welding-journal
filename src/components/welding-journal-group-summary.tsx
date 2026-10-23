import { journalGroup } from '@/lib/journal-server-grid'
import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ICellRendererComp, ICellRendererParams } from 'ag-grid-community'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldGroupSummary } from '@/lib/weld-group-summary'
import type { LnkGroupResultField } from '@/lib/weld-group-lnk-summary'

export const JournalGroupAnchor = createContext('line')
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
export function JournalGroupCell({ node, column }: ICellRendererParams<WeldRow>) {
  const anchor = useContext(JournalGroupAnchor)
  const subscribe = useCallback((update: () => void) => {
    node.addEventListener('expandedChanged', update)
    return () => node.removeEventListener('expandedChanged', update)
  }, [node])
  const expanded = useSyncExternalStore(subscribe, () => Boolean(node.expanded), () => false)
  const serverGroup = journalGroup(node.data)
  const summary = serverGroup?.summary
  if (!summary) return null
  const field = column?.getColId()
  const title = 'Итог полной группы с текущими фильтрами.'
  const value = groupValue(summary, field)
  const stage = field === 'pstoResult' ? summary.pstoResult : field === 'tvmtResult' ? summary.tvmtResult : summary.lnkResults?.[field as LnkGroupResultField]
  const result = field === 'finalStatus' ? summary : stage
  const detail = field === 'joint' ? jointGroupDetail(summary, serverGroup.recordCount) : ''
  if (field === anchor) return <div className="journal-group-identity" style={{ paddingLeft: Math.min(node.level, 4) * 10 }} data-journal-tip-title={field === 'joint' ? 'Стыки группы' : undefined} data-journal-tip-body={field === 'joint' ? `${title} ${detail}` : undefined}>
    <button type="button" className={`journal-group-toggle ${expanded ? 'ag-group-expanded' : 'ag-group-contracted'}`} aria-label={`${expanded ? 'Свернуть' : 'Развернуть'} группу ${node.key || '(Пусто)'}`} aria-expanded={expanded} onClick={() => node.setExpanded(!node.expanded)}>
      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
    </button>
    <span className="ag-group-value">{node.key || '(Пусто)'}</span>
    {field === 'line' && node.rowGroupColumn?.getColId() !== 'line' || field === 'joint' ? <span className="ag-group-child-count">{field === 'line' ? `${summary.lines} лин.` : `${summary.joints} ст.`}</span> : null}
  </div>
  if (!value) return null
  return <div data-group-summary={field} className={`journal-group-summary ${result ? `journal-group-status-${result.status === 'ошибка' || result.status === 'не годен' ? 'bad' : result.status === 'годен' || result.status === 'проведено' ? 'good' : 'pending'}` : ''}`} data-journal-tip-title={field === 'joint' ? 'Стыки группы' : undefined} data-journal-tip-body={field === 'joint' ? `${title} ${detail}` : undefined}>
    <span>{value}</span>
    {result && result.status !== 'не годен' && result.rejected > 0 ? <small className="journal-group-rejected">не годен: {result.rejected}</small> : null}
    {result && result.errors > 0 ? <small>{result.errors}</small> : null}
    {field === 'wdi' && summary.missingWdi > 0 ? <small aria-label="Неполная сумма WDI">*</small> : null}
  </div>
}

function jointGroupDetail(summary: Omit<WeldGroupSummary, 'rows'>, recordCount: number) {
  return `Физических соединений: ${summary.joints}. Строк истории: ${recordCount}. Ремонты не увеличивают количество; вырезанное соединение после замены катушкой исключено.`
}

// Server summaries already contain the physical totals. Only the anchor cell
// needs a React toggle and expandedChanged subscription; the other columns are
// inert text/badges, including empty group cells in a wide report.
export class JournalServerGroupValue implements ICellRendererComp<WeldRow> {
  private element!: HTMLDivElement
  private data?: WeldRow
  private field?: string
  init(params: ICellRendererParams<WeldRow>) {
    this.element = document.createElement('div')
    this.refresh(params)
  }
  getGui() { return this.element }
  refresh(params: ICellRendererParams<WeldRow>) {
    const field = params.column?.getColId()
    if (this.data === params.data && this.field === field) return true
    this.data = params.data; this.field = field
    this.element.replaceChildren()
    this.element.className = ''
    for (const key of Object.keys(this.element.dataset)) delete this.element.dataset[key]
    const group = journalGroup(params.data)
    if (!group) return true
    const summary = group.summary, value = groupValue(summary, field)
    if (!value) return true
    const result = field === 'finalStatus' ? summary : field === 'pstoResult' ? summary.pstoResult : field === 'tvmtResult' ? summary.tvmtResult : summary.lnkResults?.[field as LnkGroupResultField]
    this.element.dataset.groupSummary = field
    this.element.className = `journal-group-summary ${result ? `journal-group-status-${result.status === 'ошибка' || result.status === 'не годен' ? 'bad' : result.status === 'годен' || result.status === 'проведено' ? 'good' : 'pending'}` : ''}`
    const add = (tag: 'span' | 'small', text: string) => {
      const child = document.createElement(tag); child.textContent = text; this.element.append(child); return child
    }
    add('span', value)
    if (result && result.status !== 'не годен' && result.rejected > 0) add('small', `не годен: ${result.rejected}`).className = 'journal-group-rejected'
    if (result && result.errors > 0) add('small', String(result.errors))
    if (field === 'wdi' && summary.missingWdi > 0) add('small', '*').setAttribute('aria-label', 'Неполная сумма WDI')
    if (field === 'joint') {
      this.element.dataset.journalTipTitle = 'Стыки группы'
      this.element.dataset.journalTipBody = `Итог полной группы с текущими фильтрами. ${jointGroupDetail(summary, group.recordCount)}`
    }
    return true
  }
}

function groupValue(summary: Omit<WeldGroupSummary, 'rows'>, field?: string) {
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
    default: return summary.lnkResults?.[field as LnkGroupResultField]?.status ?? ''
  }
}
