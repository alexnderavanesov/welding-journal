import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Calculator, ChevronDown, ChevronUp, ClipboardList, List, Settings2 } from 'lucide-react'
import { ContextActionMenu, type ContextActionMenuState } from './context-action-menu'
import type { LineProgramRecord } from '@/lib/line-program'
import type { ProgramSelection } from '@/lib/line-program-workspace'
import { PROGRAM_SECTION_METRICS, type ProgramSectionMetric } from '@/lib/line-program-section-summary'

export type ProgramScopeCommand = { action: 'assignments' | 'calculation'; selection: ProgramSelection; jointId?: number; explain?: boolean }
export type ProgramScopeMenuEvent = MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>
export type ProgramScopeMenuOptions = {
  line: LineProgramRecord; scope: ProgramSelection; expanded: boolean
  onToggle: () => void; onAssignments: () => void; onCalculation: (selection: ProgramSelection, explain: boolean) => void
  onSelect: (selection: ProgramSelection) => void; onEdit?: () => void
}
type SectionFilter = 'all' | 'missing' | 'excess' | 'reduction' | 'approved' | 'additional' | 'configuration'

/** One menu for the whole page; opening it does not fetch or expand anything. */
export function useProgramScopeMenu() {
  const [menu, setMenu] = useState<ContextActionMenuState>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const close = () => { setMenu(null); if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }) }
  const show = (event: ProgramScopeMenuEvent, content: Omit<NonNullable<ContextActionMenuState>, 'x' | 'y'>) => {
    if ('key' in event && event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
    event.preventDefault(); event.stopPropagation()
    trigger.current = (event.target instanceof Element ? event.target.closest<HTMLElement>('button') : null)
      ?? event.currentTarget.querySelector<HTMLElement>('button[aria-expanded]')
      ?? event.currentTarget.querySelector<HTMLElement>('button')
    const anchor = (trigger.current ?? event.currentTarget).getBoundingClientRect()
    setMenu({ ...content, x: 'clientX' in event ? event.clientX : anchor.left + 16, y: 'clientY' in event ? event.clientY : anchor.bottom })
  }
  const open = (event: ProgramScopeMenuEvent, options: ProgramScopeMenuOptions) => {
    const { line, scope, expanded, onToggle, onAssignments, onCalculation, onSelect, onEdit } = options
    const metric = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-program-slice]') : null
    const slice = metric?.dataset.programSlice as ProgramSelection['slice'] | undefined
    const kind = metric?.dataset.programKind
    const calculationScope: ProgramSelection = slice ? { ...scope, slice, kind: kind === 'common' || kind === 'pvk' ? kind : undefined } : scope
    const issue = line.configurationIssue || (line.weldControlPercent == null || line.pvkControlPercent == null ? 'Сначала настройте требования контроля линии.' : undefined)
    show(event, {
      heading: scope.stamp ? `Клеймо ${scope.stamp}` : scope.unassigned ? 'Клеймо не назначено' : `Линия ${line.line}`,
      description: [scope.stamp || scope.unassigned ? line.line : 'Все стыки линии', line.projectTitle, line.subtitleCode].filter(Boolean).join(' · '),
      items: [
        { id: 'assignments', label: 'Назначения', icon: ClipboardList, disabled: !!issue, title: issue, onSelect: onAssignments },
        { id: 'calculation', label: 'Расчёт', icon: Calculator, disabled: !!issue || !!scope.unassigned, title: issue || (scope.unassigned ? 'Без клейма нет отдельной расчётной группы.' : undefined), onSelect: () => onCalculation(calculationScope, !!slice) },
        { id: 'joints', label: 'Показать стыки', icon: List, disabled: !!issue, title: issue, onSelect: () => {}, children: ([
          ['all', 'Все стыки'], ['missing', 'К назначению'], ['excess', 'Лишние'], ['reduction', 'Кандидаты на снятие'],
        ] as const).map(([slice, label]) => ({ id: slice, label, disabled: !!issue, title: issue, onSelect: () => onSelect({ ...scope, kind: undefined, slice }) })) },
        { type: 'separator', id: 'view' },
        { id: 'toggle', label: expanded ? 'Свернуть' : 'Развернуть', icon: expanded ? ChevronUp : ChevronDown, onSelect: onToggle },
        ...(!scope.stamp && !scope.unassigned && onEdit ? [{ id: 'settings', label: 'Настроить линию', icon: Settings2, onSelect: onEdit }] : []),
      ],
    })
  }
  const openSection = (event: ProgramScopeMenuEvent, options: { description: string; onSelect: (filter: SectionFilter) => void; onCalculation?: (metric: ProgramSectionMetric) => void }) => {
    // Portalled dialogs and document links keep their own context, not section-wide filters.
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
    const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-section-metric], [data-program-slice]') : null
    const metric = element?.dataset.sectionMetric ?? element?.dataset.programSlice
    const selected = metric && Object.hasOwn(PROGRAM_SECTION_METRICS, metric) ? metric as ProgramSectionMetric : 'common'
    show(event, { heading: 'Программа линий', description: options.description, items: [
      ...(options.onCalculation ? [{ id: 'calculation', label: 'Расчёт', icon: Calculator, onSelect: () => options.onCalculation!(selected) }, { type: 'separator' as const, id: 'filters' }] : []),
      ...([
      ['all', 'Все линии раздела'], ['missing', 'К назначению'], ['excess', 'Лишний контроль'],
      ['reduction', 'Кандидаты на снятие'], ['approved', 'Согласованные превышения'],
      ['additional', 'Дополнительные стыки'], ['configuration', 'Нужна настройка'],
    ] as const).map(([filter, label]) => ({ id: filter, label, onSelect: () => options.onSelect(filter) }))] })
  }
  return { open, openSection, menu: <ContextActionMenu menu={menu} autoFocus onClose={close} /> }
}
