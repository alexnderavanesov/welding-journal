import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { ChevronUp, Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FieldHelp } from '@/components/field-help'

export function ConclusionPositionChangeHelp() {
  return <FieldHelp label="Как работает изменение заключения только этого стыка">
    <div className="space-y-2">
      <p className="font-semibold">Перенос одной позиции заключения</p>
      <p>Меняется только выбранный стык и вид контроля. Если заключения с новым названием, теми же видом контроля, этапом и датой нет — создаётся отдельное. Если есть — позиция присоединяется к нему.</p>
      <p>Остальные стыки останутся в прежнем заключении. Результат и дата контроля сохранятся.</p>
      <p>Например: из стыков №1, №2 и №3 переносится №2. №1 и №3 остаются.</p>
      <p>Перенос требует подтверждения. Подготовленные изменения результатов сначала сохраните или отмените.</p>
      <p>Название и дату всего заключения меняйте во вкладке «Документы».</p>
    </div>
  </FieldHelp>
}

/** Mount editors only on demand; folding keeps their unsaved fields intact. */
export function ManagerEditPanel({ title, requestToken, defaultOpen = false, disabled, summary, onEditingChange, children }: {
  title: string
  requestToken?: string | number
  defaultOpen?: boolean
  disabled?: boolean
  summary?: ReactNode | ((editing: boolean) => ReactNode)
  onEditingChange?: (editing: boolean) => void
  children: ReactNode
}) {
  const id = useId()
  const [opened, setOpened] = useState(Boolean(requestToken) || defaultOpen)
  const [mounted, setMounted] = useState(Boolean(requestToken) || defaultOpen)
  useEffect(() => { onEditingChange?.(opened) }, [opened, onEditingChange])
  useEffect(() => {
    if (!requestToken) return
    setOpened(true)
    setMounted(true)
  }, [requestToken])
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <Button type="button" variant="outline" size="sm" disabled={disabled}
          aria-expanded={opened} aria-controls={id}
          onClick={() => { setOpened(!opened); setMounted(true) }}>
          {opened ? <ChevronUp className="mr-1.5 h-4 w-4" /> : <Pencil className="mr-1.5 h-4 w-4" />}
          {opened ? 'Свернуть редактирование' : 'Редактировать'}
        </Button>
      </div>
      {typeof summary === 'function' ? summary(opened) : summary}
      {mounted ? <div id={id} hidden={!opened}>
        <div className="space-y-4">{children}</div>
      </div> : null}
    </section>
  )
}

export function ManagerEditSection({ title, description, children }: {
  title: string
  description: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <div>
        <h4 id={id} className="text-sm font-semibold text-slate-900">{title}</h4>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      {children}
    </section>
  )
}

/** Count the complete document, never just the currently loaded registry page. */
export function useDocumentJointCount(key: string) {
  const [value, setValue] = useState<{ key: string; count: number } | null>(null)
  const onCompositionLoaded = useCallback((count: number) => {
    setValue(current => current?.key === key && current.count === count ? current : { key, count })
  }, [key])
  return { jointCount: value?.key === key ? value.count : undefined, onCompositionLoaded }
}
