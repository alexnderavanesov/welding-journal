import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { SettingsDraftActions, useSettingsDraft } from '@/components/settings-draft'
import { Input } from '@/components/ui/input'
import { saveAssignmentWarningSettings, useAssignmentWarningSettings } from '@/lib/assignment-warning-settings'
import { WARNING_CONNECTION_TYPES } from '@/lib/assignment-warnings'

function WarningTextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fitHeight = useCallback(() => {
    const input = inputRef.current
    if (!input || input.clientWidth === 0) return
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`
  }, [])

  useLayoutEffect(fitHeight, [fitHeight, value])
  useEffect(() => {
    const input = inputRef.current
    if (!input || typeof ResizeObserver === 'undefined') return
    let width = input.clientWidth
    let frame: number | null = null
    const observer = new ResizeObserver(() => {
      if (input.clientWidth === width) return
      width = input.clientWidth
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { frame = null; fitHeight() })
    })
    observer.observe(input)
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [fitHeight])

  return <textarea ref={inputRef} aria-label={label} rows={1} maxLength={2000} value={value}
    className="block min-h-0 w-full resize-none overflow-hidden rounded-lg border border-input bg-slate-50/50 px-3 py-2.5 text-sm leading-6 text-slate-800 shadow-sm shadow-slate-200/30 outline-none transition-colors hover:border-slate-300 focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:text-slate-500"
    onChange={event => onChange(event.target.value)} />
}

export function AssignmentWarningSettingsPanel({ runProtectedSettingsChange, onDirtyChange }: {
  runProtectedSettingsChange: (action: () => void | Promise<void>) => Promise<boolean>
  onDirtyChange: (dirty: boolean) => void
}) {
  const saved = useAssignmentWarningSettings()
  const editor = useSettingsDraft('rules.warnings.editor', saved, runProtectedSettingsChange, value => saveAssignmentWarningSettings(value))
  const { value: settings, change, dirty, busy } = editor
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  return <div className="space-y-4">
    <p className="text-sm text-slate-600">При выборе «Да» или «Дополнительный» система попросит подтвердить назначение. Кнопка «Нет, оставить пусто» очищает это назначение и оставляет окно открытым. Настройки общие для всех пользователей.</p>
    <fieldset disabled={busy} className="space-y-4">
      {(['uzk', 'rk'] as const).map(method => <section key={method} className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-sky-600" checked={settings[method].enabled}
            onChange={event => change({ ...settings, [method]: { ...settings[method], enabled: event.target.checked } })} />
          {method === 'uzk' ? 'УЗК при малом Д мин' : 'РК на угловом стыке (У)'}
        </label>
        {method === 'uzk' ? <div className="space-y-2">
          <p className="text-sm text-slate-600">Предупреждать, если Д мин стыка меньше или равен порогу для его типа.</p>
          <div className="grid max-w-xl gap-3 sm:grid-cols-3">{WARNING_CONNECTION_TYPES.map(type => <label key={type} className="space-y-1 block text-sm">
            <span>Тип {type} — Д мин ≤, мм</span>
            <Input type="number" min="0" step="any" aria-label={`Порог Д мин для ${type}`} placeholder="Не задан" value={settings.uzk.thresholds[type] ?? ''}
              onChange={event => change({ ...settings, uzk: { ...settings.uzk, thresholds: { ...settings.uzk.thresholds, [type]: event.target.value === '' ? null : Number(event.target.value) } } })} />
          </label>)}</div>
          <p className="text-xs text-slate-500">Если порог или Д мин стыка не указан, предупреждение для этого типа не появляется.</p>
        </div> : null}
        <label className="block space-y-1.5 text-sm"><span className="font-medium text-slate-700">Текст предупреждения {method === 'uzk' ? 'УЗК' : 'РК'}</span>
          <WarningTextInput label={`Текст предупреждения ${method === 'uzk' ? 'УЗК' : 'РК'}`} value={settings[method].text}
            onChange={text => change({ ...settings, [method]: { ...settings[method], text } })} />
        </label>
      </section>)}
      <SettingsDraftActions draft={editor} label="Сохранить предупреждения" />
    </fieldset>
  </div>
}
