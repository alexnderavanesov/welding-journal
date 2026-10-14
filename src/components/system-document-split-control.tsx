import { useContext, useEffect, useRef, useState } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { MoreHorizontal, RefreshCw } from 'lucide-react'
import { ContextActionMenu, type ContextActionMenuState } from './context-action-menu'
import { DocumentSplitModeSelect } from './document-split-mode-select'
import { FieldHelp } from './field-help'
import type { RequestNamingState } from '@/lib/request-naming-state'
import { systemNamePreviewSignature, type SystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import { getSystemDocumentSplitSettingId } from '@/lib/system-document-splitting'
import { getDocumentGroupingDefaults } from '@/server/document-grouping-preferences'
import { addRowsToNamingPatternContext, applyRemoteRequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { loadSystemDocumentSequences, SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY } from '@/lib/system-document-sequence-storage'
import { getSpecialistDocumentProfile } from '@/lib/document-specialists'
import { previewSystemDocumentNames, type SystemDocumentSequenceUpdate } from '@/server/system-document-sequences'
import { ALL_LNK_FIELD_METHODS } from '@/lib/lnk-report-config'

export function hydrateSpecialistNaming(naming: RequestNamingState, key: string | null): RequestNamingState {
  if (!key || !getSpecialistDocumentProfile(key) || naming.specialistProfile === key || !naming.specialistDefaults) return naming
  const common = naming.specialistDefaults[key as keyof typeof naming.specialistDefaults] ?? { first: null, second: null }
  return { ...naming, specialistProfile: key, specialists: naming.specialistProfile ? { common } : { ...naming.specialists, common: naming.specialists?.common ?? common } }
}

export function SystemDocumentSplitControl({ plan, naming, onChange, disabled = false }: {
  plan: SystemDocumentCreationPlan | null
  naming: RequestNamingState
  onChange: (naming: RequestNamingState) => void
  disabled?: boolean
}) {
  const key = plan ? getSystemDocumentSplitSettingId(plan) : null
  const current = useRef({ naming, onChange, key, plan })
  const queryClient = useContext(QueryClientContext)
  current.current = { naming, onChange, key, plan }
  const refreshNames = useRef(false)
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
    void request.current.then(async settings => {
      if (!active) return
      applyRemoteRequestConclusionSettings(settings)
      let systemGroupNames: RequestNamingState['systemGroupNames']
      const previewPlan = current.current.plan
      if (refreshNames.current && previewPlan?.date) {
        const groups = previewPlan.groups.filter(group => group.useSystemName)
        const method = ALL_LNK_FIELD_METHODS.find(method => method.code === previewPlan.methodCode)
        const fieldKeys: SystemDocumentSequenceUpdate['fieldKeys'] = previewPlan.type === 'pstoRequest' ? ['pstoRequest']
          : previewPlan.type === 'pstoConclusion' ? ['heatTreatmentDiagram']
          : previewPlan.type === 'lnkConclusion' ? method ? [method.conclusionKey] : []
          : previewPlan.methodCode === 'ТВМТ' ? ['tvmtRequest'] : ['vikRequest']
        const names = await previewSystemDocumentNames({ data: groups.map(group => {
          // The naming engine needs only the three already-collected values,
          // not every joint or any welding facts from a large selection.
          const { projectTitle, subtitleCode, line } = addRowsToNamingPatternContext({ date: new Date(0) }, group.rows)
          return {
            request: { type: previewPlan.type, methodCode: previewPlan.methodCode, sourceKind: previewPlan.sourceKind, date: previewPlan.date!, provisionalName: group.name || 'Предпросмотр', fieldKeys },
            rows: [{ projectTitle, subtitleCode, line }],
          }
        }) })
        systemGroupNames = Object.fromEntries(groups.map((group, index) => [group.key, {
          signature: systemNamePreviewSignature(previewPlan, group, names[index].pattern), name: names[index].name,
        }]))
      }
      if (!active) return
      refreshNames.current = false
      const state = current.current
      state.onChange(hydrateSpecialistNaming({ ...state.naming, ...(systemGroupNames ? { systemGroupNames } : {}), specialistDefaults: settings.specialistDefaults ?? {}, specialistDefaultRecords: settings.specialistDefaultRecords, splitModes: { ...settings.splitModes, ...state.naming.splitModes }, groupingDefaultsState: 'ready' }, state.key))
    }).catch(() => {
      if (active) current.current.onChange({ ...current.current.naming, groupingDefaultsState: 'error' })
    })
    return () => { active = false }
  }, [attempt])
  useEffect(() => {
    const state = current.current
    const next = hydrateSpecialistNaming(state.naming, state.key)
    if (next !== state.naming) state.onChange(next)
  }, [key, naming.specialistDefaults])
  const loading = naming.groupingDefaultsState !== 'ready'
  return <div className="ml-auto flex flex-wrap items-center gap-2 pb-1 text-xs text-slate-600">
    <DocumentSplitModeSelect value={plan?.mode ?? 'none'} disabled={disabled || !plan || loading}
      onChange={value => { if (key) onChange({ ...naming, splitModes: { ...naming.splitModes, [key]: value } }) }} />
    <FieldHelp label="Как работает разделение документов">
      Выберите, как распределить стыки по документам. Например, «По линии» создаёт отдельный документ на каждую линию с учётом проекта и шифра. Названия видны во вкладке «…и имена».
    </FieldHelp>
    {naming.groupingDefaultsState === 'error' ? <button type="button" className="w-48 shrink-0 text-rose-700 underline" onClick={() => { request.current = null; setAttempt(value => value + 1) }}>Повторить загрузку правил</button>
      : <span role="status" className="w-48 shrink-0 whitespace-nowrap px-1 tabular-nums">{loading ? 'Загрузка правил…' : !plan ? 'Выберите вид контроля' : plan.groups.length ? `Будет создано: ${plan.documentCount ?? plan.groups.length}` : 'Выберите стыки для расчёта'}</span>}
    {!loading ? <button type="button" aria-label="Дополнительные действия с номерами и именами" aria-expanded={Boolean(menu)} disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
      onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 4, anchorElement: event.currentTarget,
        heading: 'Номера и названия', description: 'Правила и номера загружаются при открытии окна. Повторная загрузка нужна только при конфликте или изменении правил.',
        items: [{ id: 'refresh', label: 'Обновить номера и имена', icon: RefreshCw, description: 'Подобрать свободные системные названия без расходования номеров. Ручные имена и разделение сохранятся.', onSelect: () => { request.current = null; refreshNames.current = true; const state = current.current; state.onChange({ ...state.naming, groupingDefaultsState: 'loading' }); setAttempt(value => value + 1) } }],
      }) }}><MoreHorizontal aria-hidden="true" className="h-4 w-4" /></button> : null}
    {menu ? <ContextActionMenu menu={menu} autoFocus closeOnEscapeWithModal onClose={() => setMenu(null)} /> : null}
  </div>
}
