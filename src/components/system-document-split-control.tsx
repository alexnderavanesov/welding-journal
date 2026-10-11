import { useContext, useEffect, useRef, useState } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { MoreHorizontal, RefreshCw } from 'lucide-react'
import { ContextActionMenu, type ContextActionMenuState } from './context-action-menu'
import { DocumentSplitModeSelect } from './document-split-mode-select'
import { FieldHelp } from './field-help'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { SystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import { getSystemDocumentSplitSettingId } from '@/lib/system-document-splitting'
import { getDocumentGroupingDefaults } from '@/server/document-grouping-preferences'
import { applyRemoteRequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { loadSystemDocumentSequences, SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY } from '@/lib/system-document-sequence-storage'

export function SystemDocumentSplitControl({ plan, naming, onChange, disabled = false }: {
  plan: SystemDocumentCreationPlan | null
  naming: RequestNamingState
  onChange: (naming: RequestNamingState) => void
  disabled?: boolean
}) {
  const current = useRef({ naming, onChange })
  const queryClient = useContext(QueryClientContext)
  current.current = { naming, onChange }
  const [attempt, setAttempt] = useState(0)
  const [menu, setMenu] = useState<ContextActionMenuState>(null)
  const request = useRef<ReturnType<typeof getDocumentGroupingDefaults> | null>(null)
  useEffect(() => {
    if (current.current.naming.groupingDefaultsState === 'ready') return
    let active = true
    current.current.onChange({ ...current.current.naming, groupingDefaultsState: 'loading' })
    request.current ??= Promise.resolve().then(async () => {
      const [settings] = await Promise.all([getDocumentGroupingDefaults(), queryClient?.fetchQuery({ queryKey: SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY, queryFn: loadSystemDocumentSequences, staleTime: 0 })])
      return settings
    })
    void request.current.then(settings => {
      if (!active) return
      applyRemoteRequestConclusionSettings(settings)
      const state = current.current
      state.onChange({ ...state.naming, splitModes: { ...settings.splitModes, ...state.naming.splitModes }, groupingDefaultsState: 'ready' })
    }).catch(() => {
      if (active) current.current.onChange({ ...current.current.naming, groupingDefaultsState: 'error' })
    })
    return () => { active = false }
  }, [attempt])
  const key = plan ? getSystemDocumentSplitSettingId(plan) : null
  const loading = naming.groupingDefaultsState !== 'ready'
  return <div className="ml-auto flex flex-wrap items-center gap-2 pb-1 text-xs text-slate-600">
    <DocumentSplitModeSelect value={plan?.mode ?? 'none'} disabled={disabled || !plan || loading}
      onChange={value => { if (key) onChange({ ...naming, splitModes: { ...naming.splitModes, [key]: value } }) }} />
    <FieldHelp label="Как работает разделение документов">
      Выберите, как распределить стыки по документам. Например, «По линии» создаёт отдельный документ на каждую линию с учётом проекта и шифра. Названия видны во вкладке «…и имена».
    </FieldHelp>
    {naming.groupingDefaultsState === 'error' ? <button type="button" className="text-rose-700 underline" onClick={() => { request.current = null; setAttempt(value => value + 1) }}>Повторить загрузку правил</button>
      : <span role="status" className="px-1 tabular-nums">{loading ? 'Загрузка правил…' : !plan ? 'Выберите вид контроля' : plan.groups.length ? `Будет создано: ${plan.documentCount ?? plan.groups.length}` : 'Выберите стыки для расчёта'}</span>}
    {!loading ? <button type="button" aria-label="Дополнительные действия с номерами и именами" aria-expanded={Boolean(menu)} disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
      onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 4, anchorElement: event.currentTarget,
        heading: 'Номера и названия', description: 'Правила и номера загружаются при открытии окна. Повторная загрузка нужна только при конфликте или изменении правил.',
        items: [{ id: 'refresh', label: 'Обновить номера и имена', icon: RefreshCw, description: 'Загрузить актуальные системные названия. Ручные имена и выбранное разделение сохранятся.', onSelect: () => { request.current = null; const state = current.current; state.onChange({ ...state.naming, groupingDefaultsState: 'loading' }); setAttempt(value => value + 1) } }],
      }) }}><MoreHorizontal aria-hidden="true" className="h-4 w-4" /></button> : null}
    {menu ? <ContextActionMenu menu={menu} autoFocus closeOnEscapeWithModal onClose={() => setMenu(null)} /> : null}
  </div>
}
