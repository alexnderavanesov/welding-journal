import { useEffect, useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, RefreshCw, Search, ShieldCheck, UserPlus } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { AccessDialog } from './access-dialog'
import { PermissionEditor } from './permission-editor'
import { FieldHelp } from './field-help'
import { useAccess } from '@/lib/security-context'
import { ACCESS_PROFILES, PERMISSIONS, canManageAccount, type Permission } from '@/lib/access-permissions'
import { formatAccountActivityTime } from '@/lib/account-activity-label'
import * as accounts from '@/server/account-api'

type Account = Awaited<ReturnType<typeof accounts.listAccounts>>[number]
type AccountAction = { user: Account; kind: 'invite' | 'recovery' | 'delete' }
export const accountRoleLabel = (role: string) => role === 'owner' ? 'Владелец системы' : role === 'admin' ? 'Администратор' : 'Пользователь'

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
  const [pending, setPending] = useState<AccountAction | null>(null)
  const [search, setSearch] = useState('')
  const selected = editor && editor !== 'new' ? editor : null
  const current = selected ? users.data?.find(user => user.id === selected.id) : undefined
  const stale = !!selected && (!current || current.revision !== selected.revision)
  const editable = editor === 'new' || !!(identity && selected && current && canManageAccount(identity, current) && canManageAccount(identity, selected))
  const visible = users.data?.filter(user => `${user.name} ${user.email} ${user.title}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? []

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setMessage(''); setFailed(false)
    try {
      const result = await action() as { sent?: boolean; message?: string } | undefined
      setMessage(result?.sent === false ? result.message ?? 'Изменения сохранены, но письмо не отправлено.' : result?.sent ? 'Письмо подготовлено и передано отправителю.' : 'Сохранено.')
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      setEditor(null); setPending(null)
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : 'Не удалось выполнить действие.')
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
    } finally { setBusy(false) }
  }
  function openEditor(user: Account | 'new') { setMessage(''); setEditor(user) }
  const closeEditor = () => { if (!busy) setEditor(null) }
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
      {users.isPending ? <p className="p-8 text-center text-sm text-slate-500">Загружаем пользователей…</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-slate-50 text-xs font-medium text-slate-500"><tr><th className="px-5 py-3">Пользователь</th><th className="px-4 py-3">Уровень доступа</th><th className="px-4 py-3"><span className="inline-flex items-center gap-1.5">Статус аккаунта<FieldHelp label="Что означает статус аккаунта">Активирован — пользователь задал пароль и может входить в систему с выданными правами. Ожидает активации — приглашение ещё не принято. Присутствие на сайте показано отдельно в столбце «Активность».</FieldHelp></span></th><th className="px-4 py-3"><span className="inline-flex items-center gap-1.5">Активность<FieldHelp label="Как определяется активность">Онлайн — пользователь работал на сайте в последние 3 минуты и ещё не вышел. Учитываются все устройства. Недавняя активность показана как «3 минуты назад»; точное время по Москве — при наведении. Список обновляется раз в 2 минуты; после закрытия вкладки статус может измениться с задержкой до 5 минут. Кнопка «Обновить список» запрашивает данные сразу.</FieldHelp></span></th><th className="px-5 py-3">Действия</th></tr></thead>
        <tbody>{visible.map(user => {
          const managed = identity && canManageAccount(identity, user)
          return <tr key={user.id} className="border-t border-slate-100 align-top hover:bg-slate-50/70">
            <td className="px-5 py-4"><p className="font-medium text-slate-800">{user.name}{identity?.id === user.id ? <span className="ml-2 text-xs font-normal text-slate-400">Это вы</span> : null}</p><p className="mt-1 text-slate-500">{user.email}</p>{user.title ? <p className="mt-1 text-xs text-slate-400">{user.title}</p> : null}</td>
            <td className="px-4 py-4"><span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${user.role === 'user' ? 'bg-slate-100 text-slate-600' : 'bg-sky-50 text-sky-700'}`}>{accountRoleLabel(user.role)}</span><p className="mt-2 text-xs text-slate-500">{user.role === 'user' ? `${user.permissions.length} разрешений` : 'Все рабочие права'}</p></td>
            <td className="px-4 py-4"><span className={`inline-flex items-center gap-1.5 text-xs font-medium ${user.status === 'active' ? 'text-emerald-700' : 'text-amber-700'}`}><span className={`h-1.5 w-1.5 rounded-full ${user.status === 'active' ? 'bg-emerald-500' : 'bg-amber-400'}`} />{user.status === 'active' ? 'Активирован' : 'Ожидает активации'}</span>{user.linkExpiresAt ? <p className="mt-2 max-w-40 text-xs leading-5 text-slate-400">Ссылка до {new Date(user.linkExpiresAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК</p> : null}</td>
            <td className="px-4 py-4"><AccountActivity user={user} available={!users.isError} now={now} /></td>
            <td className="px-5 py-4"><Button variant="outline" size="sm" disabled={busy} onClick={() => openEditor(user)}>{managed ? <ShieldCheck className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{managed ? 'Настроить права' : 'Посмотреть права'}</Button>
              {managed ? <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1"><button className="rounded text-xs text-slate-500 hover:text-sky-700 focus-visible:ring-2 focus-visible:ring-sky-300" disabled={busy} onClick={() => { setMessage(''); setPending({ user, kind: user.status === 'pending' ? 'invite' : 'recovery' }) }}>{user.status === 'pending' ? 'Повторить приглашение' : 'Восстановить доступ'}</button><button className="rounded text-xs text-slate-400 hover:text-rose-700 focus-visible:ring-2 focus-visible:ring-rose-300" disabled={busy} onClick={() => { setMessage(''); setPending({ user, kind: 'delete' }) }}>Удалить</button></div> : null}
            </td>
          </tr>
        })}</tbody>
      </table>{!visible.length && !users.error ? <p className="p-8 text-center text-sm text-slate-500">Пользователи не найдены.</p> : null}</div>}
    </div>
    {editor ? <UserAccessDialog key={editor === 'new' ? 'new' : `${editor.id}-${editor.revision}`} user={selected} editable={editable} stale={stale} busy={busy}
      owner={identity?.role === 'owner'} message={message} onClose={closeEditor} onReload={current ? () => { setMessage(''); setEditor(current) } : undefined}
      onSave={data => { if (stale || !editable) return; void run(() => selected ? accounts.changeAccount({ data: { id: selected.id, revision: selected.revision, role: data.role, permissions: data.permissions, title: data.title } }) : accounts.inviteAccount({ data })) }} /> : null}
    {pending ? <AccessDialog title={pending.kind === 'delete' ? 'Удалить пользователя?' : pending.kind === 'invite' ? 'Повторить приглашение?' : 'Восстановить доступ?'} description={`${pending.user.name} · ${pending.user.email}`} busy={busy} onClose={() => setPending(null)} footer={<><Button variant="outline" disabled={busy} onClick={() => setPending(null)}>Отмена</Button><Button variant={pending.kind === 'delete' ? 'destructive' : 'default'} disabled={busy} onClick={() => void run(() => pending.kind === 'delete' ? accounts.deleteAccount({ data: { id: pending.user.id, revision: pending.user.revision, confirmed: true } }) : accounts.sendManagedLink({ data: { id: pending.user.id, revision: pending.user.revision, kind: pending.kind } }))}>{pending.kind === 'delete' ? 'Удалить пользователя' : 'Отправить ссылку'}</Button></>}>
      <p className="text-sm leading-6 text-slate-600">{pending.kind === 'delete' ? 'Аккаунт будет удалён, а его сеансы завершены. Рабочие данные и история действий сохранятся.' : 'На почту пользователя будет отправлена новая ссылка. Прежняя ссылка перестанет действовать.'}</p>{message ? <p role="alert" className="mt-4 text-sm text-rose-700">{message}</p> : null}
    </AccessDialog> : null}
  </section>
}

function AccountActivity({ user, available, now }: { user: Account; available: boolean; now: number }) {
  if (!available) return <span className="text-xs text-slate-400">Нет связи</span>
  if (user.online) return <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Онлайн</span>
  if (!user.lastActiveAt) return <span className="text-xs text-slate-400" title={user.status === 'pending' ? undefined : 'Активность появится после следующего открытия сайта.'}>{user.status === 'pending' ? 'Ещё не входил' : 'Нет данных'}</span>
  const time = formatAccountActivityTime(user.lastActiveAt, now)
  if (!time) return <span className="text-xs text-slate-400">Нет данных</span>
  return <div className="text-xs leading-5 text-slate-500"><p>Был(а) на сайте</p><time className="whitespace-nowrap" dateTime={time.iso} title={time.exact} aria-label={`${time.label}; ${time.exact}`}>{time.label}</time></div>
}

function UserAccessDialog({ user, editable, stale, busy, owner, message, onClose, onReload, onSave }: {
  user: Account | null; editable: boolean; stale: boolean; busy: boolean; owner: boolean; message: string; onClose: () => void; onReload?: () => void
  onSave: (data: { name: string; email: string; title: string; role: 'user' | 'admin'; permissions: Permission[] }) => void
}) {
  const formId = useId()
  const [permissions, setPermissions] = useState<Permission[]>(user?.permissions ?? [...ACCESS_PROFILES.reader.permissions])
  const [role, setRole] = useState<'user' | 'admin'>(user?.role === 'admin' ? 'admin' : 'user')
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [title, setTitle] = useState(user?.title ?? '')
  const fullAccess = user?.role === 'owner' || role === 'admin'
  return <AccessDialog title={user ? `${editable ? 'Настройка прав' : 'Права доступа'}: ${user.name}` : 'Пригласить пользователя'} description={user ? user.email : 'Пользователь получит письмо и самостоятельно задаст пароль.'} wide busy={busy} onClose={onClose}
    footer={<><span className="mr-auto text-xs text-slate-500">{fullAccess ? 'Все рабочие разрешения' : `Выбрано разрешений: ${permissions.length}`}</span><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{editable ? 'Отмена' : 'Закрыть'}</Button>{editable ? <Button type="submit" form={formId} disabled={busy || stale}>{busy ? 'Сохраняем…' : user ? 'Сохранить права' : 'Создать и отправить приглашение'}</Button> : null}</>}>
    <form id={formId} className="space-y-5" onSubmit={event => { event.preventDefault(); if (editable && !stale && !busy) onSave({ name, email, title, role, permissions }) }}>
      {message ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{message}</p> : null}
      {stale ? <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Учётная запись изменилась. Загрузите актуальные права перед сохранением.{onReload ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onReload}>Загрузить актуальные права</Button> : null}</div> : null}
      {!user ? <fieldset disabled={busy} className="grid gap-4 md:grid-cols-3"><label className="grid gap-2 text-sm text-slate-700">ФИО<Input value={name} onChange={event => setName(event.target.value)} maxLength={200} required /></label><label className="grid gap-2 text-sm text-slate-700">Почта<Input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></label><label className="grid gap-2 text-sm text-slate-700">Должность<Input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} placeholder="Не определяет права" /></label></fieldset> : null}
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
