import { BadgeCheck, ClipboardCheck, FilePlus2, Pencil } from 'lucide-react'

import type { ContextActionMenuItem } from '@/components/context-action-menu'

type WorkflowContextMenuGroups = {
  requests: ContextActionMenuItem[]
  results: ContextActionMenuItem[]
  editing: ContextActionMenuItem[]
  additional?: ContextActionMenuItem[]
}

export function buildWorkflowContextMenuItems({
  requests,
  results,
  editing,
  additional = [],
}: WorkflowContextMenuGroups): ContextActionMenuItem[] {
  return [
    createGroup('workflow-requests', 'Заявки', FilePlus2, requests),
    createGroup('workflow-results', 'Результаты и заключения', ClipboardCheck, results),
    createGroup('workflow-editing', 'Редактирование', Pencil, editing),
    createGroup('workflow-additional', 'Дополнительно', BadgeCheck, additional),
  ].filter((item): item is ContextActionMenuItem => item !== null)
}

function createGroup(
  id: string,
  label: string,
  icon: typeof FilePlus2,
  children: ContextActionMenuItem[],
): ContextActionMenuItem | null {
  const normalizedChildren = trimSeparators(children)
  if (normalizedChildren.length === 0) return null
  return {
    id,
    label,
    icon,
    children: normalizedChildren,
    onSelect: () => undefined,
  }
}

function trimSeparators(items: ContextActionMenuItem[]) {
  const normalized: ContextActionMenuItem[] = []
  for (const item of items) {
    if (item.type === 'separator' && (
      normalized.length === 0 || normalized.at(-1)?.type === 'separator'
    )) continue
    normalized.push(item)
  }
  while (normalized.at(-1)?.type === 'separator') normalized.pop()
  return normalized
}
