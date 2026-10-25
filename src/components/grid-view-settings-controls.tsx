import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export type GridDensity = 'compact' | 'comfortable' | 'spacious'
export type GridTheme = 'quartz' | 'alpine' | 'balham'

const DENSITIES = [
  { value: 'compact', label: 'Компактно', description: 'Больше строк на экране' },
  { value: 'comfortable', label: 'Комфортно', description: 'Для ежедневной работы' },
  { value: 'spacious', label: 'Просторно', description: 'Больше воздуха между строками' },
] as const
const THEMES = [
  { id: 'quartz', name: 'Светлая', detail: 'Quartz · мягкие границы и голубой акцент' },
  { id: 'alpine', name: 'Классическая', detail: 'Alpine · контрастная шапка и зелёный акцент' },
  { id: 'balham', name: 'Нейтральная', detail: 'Balham · строгие линии и серые оттенки' },
] as const

export function GridDensitySelect({ value, onChange, label = 'Плотность строк' }: {
  value: GridDensity; onChange: (value: GridDensity) => void; label?: string
}) {
  const id = useId(), [open, setOpen] = useState(false), [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  const select = (index: number) => { onChange(DENSITIES[index].value); setOpen(false); trigger.current?.focus({ preventScroll: true }) }
  return <div className="journal-setting-row"><span id={`${id}-label`}>Плотность строк</span><div ref={root} className="journal-density-select" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); setOpen(true)
      setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? 2 : !open ? DENSITIES.findIndex(item => item.value === value) : (index + (event.key === 'ArrowDown' ? 1 : 2)) % 3)
    } else if (open && ['Enter', ' '].includes(event.key)) { event.preventDefault(); select(active) }
    else if (event.key === 'Tab') setOpen(false)
  }}>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open ? `${id}-${active}` : undefined} className="journal-button" onClick={() => { trigger.current?.focus({ preventScroll: true }); setActive(DENSITIES.findIndex(item => item.value === value)); setOpen(!open) }}>{DENSITIES.find(item => item.value === value)?.label}<ChevronDown size={14} /></button>
    {open ? <div id={`${id}-options`} role="listbox" aria-label={label} className="journal-density-options">{DENSITIES.map((item, index) => <button key={item.value} id={`${id}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={value === item.value} data-active={active === index} onMouseEnter={() => setActive(index)} onClick={() => select(index)}><span><strong>{item.label}</strong><small>{item.description}</small></span>{value === item.value ? <Check size={15} /> : null}</button>)}</div> : null}
  </div></div>
}

export function GridAppearanceSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId()
  return <div className="journal-setting-row"><span id={id}>{label}</span><button type="button" className="journal-switch" role="switch" aria-labelledby={id} aria-checked={checked} onClick={() => onChange(!checked)}><span /></button></div>
}

export function GridThemeChoices({ value, onChange, label = 'Тема таблицы', note = 'Оформление меняется сразу. Тема сохраняется в вашем браузере и в «Моих видах».' }: { value: GridTheme; onChange: (value: GridTheme) => void; label?: string; note?: string }) {
  return <div className="journal-theme-list" role="radiogroup" aria-label={label}>
    <p className="journal-panel-note">{note}</p>
    {THEMES.map(item => <button key={item.id} type="button" role="radio" aria-checked={value === item.id} className={`journal-theme-choice journal-theme-preview-${item.id}`} onClick={() => onChange(item.id)}>
      <span className="journal-theme-swatch" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
      <span><strong>{item.name}</strong><small>{item.detail}</small></span>
      <span className="journal-theme-check" aria-hidden="true">{value === item.id ? <Check size={15} /> : null}</span>
    </button>)}
  </div>
}
