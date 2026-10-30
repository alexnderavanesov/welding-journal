import { useEffect, useState, useRef } from 'react'
import { completeAccountLink } from '@/server/account-api'
import { Button } from './ui/button'
import { Input } from './ui/input'
export function AccountLinkPage() {
  const [token, setToken] = useState(''), [kind, setKind] = useState<'invite' | 'recovery'>('invite')
  const [password, setPassword] = useState(''), [repeat, setRepeat] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(false)
  const initialized = useRef(false)
  useEffect(() => { if (initialized.current) return; initialized.current = true; const parameters = new URLSearchParams(window.location.hash.slice(1)); setToken(parameters.get('token') ?? ''); setKind(parameters.get('kind') === 'recovery' ? 'recovery' : 'invite'); window.history.replaceState(null, '', window.location.pathname) }, [])
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><form className="w-full max-w-md space-y-5 rounded-xl border bg-white p-8" onSubmit={async event => {
    event.preventDefault(); if (password !== repeat) { setMessage('Пароли не совпадают.'); return }
    setBusy(true); setMessage(''); try { await completeAccountLink({ data: { token, kind, password } }); setToken(''); setPassword(''); setRepeat(''); setDone(true) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось сохранить пароль.') } finally { setBusy(false) }
  }}><h1 className="text-2xl font-semibold">{done ? 'Пароль сохранён' : kind === 'invite' ? 'Активация приглашения' : 'Восстановление доступа'}</h1>
    {done ? <><p>Теперь можно войти с вашей почтой и новым паролем.</p><a href="/account" className="text-sky-700 underline">Перейти ко входу</a></> : <>
      <p className="text-sm text-slate-600">{kind === 'invite' ? 'Задайте пароль для подтверждения почты и активации аккаунта.' : 'Задайте новый пароль. Прежние сеансы будут завершены.'}</p>
      {!token ? <p role="alert">Откройте действующую ссылку из письма. Новую ссылку выдаёт администратор.</p> : <><label className="grid gap-2 text-sm">Новый пароль<Input type="password" autoComplete="new-password" minLength={6} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} /></label><label className="grid gap-2 text-sm">Повторите пароль<Input type="password" autoComplete="new-password" required value={repeat} onChange={event => setRepeat(event.target.value)} /></label><p className="text-sm text-slate-500">Не менее 6 символов.</p><Button type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить пароль'}</Button></>}
      {message ? <p role="alert" className="text-sm text-red-700">{message}</p> : null}
    </>}
  </form></main>
}
