import type { FormEvent, ReactNode } from 'react'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { LockKeyhole, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import {
  isSecurityScopeEnabled,
  loadSecuritySettings,
  useSecuritySettings,
  verifySecurityPassword,
  type SecurityScope,
} from '@/lib/security-settings'

type SecurityPasswordOptions = {
  title: string
  description?: string
  scope: SecurityScope
}

type SecurityPasswordRequest = (options: SecurityPasswordOptions) => Promise<boolean>

type PendingSecurityPasswordRequest = SecurityPasswordOptions & {
  resolve: (confirmed: boolean) => void
}

const SecurityPasswordContext = createContext<SecurityPasswordRequest | null>(null)

export function SecurityProvider({ children }: { children: ReactNode }) {
  const [pendingRequest, setPendingRequest] = useState<PendingSecurityPasswordRequest | null>(null)

  const requestPassword = useCallback<SecurityPasswordRequest>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPendingRequest({ ...options, resolve })
      }),
    [],
  )

  const closePendingRequest = useCallback((confirmed: boolean) => {
    setPendingRequest((current) => {
      current?.resolve(confirmed)
      return null
    })
  }, [])

  const contextValue = useMemo(() => requestPassword, [requestPassword])

  return (
    <SecurityPasswordContext.Provider value={contextValue}>
      {children}
      {pendingRequest ? (
        <SecurityPasswordDialog
          scope={pendingRequest.scope}
          title={pendingRequest.title}
          description={pendingRequest.description}
          onCancel={() => closePendingRequest(false)}
          onSuccess={() => closePendingRequest(true)}
        />
      ) : null}
    </SecurityPasswordContext.Provider>
  )
}

export function useSecurityGuard() {
  const settings = useSecuritySettings()
  const requestPassword = useContext(SecurityPasswordContext)
  if (!requestPassword) {
    throw new Error('useSecurityGuard must be used inside SecurityProvider')
  }

  const requirePassword = useCallback(
    async (scope: SecurityScope, options: SecurityPasswordOptions) => {
      if (!isSecurityScopeEnabled(settings, scope)) return true
      return requestPassword(options)
    },
    [requestPassword, settings],
  )

  return {
    requireSettingsChangePassword: () =>
      requirePassword('settings', {
        scope: 'settings',
        title: 'Изменение настроек',
        description: 'Введите пароль, чтобы изменить или сохранить настройки.',
      }),
    requireEditPassword: (actionLabel = 'действие') =>
      requirePassword('edit', {
        scope: 'edit',
        title: 'Подтверждение доступа',
        description: `Введите пароль, чтобы выполнить ${actionLabel}.`,
      }),
    requireDeletePassword: (actionLabel = 'удаление') =>
      requirePassword('delete', {
        scope: 'delete',
        title: 'Подтверждение удаления',
        description: `Введите пароль, чтобы выполнить ${actionLabel}.`,
      }),
  }
}

export function SiteSecurityGate({ children }: { children: ReactNode }) {
  const settings = useSecuritySettings()
  const [unlocked, setUnlocked] = useState(() => !isSecurityScopeEnabled(loadSecuritySettings(), 'entry'))

  if (!isSecurityScopeEnabled(settings, 'entry') || unlocked) return <>{children}</>

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-950">Вход в систему</h1>
            <p className="mt-1 text-sm text-slate-500">Введите пароль для открытия сайта.</p>
          </div>
        </div>
        <PasswordForm scope="entry" submitLabel="Войти" onSuccess={() => setUnlocked(true)} />
      </div>
    </div>
  )
}

function SecurityPasswordDialog({
  scope,
  title,
  description,
  onCancel,
  onSuccess,
}: SecurityPasswordOptions & {
  onCancel: () => void
  onSuccess: () => void
}) {
  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[480px]"
      maxHeightClassName="max-h-[90vh]"
      overlayClassName="z-[170] bg-slate-950/35"
      panelRadiusClassName="rounded-lg"
      panelClassName="overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
        <div className="flex items-center gap-2">
          <LockKeyhole className="h-5 w-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        </div>
        <button
          type="button"
          className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950"
          onClick={onCancel}
          aria-label="Закрыть"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="px-6 py-6">
        {description ? <p className="mb-4 text-sm leading-6 text-slate-600">{description}</p> : null}
        <PasswordForm scope={scope} submitLabel="Продолжить" onSuccess={onSuccess} onCancel={onCancel} />
      </div>
    </LargeDialogShell>
  )
}

function PasswordForm({
  scope,
  submitLabel,
  onSuccess,
  onCancel,
}: {
  scope: SecurityScope
  submitLabel: string
  onSuccess: () => void
  onCancel?: () => void
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (verifySecurityPassword(loadSecuritySettings(), scope, password)) {
      setError(null)
      setPassword('')
      onSuccess()
      return
    }
    setError('Пароль не подходит')
  }

  return (
    <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        Пароль
        <Input
          autoFocus
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            setError(null)
          }}
          placeholder="Введите пароль"
        />
      </label>
      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Отмена
          </Button>
        ) : null}
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  )
}
