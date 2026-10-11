import { ChevronDown, Layers } from 'lucide-react'
import { SYSTEM_DOCUMENT_SPLIT_MODE_OPTIONS, type SystemDocumentSplitMode } from '@/lib/system-document-splitting'

/** Native keyboard/menu behaviour, presented as the compact document grouping badge. */
export function DocumentSplitModeSelect({ value, onChange, disabled, label = 'Разделение документов' }: {
  value: SystemDocumentSplitMode; onChange: (value: SystemDocumentSplitMode) => void; disabled?: boolean; label?: string
}) {
  return <label className={`relative inline-flex min-h-9 items-center gap-2 rounded-lg border border-sky-100 bg-sky-50/60 px-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-sky-400 ${disabled ? 'opacity-50' : 'hover:border-sky-200 hover:bg-sky-50'}`}>
    <Layers aria-hidden="true" className="h-4 w-4 shrink-0 text-sky-600" />
    <span aria-hidden="true" className="text-slate-500">Разделение: <strong className="font-semibold text-slate-800">{SYSTEM_DOCUMENT_SPLIT_MODE_OPTIONS.find(option => option.id === value)?.label.toLocaleLowerCase('ru-RU')}</strong></span>
    <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
    <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value as SystemDocumentSplitMode)}
      className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed">
      {SYSTEM_DOCUMENT_SPLIT_MODE_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
  </label>
}
