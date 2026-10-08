import { RULE_SETTINGS_TABS, getRuleConnections, type RuleSettingsTab } from '@/lib/rule-settings-navigation'

export function RuleSettingsTabs({ value, onChange }: { value: RuleSettingsTab; onChange: (tab: RuleSettingsTab) => void }) {
  return <div role="tablist" aria-label="Разделы правил и проверок" className="-mb-3 mt-2 flex gap-5 overflow-x-auto border-t border-slate-100 px-1">
    {RULE_SETTINGS_TABS.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`rules-tab-${tab.id}`}
      aria-label={tab.label} aria-selected={value === tab.id} aria-controls={`rules-${tab.id}`} tabIndex={value === tab.id ? 0 : -1}
      onClick={() => onChange(tab.id)}
      onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % RULE_SETTINGS_TABS.length
          : event.key === 'ArrowLeft' ? (index + RULE_SETTINGS_TABS.length - 1) % RULE_SETTINGS_TABS.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? RULE_SETTINGS_TABS.length - 1 : undefined
        if (next === undefined) return
        event.preventDefault()
        onChange(RULE_SETTINGS_TABS[next].id)
        document.getElementById(`rules-tab-${RULE_SETTINGS_TABS[next].id}`)?.focus({ preventScroll: true })
      }}
      className={`flex shrink-0 items-center gap-2 border-b-2 py-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400 ${value === tab.id ? 'border-sky-600 text-sky-800' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900'}`}>
      {tab.label}{'count' in tab ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500">{tab.count}</span> : null}
    </button>)}
  </div>
}

export function RuleConnections({ code, expanded = false, onNavigate }: { code: string; expanded?: boolean; onNavigate: (target: string) => void }) {
  const connections = getRuleConnections(code)
  if (!connections.length) return null
  return <div aria-label={`Связи ${code}`} className={expanded ? 'mt-4 border-t border-slate-200 pt-4' : 'mt-2 flex flex-wrap items-center gap-1.5'}>
    <span className={`text-[11px] font-medium text-slate-500 ${expanded ? 'mb-2 block' : 'mr-1'}`}>Связанные правила</span>
    <div className={expanded ? 'space-y-2' : 'flex flex-wrap gap-1.5'}>
      {connections.map(connection => <div key={connection.code} className={expanded ? 'flex items-start gap-3 text-xs leading-5 text-slate-600' : ''}>
        <button type="button" title={`${connection.title}. ${connection.explanation}`} onClick={() => onNavigate(connection.targetId)}
          aria-label={`${connection.code} · ${connection.title}`}
          className="inline-flex shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium leading-4 text-sky-800 hover:border-sky-300 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
          {connection.code}
        </button>
        {expanded ? <span>{connection.explanation}</span> : null}
      </div>)}
    </div>
  </div>
}
