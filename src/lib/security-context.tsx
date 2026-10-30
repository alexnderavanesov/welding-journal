import { createContext, useCallback, useContext, useEffect, useState, useRef, type FormEvent, type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getCurrentAccount, refreshAccountActivity } from '@/server/account-api'
import { watchAccountActivity } from './account-activity'
import { hasPermission, REPORT_ACCESS_AREAS, type AccessIdentity, type Permission } from './access-permissions'
import { getActiveReportFromPath } from './app-report-routes'
import { setStorageIdentity } from './user-storage'

export const ACCESS_EXPIRED_EVENT = 'welding-access-expired'
type AccessValue = { identity: AccessIdentity | null; loading: boolean; error: string; refresh: () => Promise<void>; can: (permission: Permission) => boolean }
const Context = createContext<AccessValue | null>(null)
export function SecurityProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [identity, setIdentity] = useState<AccessIdentity | null>(null)
  const refreshSequence = useRef(0)
  const currentIdentity = useRef<AccessIdentity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current
    try {
      const next = await (document.visibilityState === 'visible' ? refreshAccountActivity() : getCurrentAccount())
      if (sequence !== refreshSequence.current) return
      if (currentIdentity.current?.id !== next?.id || currentIdentity.current?.revision !== next?.revision) queryClient.clear()
      setStorageIdentity(next?.id ?? null, currentIdentity.current?.revision !== next?.revision); currentIdentity.current = next
      // A fresh RPC object with unchanged contents must not rebuild table
      // columns and discard an open filter. Compare every public identity field,
      // so changed permissions/profile data still propagate immediately.
      setIdentity(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
      setError('')
    } catch (reason) { if (sequence !== refreshSequence.current) return; setIdentity(null); currentIdentity.current = null; setStorageIdentity(null); queryClient.clear(); setError(reason instanceof Error ? reason.message : 'Не удалось проверить доступ.') }
    finally { setLoading(false) }
  }, [queryClient])
  useEffect(() => {
    const stop = watchAccountActivity(refresh)
    const check = () => { void refresh() }
    window.addEventListener(ACCESS_EXPIRED_EVENT, check)
    return () => { stop(); window.removeEventListener(ACCESS_EXPIRED_EVENT, check) }
  }, [refresh])

  return <Context.Provider value={{ identity, loading, error, refresh, can: permission => hasPermission(identity, permission) }}>{children}</Context.Provider>
}
export function useAccess() { const value = useContext(Context); if (!value) throw new Error('Не подключена проверка доступа.'); return value }
export function useSecurityGuard() {
  const { can } = useAccess()
  const area = typeof window === 'undefined' ? 'welding' : REPORT_ACCESS_AREAS[getActiveReportFromPath(window.location.pathname)] ?? 'welding'
  const allowed = async (permission: Permission) => {
    if (can(permission)) return true
    window.alert('Недостаточно прав для этого действия. Обратитесь к администратору.')
    return false
  }
  return {
    requireSettingsChangePassword: async () => ['templates', 'checks', 'dispatcher', 'exceptions', 'numbering', 'data', 'wdi', 'processes', 'indexes', 'references'].some(key => can(`${key}.edit` as Permission)),
    requireEditPassword: (_label?: string) => allowed(`${area}.edit`),
    requireImportPassword: (_label?: string) => allowed(`${area}.import`),
    requireDocumentGenerationPassword: (_label?: string) => allowed(area === 'documents' ? 'documents.generate' : `${area}.generate`),
    requireDeletePassword: (_label?: string) => allowed(`${area}.delete`),
  }
}
export function SiteSecurityGate({ children }: { children: ReactNode }) {
  const { identity, loading, error, refresh } = useAccess()
  const pathname = useRouterState({ select: state => state.location.pathname })
  if (loading) return <div className="p-10 text-center text-slate-600">Проверяем доступ…</div>
  if (error) return <div role="alert" className="mx-auto mt-24 max-w-lg space-y-4 rounded-lg border bg-white p-6"><h1>Доступ временно недоступен</h1><p>{error}</p><Button onClick={() => void refresh()}>Повторить проверку</Button></div>
  if (!identity) return <SignInForm />
  const page = REPORT_ACCESS_AREAS[getActiveReportFromPath(pathname)]
  const ordinaryPage = !['/account', '/activity', '/settings', '/user-guide'].includes(pathname)
  if (ordinaryPage && page && !hasPermission(identity, `${page}.view`)) return <main className="p-10"><p>Доступ к этому разделу не предоставлен.</p><a href="/account" className="text-sky-700 underline">Открыть мой профиль</a></main>
  return <div key={`${identity.id}:${identity.revision}`} className="contents">{children}</div>
}
function SignInForm() {
  const { refresh } = useAccess()
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const { authClient } = await import('./auth-client')
      const result = await authClient.signIn.email({ email, password, rememberMe: true })
      if (result.error) throw new Error('Не удалось войти. Проверьте почту и пароль. Если приглашение не активировано, откройте ссылку из письма.')
      setPassword(''); await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось войти.') }
    finally { setBusy(false) }
  }
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
    <div><p className="text-sm text-slate-500">Учёт сварки трубопроводов</p><h1 className="mt-2 text-2xl font-semibold">Вход в систему</h1></div>
    <label className="grid gap-2 text-sm">Почта<Input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label>
    <label className="grid gap-2 text-sm">Пароль<Input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</Button>
    <p className="text-sm leading-6 text-slate-500">Доступ предоставляется по приглашению. Для восстановления пароля обратитесь к администратору.</p>
  </form></main>
}
