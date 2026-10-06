import { createContext, useCallback, useContext, useState, type ReactNode, type SetStateAction } from 'react'
import { useBlocker, useRouter } from '@tanstack/react-router'
import { useConfirmAction } from '@/lib/confirm-action-context'
import type { ProgramPatch } from '@/lib/line-program-workspace'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'

type Draft = { manual: Map<number, ProgramPatch>; targets: Map<number, WeldRowVersionTarget> }
const empty = (): Draft => ({ manual: new Map(), targets: new Map() })
const EMPTY_DRAFT = empty()
const Context = createContext<{
  drafts: Map<number, Draft>
  update: (id: number, change: (previous: Draft) => Draft) => void
} | null>(null)

/** Page-owned drafts survive line unmounts caused by tabs, filters and pagination. */
export function ProgramDraftProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState(new Map<number, Draft>())
  const router = useRouter({ warn: false })
  const dirty = [...drafts.values()].some(draft => draft.manual.size > 0)
  const update = useCallback((id: number, change: (previous: Draft) => Draft) => setDrafts(previous => {
    const next = new Map(previous), draft = change(previous.get(id) ?? empty())
    if (draft.manual.size) next.set(id, draft); else next.delete(id)
    return next
  }), [])
  return <Context.Provider value={{ drafts, update }}>{router ? <DraftNavigationGuard dirty={dirty} /> : null}{children}</Context.Provider>
}

function DraftNavigationGuard({ dirty }: { dirty: boolean }) {
  const confirm = useConfirmAction()
  useBlocker({ disabled: !dirty, enableBeforeUnload: dirty, shouldBlockFn: async ({ current, next }) => {
    if (current.pathname === next.pathname) return false
    return !await confirm({ title: 'Уйти из программы линий?', description: 'Есть несохранённые назначения. При уходе из раздела черновики будут потеряны.', confirmLabel: 'Уйти без сохранения', cancelLabel: 'Остаться', tone: 'warning' })
  } })
  return null
}

export function useProgramDraftCount(lineId: number) {
  return useContext(Context)?.drafts.get(lineId)?.manual.size ?? 0
}

export function useProgramDraft(lineId: number, targets: readonly WeldRowVersionTarget[]) {
  const context = useContext(Context)
  if (!context) throw new Error('ProgramDraftProvider is required')
  const draft = context.drafts.get(lineId) ?? EMPTY_DRAFT
  const setManual = (action: SetStateAction<Map<number, ProgramPatch>>) => context.update(lineId, previous => {
    const manual = typeof action === 'function' ? action(previous.manual) : action
    const available = new Map(targets.map(target => [target.id, target]))
    // Preserve the version at the first edit, even after cache invalidation/refetch.
    return { manual, targets: new Map([...manual.keys()].flatMap(id => {
      const target = previous.targets.get(id) ?? available.get(id)
      return target ? [[id, target] as const] : []
    })) }
  })
  const acceptCurrentVersions = () => context.update(lineId, previous => ({ ...previous,
    targets: new Map(targets.filter(target => previous.manual.has(target.id)).map(target => [target.id, target])),
  }))
  return { ...draft, setManual, acceptCurrentVersions }
}
