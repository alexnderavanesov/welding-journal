import { lazy, Suspense, useCallback, useEffect, useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BriefcaseBusiness, Eye, MoreHorizontal, RefreshCw, Search, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { AccessDialog } from './access-dialog'
import { ContextActionMenu, type ContextActionMenuState } from './context-action-menu'
import { PermissionEditor } from './permission-editor'
import { useAccess } from '@/lib/security-context'
import { ACCESS_PROFILES, PERMISSIONS, canManageAccount, type Permission } from '@/lib/access-permissions'
import type { AccountListUser } from '@/lib/account-user-labels'
import * as accounts from '@/server/account-api'

type Account = AccountListUser
type AccountAction = { user: Account; kind: 'invite' | 'recovery' | 'delete' }
export { accountRoleLabel } from '@/lib/account-user-labels'
const AccountUsersGrid = lazy(() => import('./account-users-grid'))
const EMPTY_USERS: Account[] = []

export function UsersPanel() {
  const { identity } = useAccess(), queryClient = useQueryClient()
  const users = useQuery({ queryKey: ['accounts'], queryFn: () => accounts.listAccounts(), refetchInterval: 120_000, refetchIntervalInBackground: false })
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    // Refresh relative labels locally; this timer never requests server data.
    const update = () => { if (document.visibilityState === 'visible') setNow(Date.now()) }
    const interval = window.setInterval(update, 60_000)
    document.addEventListener('visibilitychange', update)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', update) }
  }, [])
  const [message, setMessage] = useState(''), [failed, setFailed] = useState(false), [busy, setBusy] = useState(false)
  // Hold the revision at opening time: a background refresh must not let a stale draft overwrite new rights.
  const [editor, setEditor] = useState<Account | 'new' | null>(null)
  const [titleOnly, setTitleOnly] = useState(false)
  const [pending, setPending] = useState<AccountAction | null>(null)
  const [menu, setMenu] = useState<ContextActionMenuState>(null)
  const [search, setSearch] = useState('')
  const selected = editor && editor !== 'new' ? editor : null
  const current = selected ? users.data?.find(user => user.id === selected.id) : undefined
  const stale = !!selected && (!current || current.revision !== selected.revision)
  const editable = editor === 'new' || !!(identity && selected && current && canManageAccount(identity, current) && canManageAccount(identity, selected))

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setMessage(''); setFailed(false)
    try {
      const result = await action() as { sent?: boolean; message?: string } | undefined
      // Close the saved draft before publishing success or refreshing its revision:
      // dialog messages are errors, and the refreshed account makes that draft stale.
      setEditor(null); setPending(null)
      setMessage(result?.sent === false ? result.message ?? 'Изменения сохранены, но письмо не отправлено.' : result?.sent ? 'Письмо подготовлено и передано отправителю.' : 'Сохранено.')
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : 'Не удалось выполнить действие.')
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
    } finally { setBusy(false) }
  }
  const openEditor = useCallback((user: Account | 'new', onlyTitle = false) => { setMessage(''); setTitleOnly(onlyTitle); setEditor(user) }, [])
  const closeEditor = () => { if (!busy) setEditor(null) }
  const renderActions = useCallback((user: Account) => {
    const managed = identity && canManageAccount(identity, user)
    return <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => openEditor(user)}>{managed ? <ShieldCheck className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{managed ? 'Настроить права' : 'Посмотреть права'}</Button>
      {managed ? <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0" aria-label={`Действия пользователя: ${user.name}`} aria-haspopup="menu" aria-expanded={menu?.anchorElement?.getAttribute('data-account-id') === user.id} data-account-id={user.id} disabled={busy} onClick={event => {
        const anchor = event.currentTarget, rect = anchor.getBoundingClientRect()
        const choose = (kind: AccountAction['kind']) => { setMessage(''); setPending({ user, kind }) }
        setMenu({ x: rect.right - 224, y: rect.bottom + 4, anchorElement: anchor, heading: user.name, items: [
          { id: 'title', icon: BriefcaseBusiness, label: 'Изменить должность', onSelect: () => openEditor(user, true) },
          { id: 'link', icon: RefreshCw, label: user.status === 'pending' ? 'Повторить приглашение' : 'Восстановить доступ', onSelect: () => choose(user.status === 'pending' ? 'invite' : 'recovery') },
          { id: 'delete', icon: Trash2, label: 'Удалить', danger: true, onSelect: () => choose('delete') },
        ] })
      }}><MoreHorizontal aria-hidden="true" className="h-4 w-4" /></Button> : null}
    </div>
  }, [identity, busy, menu, openEditor])
  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-lg font-semibold text-slate-900">Сотрудники и доступ</h2><p className="mt-1 text-sm text-slate-500">Выберите пользователя, чтобы посмотреть или настроить его права. Должность на них не влияет.</p></div>
      <Button disabled={busy} onClick={() => openEditor('new')}><UserPlus className="h-4 w-4" />Пригласить пользователя</Button>
    </div>
    {message && !editor && !pending ? <p role={failed ? 'alert' : 'status'} className={`rounded-xl border p-4 text-sm ${failed ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-sky-100 bg-sky-50 text-sky-800'}`}>{message}</p> : null}
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/40">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
        <label className="relative min-w-48 flex-1 sm:max-w-sm"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input aria-label="Найти пользователя" placeholder="ФИО, почта или должность" value={search} onChange={event => setSearch(event.target.value)} className="pl-9" /></label>
        <span className="text-sm text-slate-500">Пользователей: {users.data?.length ?? '…'}</span>
        <Button variant="ghost" className="ml-auto" disabled={busy || users.isFetching} onClick={() => void users.refetch()}><RefreshCw className={`h-4 w-4 ${users.isFetching ? 'animate-spin' : ''}`} />Обновить список</Button>
      </div>
      {users.error ? <p role="alert" className="p-4 text-sm text-rose-700">Не удалось загрузить пользователей. Обновите список.</p> : null}
      {users.isPending ? <p className="p-8 text-center text-sm text-slate-500">Загружаем пользователей…</p> : <Suspense fallback={<p className="p-8 text-center text-sm text-slate-500">Загружаем таблицу…</p>}>
        <AccountUsersGrid users={users.data ?? EMPTY_USERS} selfId={identity?.id} available={!users.isError} now={now} search={search} renderActions={renderActions} />
      </Suspense>}
    </div>
    <ContextActionMenu menu={menu} autoFocus onClose={() => { setMenu(null); if (menu?.anchorElement instanceof HTMLElement && !document.querySelector('[aria-modal="true"]')) menu.anchorElement.focus({ preventScroll: true }) }} />
    {editor ? <UserAccessDialog key={editor === 'new' ? 'new' : `${editor.id}-${editor.revision}`} user={selected} editable={editable} stale={stale} busy={busy} titleOnly={titleOnly}
      owner={identity?.role === 'owner'} message={message} onClose={closeEditor} onReload={current ? () => { setMessage(''); setEditor(current) } : undefined}
      onSave={data => { if (stale || !editable) return; void run(() => selected ? accounts.changeAccount({ data: { id: selected.id, revision: selected.revision, role: data.role, permissions: data.permissions, title: data.title } }) : accounts.inviteAccount({ data })) }} /> : null}
    {pending ? <AccessDialog title={pending.kind === 'delete' ? 'Удалить пользователя?' : pending.kind === 'invite' ? 'Повторить приглашение?' : 'Восстановить доступ?'} description={`${pending.user.name} · ${pending.user.email}`} busy={busy} onClose={() => setPending(null)} footer={<><Button variant="outline" disabled={busy} onClick={() => setPending(null)}>Отмена</Button><Button variant={pending.kind === 'delete' ? 'destructive' : 'default'} disabled={busy} onClick={() => void run(() => pending.kind === 'delete' ? accounts.deleteAccount({ data: { id: pending.user.id, revision: pending.user.revision, confirmed: true } }) : accounts.sendManagedLink({ data: { id: pending.user.id, revision: pending.user.revision, kind: pending.kind } }))}>{pending.kind === 'delete' ? 'Удалить пользователя' : 'Отправить ссылку'}</Button></>}>
      <p className="text-sm leading-6 text-slate-600">{pending.kind === 'delete' ? 'Аккаунт будет удалён, а его сеансы завершены. Рабочие данные и история действий сохранятся.' : 'На почту пользователя будет отправлена новая ссылка. Прежняя ссылка перестанет действовать.'}</p>{message ? <p role="alert" className="mt-4 text-sm text-rose-700">{message}</p> : null}
    </AccessDialog> : null}
  </section>
}

function UserAccessDialog({ user, editable, stale, busy, owner, titleOnly, message, onClose, onReload, onSave }: {
  user: Account | null; editable: boolean; stale: boolean; busy: boolean; owner: boolean; message: string; onClose: () => void; onReload?: () => void
  titleOnly: boolean
  onSave: (data: { name: string; email: string; title: string; role: 'user' | 'admin'; permissions: Permission[] }) => void
}) {
  const formId = useId()
  const [permissions, setPermissions] = useState<Permission[]>(user?.permissions ?? [...ACCESS_PROFILES.reader.permissions])
  const [role, setRole] = useState<'user' | 'admin'>(user?.role === 'admin' ? 'admin' : 'user')
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [title, setTitle] = useState(user?.title ?? '')
  const fullAccess = user?.role === 'owner' || role === 'admin'
  if (titleOnly && user) return <AccessDialog title="Должность пользователя" description={`${user.name} · ${user.email}`} busy={busy} onClose={onClose}
    footer={<><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Отмена</Button><Button type="submit" form={formId} disabled={busy || stale || !editable}>{busy ? 'Сохраняем…' : 'Сохранить должность'}</Button></>}>
    <form id={formId} className="space-y-4" onSubmit={event => {
      event.preventDefault()
      if (editable && !stale && !busy) onSave({ name: user.name, email: user.email, title, role, permissions })
    }}>
      <label className="grid gap-2 text-sm font-medium text-slate-700">Должность<Input autoFocus value={title} readOnly={!editable} disabled={busy} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder="Например, инженер по сварке" /></label>
      <p className="text-sm leading-6 text-slate-500">Должность не меняет права доступа. Чтобы убрать должность, очистите поле и сохраните.</p>
      {message ? <p role="alert" className="text-sm text-rose-700">{message}</p> : null}
      {stale ? <div role="alert" className="space-y-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Учётная запись изменилась. Загрузите актуальные данные перед сохранением.{onReload ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onReload}>Загрузить актуальные данные</Button> : null}</div> : null}
      {!editable ? <p role="alert" className="text-sm text-rose-700">Нет разрешения изменять этого пользователя.</p> : null}
    </form>
  </AccessDialog>
  return <AccessDialog title={user ? `${editable ? 'Настройка прав' : 'Права доступа'}: ${user.name}` : 'Пригласить пользователя'} description={user ? user.email : 'Пользователь получит письмо и самостоятельно задаст пароль.'} wide busy={busy} onClose={onClose}
    footer={<><span className="mr-auto text-xs text-slate-500">{fullAccess ? 'Все рабочие разрешения' : `Выбрано разрешений: ${permissions.length}`}</span><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{editable ? 'Отмена' : 'Закрыть'}</Button>{editable ? <Button type="submit" form={formId} disabled={busy || stale}>{busy ? 'Сохраняем…' : user ? 'Сохранить права' : 'Создать и отправить приглашение'}</Button> : null}</>}>
    <form id={formId} className="space-y-5" onSubmit={event => { event.preventDefault(); if (editable && !stale && !busy) onSave({ name, email, title, role, permissions }) }}>
      {message ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{message}</p> : null}
      {stale ? <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Учётная запись изменилась. Загрузите актуальные права перед сохранением.{onReload ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onReload}>Загрузить актуальные права</Button> : null}</div> : null}
      {!user ? <fieldset disabled={busy} className="grid gap-4 md:grid-cols-3"><label className="grid gap-2 text-sm text-slate-700">Фамилия и имя<Input value={name} onChange={event => setName(event.target.value)} maxLength={200} required /></label><label className="grid gap-2 text-sm text-slate-700">Почта<Input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></label><label className="grid gap-2 text-sm text-slate-700">Должность<Input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} placeholder="Не определяет права" /></label></fieldset> : null}
      {user ? <label className="grid max-w-md gap-2 text-sm font-medium text-slate-700">Должность<Input value={title} readOnly={!editable} disabled={busy} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder="Назначает администратор" /></label> : null}
      {editable ? <div className="space-y-2"><p className="text-sm font-medium text-slate-700">Набор прав</p><div className="flex flex-wrap gap-2">
        <Button type="button" variant={role === 'admin' ? 'default' : 'outline'} disabled={busy || !owner} title={!owner ? 'Администраторов назначает владелец' : undefined} onClick={() => setRole('admin')}>Администратор</Button>
        {Object.entries(ACCESS_PROFILES).map(([key, profile]) => <Button key={key} type="button" variant="outline" disabled={busy} onClick={() => { setRole('user'); setPermissions([...profile.permissions]) }}>{profile.label}</Button>)}
      </div><p className="text-xs leading-5 text-slate-500">Набор заменяет галочки. «Инженер» — изменение в журнале, ЛНК и ПСТО, документы и выгрузка. Дополнительные права выберите вручную.</p></div> : null}
      {fullAccess ? <p className="rounded-lg bg-sky-50 p-4 text-sm leading-6 text-sky-800">{user?.role === 'owner' ? 'Владелец имеет все права. Его аккаунт защищён от удаления и изменения доступа.' : 'Администратор имеет все рабочие права и управляет обычными пользователями. Управление администраторами остаётся у владельца.'} Галочки ниже показывают действующий доступ.</p> : !editable ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Просмотр прав. Свои права нельзя изменить самостоятельно; права администратора меняет владелец.</p> : null}
      <PermissionEditor value={fullAccess ? PERMISSIONS : permissions} onChange={setPermissions} disabled={!editable || fullAccess || busy} />
    </form>
  </AccessDialog>
}
