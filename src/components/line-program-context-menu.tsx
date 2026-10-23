import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { WeldRow } from '@/lib/dispatcher-types'
import { ContextActionMenu, type ContextActionMenuState, type ContextActionMenuItem } from './context-action-menu'
import { buildProgramHistory } from './line-program-joint-details'
import { useProgramDocumentPreview } from './line-program-document-link'

export type ProgramReportNavigation = (ids: number[], report: 'weldingJournal' | 'lnk' | 'heatTreatment', message?: string) => void

export function useProgramContextMenu(onAssignments: (id: number) => void, onNavigate?: ProgramReportNavigation, busy = false) {
  const [menu, setMenu] = useState<ContextActionMenuState>(null)
  const [pointerMenu, setPointerMenu] = useState(false)
  const trigger = useRef<HTMLElement | null>(null)
  const { openDocument, preview } = useProgramDocumentPreview()
  const close = () => {
    setMenu(null)
    // ContextActionMenu closes before invoking a command. Restore now so an
    // assignment/document dialog captures the row as its return target; a
    // deferred focus restoration would steal focus from the newly opened dialog.
    const active = document.activeElement
    if (trigger.current?.isConnected && (active === document.body || active instanceof Element && active.closest('[data-testid="context-action-menu"], [data-menu-submenu]'))) trigger.current.focus({ preventScroll: true })
  }
  const open = (event: MouseEvent | KeyboardEvent, row: WeldRow) => {
    // React events from a portalled document still bubble through its source
    // row. The preview has its own context and must not operate on that row.
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
    event.preventDefault(); event.stopPropagation()
    if (busy) return
    setPointerMenu('clientX' in event)
    trigger.current = document.activeElement instanceof HTMLElement && event.currentTarget.contains(document.activeElement)
      ? document.activeElement
      : event.target instanceof Element ? event.target.closest<HTMLElement>('button, a[href], [tabindex]') : null
    const { sections, layered } = buildProgramHistory(row)
    const documents: ContextActionMenuItem[] = sections.flatMap(section => section.controls.flatMap(control =>
      ([['Заявка', control.request, control.requestDocument], ['Заключение', control.conclusion, control.conclusionDocument]] as const)
        .filter(([, , document]) => !!document).map(([label, title, document]) => ({
          id: `${section.title}-${control.id}-${label}`, label: `${section.title} · ${control.method} · ${label}: ${title}`,
          onSelect: () => { openDocument(document!) },
        }))))
    for (const profile of layered) if (row[profile.idKey]) documents.push({ id: profile.fieldKey, label: `${profile.templateLabel}: ${row[profile.fieldKey] || 'без номера'}`, onSelect: () => { openDocument({ row, field: profile.fieldKey }) } })
    setMenu({ x: 'clientX' in event ? event.clientX : (event.target as Element).getBoundingClientRect().left + 16, y: 'clientY' in event ? event.clientY : (event.target as Element).getBoundingClientRect().bottom, anchorElement: event.currentTarget, heading: `Стык ${row.joint}`, description: String(row.line ?? ''), items: [
      { id: 'assignments', label: 'Перейти к назначениям стыка', onSelect: () => onAssignments(row.id) },
      { id: 'documents', label: 'Заявки и заключения', disabled: !documents.length, title: 'У стыка пока нет связанных документов.', children: documents, onSelect: () => {} },
      ...(onNavigate ? [{ type: 'separator' as const, id: 'navigation' }, ...([
        ['lnk', 'Показать стык в ЛНК'], ['heatTreatment', 'Показать стык в ПСТО и ТВМТ'], ['weldingJournal', 'Показать стык в журнале'],
      ] as const).map(([report, label]) => ({ id: report, label, onSelect: () => onNavigate([row.id], report, `Стык ${row.joint} из программы линии ${row.line}.`) }))] : []),
    ] })
  }
  return { open, menu: <><ContextActionMenu menu={menu} autoFocus={pointerMenu ? 'panel' : true} closeOnEscapeWithModal onClose={close} />{preview}</> }
}
