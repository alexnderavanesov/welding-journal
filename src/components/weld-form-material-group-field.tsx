import type { Ref } from 'react'
import { ArrowLeftRight, X } from 'lucide-react'
import { useDataListSettings } from '@/lib/data-list-settings'
import { splitWeldMaterialGroups } from '@/lib/weld-material-groups'

export function WeldFormMaterialGroupField({ value, inputRef, onChange }: {
  value?: string | null
  inputRef?: Ref<HTMLButtonElement>
  onChange: (value: string | null) => void
}) {
  const { materialGroups } = useDataListSettings()
  const selected = splitWeldMaterialGroups(value)
  const options = [...new Set([...materialGroups, ...selected])]
  const focusableOption = selected[0] ?? options[0]
  return <div role="group" aria-label="Группа материалов" className="flex h-12 min-w-0 items-center gap-2 rounded-md border border-input bg-white px-2 shadow-sm">
    <div className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch overflow-x-auto [scrollbar-width:thin]">
      {options.map(option => {
        const side = selected.indexOf(option)
        const disabled = side < 0 && selected.length >= 2
        return <span key={option} className="shrink-0" title={disabled ? 'Можно выбрать не более двух групп материалов. Сначала снимите одну из выбранных.' : undefined}>
          <button type="button" ref={option === focusableOption ? inputRef : undefined} aria-pressed={side >= 0} aria-label={option}
            aria-description={side >= 0 ? selected.length === 1 ? 'Группа для обеих сторон' : `Материал ${side + 1}: D${side + 1}/T${side + 1}` : undefined}
            disabled={disabled}
            onClick={() => onChange((side >= 0 ? selected.filter(group => group !== option) : [...selected, option]).join(' + ') || null)}
            className={`inline-flex h-8 items-center whitespace-nowrap rounded-md border px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400 ${side >= 0 ? 'border-sky-300 bg-sky-100 text-sky-900 shadow-sm' : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-sky-200 hover:bg-sky-50'} disabled:cursor-not-allowed disabled:opacity-40`}>
            {option}<sub aria-hidden="true" className="ml-0.5 inline-block w-4 shrink-0 translate-y-0.5 text-center text-[9px] leading-none text-sky-700 tabular-nums">
              {side >= 0 ? selected.length === 1 ? '1/2' : side + 1 : '\u00a0'}
            </sub>
          </button>
        </span>
      })}
    </div>
    <div className="flex shrink-0 items-center gap-1 border-l border-slate-100 pl-2">
      <span title={selected.length === 2 ? 'Поменять группы материалов 1 и 2 местами' : 'Для перестановки выберите две группы материалов'}>
        <button type="button" aria-label="Поменять 1 ↔ 2" disabled={selected.length !== 2} onClick={() => onChange([...selected].reverse().join(' + '))}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent">
          <ArrowLeftRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </span>
      <span title={selected.length ? 'Очистить группы материалов' : 'Группы материалов не выбраны'}>
        <button type="button" aria-label="Очистить" disabled={selected.length === 0} onClick={() => onChange(null)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent">
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </span>
    </div>
  </div>
}
