type ControlState = {
  count: number; good: number; rejected: number; errors?: number
  incompleteStages?: { welding: number; request: number; control: number; other: number }
}

/** Stages explain incomplete work, not additional joints or evidence of a started process. */
export function ProgramControlState({ state, compact = false }: { state: ControlState; compact?: boolean }) {
  const incomplete = Math.max(0, state.count - state.good - state.rejected - (state.errors ?? 0))
  if (compact) return <details className="relative text-xs" data-testid="stamp-control-state-compact">
    <summary className="flex min-h-7 cursor-pointer list-none flex-wrap items-center gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500" aria-label={`Состояние: годен ${state.good}, не завершено ${incomplete}, не годен ${state.rejected}`}>
      <span className={`whitespace-nowrap ${state.good ? 'text-emerald-700' : 'text-slate-500'}`} title={`Годен: ${state.good}`}><span aria-hidden>✓</span> {state.good}</span>
      <span className={`whitespace-nowrap ${incomplete ? 'text-amber-800' : 'text-slate-500'}`} title={`Не завершено: ${incomplete}`}><span aria-hidden>◷</span> {incomplete}</span>
      <span className={`whitespace-nowrap ${state.rejected ? 'text-rose-700' : 'text-slate-500'}`} title={`Не годен: ${state.rejected}`}><span aria-hidden>×</span> {state.rejected}</span>
      {state.errors ? <span className="text-rose-700">Ошибка: {state.errors}</span> : null}<span className="text-slate-400" aria-hidden>⌄</span>
    </summary><div className="py-1"><ProgramControlState state={state} /></div>
  </details>
  return <div className="grid w-40 max-w-full gap-1 text-[13px]" data-testid="stamp-control-state">
    {([
      ['Годен', state.good, 'border-emerald-100 bg-emerald-50/70 text-emerald-800'],
      ['Не завершено', incomplete, 'border-amber-100 bg-amber-50/60 text-amber-900'],
      ['Не годен', state.rejected, 'border-rose-100 bg-rose-50/70 text-rose-800'],
    ] as const).map(([label, value, color]) => <div key={label} className={`flex items-baseline justify-between gap-2 rounded border px-2 py-1 ${value ? color : 'border-transparent bg-transparent text-slate-500'}`}><span>{label}:{' '}</span><strong className="font-semibold tabular-nums">{value}</strong></div>)}
    {state.errors ? <div title="Ошибки данных, как в карточке стыка. Не считаются незавершённым или годным контролем." className="flex justify-between gap-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-rose-800">Ошибка: <strong>{state.errors}</strong></div> : null}
    {incomplete > 0 && state.incompleteStages ? <dl aria-label="Этапы незавершённых соединений" className="mt-1 space-y-1 px-2 text-xs leading-5 text-slate-600">
      {([
        ['welding', 'До сварки'], ['request', 'Ожидают заявку'], ['control', 'Ожидают контроль'], ['other', 'Другой этап'],
      ] as const).filter(([key]) => state.incompleteStages![key] > 0).map(([key, label]) => <div key={key} className="flex items-baseline justify-between gap-2"><dt>{label}</dt><dd className="tabular-nums">{state.incompleteStages![key]}</dd></div>)}
    </dl> : null}
  </div>
}
