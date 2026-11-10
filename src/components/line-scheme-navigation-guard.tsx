import { useEffect, useRef } from 'react'
import { useBlocker, useRouter } from '@tanstack/react-router'
import { useConfirmAction } from '@/lib/confirm-action-context'

type Props = {
  dirty: boolean; busy: boolean; uncertain: boolean; files?: boolean;
  onBlocked: (message: string) => void;
}

/** The file already belongs to the user draft while the lazy workspace loads. */
export function LineSchemeOpening({ hasSelectedFile = false }: { hasSelectedFile?: boolean }) {
  return <>
    <LineSchemeNavigationGuard files dirty={hasSelectedFile} busy={false} uncertain={false} onBlocked={() => {}} />
    <p role="status">Открываем окно схемы…</p>
  </>
}

/** Closing the drawing has its own prompt. SPA navigation must protect the
 * same draft: beforeunload alone never runs on report links or browser Back. */
export function LineSchemeNavigationGuard(props: Props) {
  const router = useRouter({ warn: false })
  const protectedState = props.dirty || props.busy || props.uncertain
  useEffect(() => {
    if (!protectedState) return
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', unload)
    return () => window.removeEventListener('beforeunload', unload)
  }, [protectedState])
  return router ? <SchemeRouteBlocker {...props} /> : null
}

function SchemeRouteBlocker({ dirty, busy, uncertain, files, onBlocked }: Props) {
  const confirm = useConfirmAction()
  const pending = useRef<Promise<boolean> | null>(null)
  useBlocker({ disabled: !dirty && !busy && !uncertain, enableBeforeUnload: false, shouldBlockFn: async ({ current, next }) => {
    if (current.pathname === next.pathname) return false
    if (busy) { onBlocked('Дождитесь завершения операции со схемой перед переходом в другой раздел.'); return true }
    if (uncertain) { onBlocked('Результат операции не подтверждён. Повторите операцию или явно закройте окно схемы перед переходом.'); return true }
    if (!dirty) return false
    if (!pending.current) pending.current = confirm({
      title: 'Уйти из схемы линии?',
      description: files ? 'Выбранный файл или несохранённый номер изменения будут потеряны при уходе из раздела.' : 'Есть несохранённые изменения разметки или незавершённый ввод. При уходе из раздела они будут потеряны.',
      confirmLabel: 'Уйти без сохранения', cancelLabel: 'Остаться', tone: 'warning',
    }).finally(() => { pending.current = null })
    return !await pending.current
  } })
  return null
}
