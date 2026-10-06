import { useState, type MouseEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { WeldRow } from '@/lib/dispatcher-types'
import { ContextActionMenu, type ContextActionMenuState, type ContextActionMenuItem } from './context-action-menu'
import { buildProgramHistory } from './line-program-joint-details'
import { openProgramDocument } from './line-program-document-link'

export type ProgramReportNavigation = (ids: number[], report: 'weldingJournal' | 'lnk' | 'heatTreatment', message?: string) => void

export function useProgramContextMenu(onAssignments: (id: number) => void, onNavigate?: ProgramReportNavigation, busy = false) {
  const [menu, setMenu] = useState<ContextActionMenuState>(null)
  const client = useQueryClient()
  const open = (event: MouseEvent, row: WeldRow) => {
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
    event.preventDefault(); event.stopPropagation()
    if (busy) return
    const { sections, layered } = buildProgramHistory(row)
    const documents: ContextActionMenuItem[] = sections.flatMap(section => section.controls.flatMap(control =>
      ([['Заявка', control.request, control.requestDocument], ['Заключение', control.conclusion, control.conclusionDocument]] as const)
        .filter(([, , document]) => !!document).map(([label, title, document]) => ({
          id: `${section.title}-${control.id}-${label}`, label: `${section.title} · ${control.method} · ${label}: ${title}`,
          onSelect: () => { void openProgramDocument(document!, client) },
        }))))
    for (const profile of layered) if (row[profile.idKey]) documents.push({ id: profile.fieldKey, label: `${profile.templateLabel}: ${row[profile.fieldKey] || 'без номера'}`, onSelect: () => { void openProgramDocument({ row, field: profile.fieldKey }, client) } })
    setMenu({ x: event.clientX, y: event.clientY, anchorElement: event.currentTarget, heading: `Стык ${row.joint}`, description: String(row.line ?? ''), items: [
      { id: 'assignments', label: 'Перейти к назначениям стыка', onSelect: () => onAssignments(row.id) },
      { id: 'documents', label: 'Заявки и заключения', disabled: !documents.length, title: 'У стыка пока нет связанных документов.', children: documents, onSelect: () => {} },
      ...(onNavigate ? [{ type: 'separator' as const, id: 'navigation' }, ...([
        ['lnk', 'Показать стык в ЛНК'], ['heatTreatment', 'Показать стык в ПСТО и ТВМТ'], ['weldingJournal', 'Показать стык в журнале'],
      ] as const).map(([report, label]) => ({ id: report, label, onSelect: () => onNavigate([row.id], report, `Стык ${row.joint} из программы линии ${row.line}.`) }))] : []),
    ] })
  }
  return { open, menu: <ContextActionMenu menu={menu} closeOnEscapeWithModal onClose={() => setMenu(null)} /> }
}
