import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { AppSidebar } from './app-sidebar'
import { SiteSecurityGate, useAccess } from '@/lib/security-context'
import { UsersPanel, accountRoleLabel } from './account-users-panel'
import { UserRound, UsersRound, LogOut, BookOpenText, ClipboardList } from 'lucide-react'
import { getAppReportPath } from '@/lib/app-report-routes'
import { clearChunkReloadAttempt } from '@/lib/chunk-load-recovery'
import { setStorageIdentity } from '@/lib/user-storage'
import * as accounts from '@/server/account-api'

export function AccountWorkspace({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  return <SiteSecurityGate><AppSidebar activeReport="settings" collapsed={collapsed} onCollapsedChange={setCollapsed}
    onReportChange={report => { window.location.href = getAppReportPath(report) }} />
    <main className={`${collapsed ? 'ml-16' : 'ml-48 lg:ml-64'} min-h-screen min-w-0 bg-slate-50 p-4 lg:p-8`}>{children}</main></SiteSecurityGate>
}
const ActivityPanel = lazy(() => import('./activity-page').then(module => ({ default: module.ActivityPanel })))
const UserGuidePage = lazy(() => import('./user-guide-page').then(module => ({ default: module.UserGuidePage })))
type AccountTab = 'profile' | 'users' | 'activity' | 'guide'
export function AccountPage({ initialTab }: { initialTab?: AccountTab }) { return <AccountWorkspace><AccountPanel initialTab={initialTab} /></AccountWorkspace> }
function AccountPanel({ initialTab }: { initialTab?: AccountTab }) {
  const { identity, refresh, can } = useAccess()
  const queryClient = useQueryClient()
  const [requestedTab, setTab] = useState<AccountTab>(() => initialTab ?? (new URLSearchParams(window.location.search).get('tab') as AccountTab) ?? 'profile')
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const [name, setName] = useState(identity?.name ?? ''), [title, setTitle] = useState(identity?.title ?? '')
  useEffect(() => { const timer = window.setTimeout(() => clearChunkReloadAttempt(window.location.pathname), 30000); return () => window.clearTimeout(timer) }, [])
  const [currentPassword, setCurrentPassword] = useState(''), [password, setPassword] = useState(''), [repeat, setRepeat] = useState('')
  if (!identity) return null
  const jointId = new URLSearchParams(window.location.search).get('jointId')
  const tabs = [
    { id: 'profile', label: 'Мой профиль', icon: UserRound },
    ...(identity.role !== 'user' ? [{ id: 'users', label: 'Пользователи и права', icon: UsersRound }] : []),
    ...(can('history.view') || jointId && can('history.joint') ? [{ id: 'activity', label: 'Журнал действий', icon: ClipboardList }] : []),
    { id: 'guide', label: 'Руководство', icon: BookOpenText },
  ]
  const tab = tabs.some(item => item.id === requestedTab) ? requestedTab : requestedTab === 'activity' ? 'activity' : 'profile'
  function changeTab(next: AccountTab) {
    setTab(next)
    const url = new URL(window.location.href)
    url.pathname = '/account'; url.searchParams.set('tab', next)
    if (next !== 'activity') url.searchParams.delete('jointId')
    window.history.replaceState(window.history.state, '', url)
  }
  async function action(run: () => Promise<unknown>) {
    setBusy(true); setMessage('')
    try { await run(); await refresh(); setMessage('Сохранено.'); await queryClient.invalidateQueries({ queryKey: ['accounts'] }) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось выполнить действие.'); await queryClient.invalidateQueries({ queryKey: ['accounts'] }) }
    finally { setBusy(false) }
  }
  function leaveSession() { setStorageIdentity(null); queryClient.clear(); window.location.assign('/account') }
  async function signOut() { const { authClient } = await import('@/lib/auth-client'); const result = await authClient.signOut(); if (result.error) throw new Error('Не удалось завершить сеанс.'); leaveSession() }
  return <div className="mx-auto max-w-[1500px] space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight text-slate-900">{tabs.find(item => item.id === tab)?.label ?? 'Журнал действий'}</h1><p className="mt-1 text-sm text-slate-500">{identity.name} · {accountRoleLabel(identity.role)}</p></div><Button variant="outline" disabled={busy} onClick={() => void action(signOut)}><LogOut className="h-4 w-4" />Выйти</Button></header>
    <div role="tablist" aria-label="Аккаунт и доступ" className="flex gap-1 overflow-x-auto border-b border-slate-200" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const index = tabs.findIndex(item => item.id === tab)
      const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length].id as AccountTab
      changeTab(next); document.getElementById(`account-tab-${next}`)?.focus()
    }}>{tabs.map(item => <button type="button" role="tab" key={item.id} id={`account-tab-${item.id}`} aria-controls={`account-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} disabled={busy} onClick={() => changeTab(item.id as AccountTab)} className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 ${tab === item.id ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'}`}><item.icon className="h-4 w-4" />{item.label}</button>)}</div>
    <div id="account-panel-profile" role="tabpanel" aria-labelledby="account-tab-profile" hidden={tab !== 'profile'} className="space-y-5">
    {message ? <p role="status" className="rounded-lg border bg-white p-4 text-sm">{message}</p> : null}
    <div className="grid gap-6 xl:grid-cols-2"><form className="space-y-4 rounded-xl border bg-white p-6" onSubmit={event => { event.preventDefault(); void action(() => accounts.updateOwnProfile({ data: { name, title: identity.role === 'user' ? identity.title : title, revision: identity.revision } })) }}>
      <h2 className="font-semibold text-slate-900">Личные данные</h2><Field label="ФИО"><Input value={name} onChange={event => setName(event.target.value)} maxLength={200} required /></Field>
      <Field label="Должность"><Input value={identity.role === 'user' ? identity.title : title} readOnly={identity.role === 'user'} onChange={event => setTitle(event.target.value)} maxLength={200} /></Field>
      <Field label="Почта"><Input value={identity.email} readOnly /></Field><p className="text-sm text-slate-500">Адрес входа изменить нельзя. Должность назначает администратор; она не определяет права доступа.</p>
      <Button disabled={busy}>Сохранить профиль</Button>
    </form><form className="space-y-4 rounded-xl border bg-white p-6" onSubmit={event => { event.preventDefault(); if (password !== repeat) { setMessage('Пароли не совпадают.'); return }
      void action(async () => { await accounts.changeOwnPassword({ data: { currentPassword, password } }); setPassword(''); setRepeat(''); setCurrentPassword(''); leaveSession() }) }}>
      <h2 className="font-semibold">Смена пароля</h2><Field label="Текущий пароль"><Input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></Field>
      <Field label="Новый пароль"><Input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} minLength={6} maxLength={128} required /></Field>
      <Field label="Повторите новый пароль"><Input type="password" autoComplete="new-password" value={repeat} onChange={event => setRepeat(event.target.value)} required /></Field>
      <p className="text-sm text-slate-500">От 6 символов. После смены пароля потребуется заново войти на всех устройствах.</p><Button disabled={busy}>Изменить пароль</Button>
    </form></div>
    </div>
    {identity.role !== 'user' && tab === 'users' ? <div id="account-panel-users" role="tabpanel" aria-labelledby="account-tab-users"><UsersPanel /></div> : null}
    {tab === 'activity' || tab === 'guide' ? <div id={`account-panel-${tab}`} role="tabpanel" aria-labelledby={`account-tab-${tab}`}><Suspense fallback={<p className="p-6 text-sm text-slate-500">Загрузка…</p>}>{tab === 'activity' ? <ActivityPanel embedded /> : <UserGuidePage />}</Suspense></div> : null}
  </div>
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-2 text-sm font-medium text-slate-700">{label}{children}</label> }
