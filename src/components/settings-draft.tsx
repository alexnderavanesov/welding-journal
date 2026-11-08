import { createContext, useContext, useEffect, useRef, useState, type SetStateAction } from 'react'
import { Button } from './ui/button'
import { persistProjectSettingToRemoteAndWait, type ProjectSettingKey } from '@/lib/project-settings-remote'

export type ProtectedSettingsChange = (action: () => void | Promise<void>) => Promise<boolean>
export const SettingsDirtyContext = createContext<(source: string, dirty: boolean, busy?: boolean) => void>(() => {})

/** Each editor owns a source: saving one editor cannot clear another's dot. */
export function useSettingsDirty(source: string | null, dirty: boolean, busy = false) {
  const update = useContext(SettingsDirtyContext)
  useEffect(() => { if (source === null) return; update(source, dirty, busy); return () => update(source, false, false) }, [update, source, dirty, busy])
}

export async function persistSettingsDraft<T>(key: ProjectSettingKey, value: T, apply: (value: T, options: { syncRemote: false }) => unknown) {
  await persistProjectSettingToRemoteAndWait(key, value)
  apply(value, { syncRemote: false })
}

export function useSettingsDraft<T>(source: string | null, saved: T, protect: ProtectedSettingsChange, persist: (value: T, assertCurrent: () => void) => void | boolean | Promise<void | boolean>, signature: (value: T) => string = JSON.stringify) {
  const [draft, setDraft] = useState<{ value: T; base: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const busyRef = useRef(false)
  const savedRef = useRef(saved)
  savedRef.current = saved
  const savedKey = signature(saved)
  const value = draft?.value ?? saved
  const dirty = !!draft && signature(value) !== savedKey
  const stale = dirty && draft!.base !== savedKey
  useSettingsDirty(source, dirty, busy)
  useEffect(() => { setDraft(current => current && signature(current.value) === savedKey ? null : current) }, [savedKey, signature])
  const change = (next: SetStateAction<T>) => {
    if (busyRef.current) return
    setMessage('')
    setDraft(current => {
      const value = typeof next === 'function' ? (next as (current: T) => T)(current?.value ?? savedRef.current) : next
      const base = signature(savedRef.current)
      return signature(value) === base ? null : { base: current?.base ?? base, value }
    })
  }
  const reset = () => { if (!busyRef.current) { setDraft(null); setMessage('') } }
  const save = async (): Promise<boolean> => {
    if (!dirty || !draft || stale || busyRef.current) return false
    busyRef.current = true; setBusy(true); setMessage('')
    try {
      let applied = false
      const assertCurrent = () => {
        if (signature(savedRef.current) !== draft.base) throw new Error('Настройки изменились. Сбросьте черновик и повторите изменение.')
      }
      const done = await protect(async () => {
        assertCurrent()
        applied = await persist(value, assertCurrent) !== false
      })
      if (done && applied) { setDraft(null); setMessage('Изменения сохранены.') }
      return done && applied
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось сохранить изменения.'); return false }
    finally { busyRef.current = false; setBusy(false) }
  }
  return { value, change, reset, save, dirty, stale, busy, message }
}

export function SettingsDraftActions({ draft, label = 'Сохранить изменения', canSave = true }: {
  draft: Pick<ReturnType<typeof useSettingsDraft>, 'dirty' | 'stale' | 'busy' | 'message' | 'save' | 'reset'>
  label?: string
  canSave?: boolean
}) {
  return <div data-settings-save-footer className="min-h-24 space-y-2 py-2">
    {draft.dirty ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <span className="flex items-center gap-2 text-sm text-amber-900"><span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />Есть несохранённые изменения</span>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={draft.busy} onClick={draft.reset}>Сбросить изменения</Button><Button disabled={!canSave || draft.busy || draft.stale} onClick={() => void draft.save()}>{draft.busy ? 'Сохраняю…' : label}</Button></div>
    </div> : null}
    {draft.stale ? <p role="alert" className="text-sm text-amber-800">Сохранённые настройки изменились. Сбросьте изменения, чтобы загрузить свежие значения.</p> : null}
    {draft.message ? <p role="status" className="text-sm text-slate-700">{draft.message}</p> : null}
  </div>
}
