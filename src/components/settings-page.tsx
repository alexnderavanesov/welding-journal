import { type ChangeEvent, type ReactNode, useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  Database,
  Download,
  ExternalLink,
  FileText,
  Hash,
  Inbox,
  LockKeyhole,
  Pencil,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  deleteDocumentTemplate,
  DEFAULT_WELDING_JOURNAL_TEMPLATE_OPTIONS,
  DOCUMENT_TEMPLATE_TYPES,
  formatFileSize,
  isKnownTemplateMarkerField,
  loadDocumentTemplates,
  parseDocumentTemplateFile,
  saveDocumentTemplate,
  updateDocumentTemplateOptions,
  type DocumentTemplateId,
  type StoredDocumentTemplate,
  type TemplateUploadInfo,
  type WeldingJournalTemplateOptions,
} from '@/lib/document-template-storage'
import {
  REQUEST_CONCLUSION_DEFAULT_SETTINGS,
  saveRequestConclusionSettings,
  useRequestConclusionSettings,
  type RequestConclusionNamingKind,
  type RequestConclusionSettings,
} from '@/lib/request-conclusion-settings'
import type { RequestNamingState } from '@/lib/request-naming-state'
import {
  DEFAULT_DISPATCHER_SETTINGS,
  DISPATCHER_SETTING_HELP,
  DISPATCHER_SETTING_GROUPS,
  saveDispatcherSettings,
  useDispatcherSettings,
  type DispatcherSettingGroup,
  type DispatcherSettingId,
  type DispatcherSettings,
} from '@/lib/dispatcher-settings'
import {
  DEFAULT_SYSTEM_INDEX_SETTINGS,
  getSystemIndexValidationError,
  normalizeSystemIndexLetter,
  saveSystemIndexSettings,
  useSystemIndexSettings,
  type SystemIndexKey,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'
import { saveOtherSettings, useOtherSettings, type WdiCalculationMode, type WdiTableSettings } from '@/lib/other-settings'
import { buildWdiTableXlsxBytes, getWdiTableMatrix, parseWdiTableFile } from '@/lib/wdi-table-import'
import {
  DEFAULT_DATA_LIST_SETTINGS,
  normalizeDataListOption,
  saveDataListSettings,
  useDataListSettings,
} from '@/lib/data-list-settings'
import {
  clearSecuritySettings,
  saveSecuritySettings,
  useSecuritySettings,
  type SecurityScope,
  type SecuritySettings,
} from '@/lib/security-settings'
import { useSecurityGuard } from '@/lib/security-context'
import type { WeldRow } from '@/lib/dispatcher-types'

const SETTINGS_TABS = [
  { id: 'templates', label: 'Шаблоны документов', icon: FileText },
  { id: 'data', label: 'Данные', icon: Database },
  { id: 'requests', label: 'Заявки и заключения', icon: Inbox },
  { id: 'indexes', label: 'Системные индексы', icon: Hash },
  { id: 'dispatcher', label: 'Диспетчер задач и напоминаний', icon: Bell },
  { id: 'other', label: 'Прочее', icon: SlidersHorizontal },
  { id: 'security', label: 'Блокировка', icon: LockKeyhole },
] as const

type SettingsTabId = (typeof SETTINGS_TABS)[number]['id']
type ProtectedSettingsChange = (action: () => void | Promise<void>) => Promise<boolean>

export function SettingsPage({ rows = [], rowsCount = rows.length }: { rows?: WeldRow[]; rowsCount?: number }) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('templates')
  const { requireSettingsChangePassword } = useSecurityGuard()
  const runProtectedSettingsChange = useCallback<ProtectedSettingsChange>(
    async (action) => {
      if (!(await requireSettingsChangePassword())) return false
      await action()
      return true
    },
    [requireSettingsChangePassword],
  )

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
        <div className="bg-white px-5 py-4">
          <div className="flex flex-wrap gap-2">
            {SETTINGS_TABS.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="border-t border-slate-200 bg-slate-50 p-5">
          {activeTab === 'templates' ? (
            <DocumentTemplatesSettings runProtectedSettingsChange={runProtectedSettingsChange} />
          ) : activeTab === 'data' ? (
            <DataSettingsPanel rows={rows} runProtectedSettingsChange={runProtectedSettingsChange} />
          ) : activeTab === 'requests' ? (
            <RequestConclusionSettingsPanel runProtectedSettingsChange={runProtectedSettingsChange} />
          ) : activeTab === 'indexes' ? (
            <SystemIndexesSettingsPanel rowsCount={rowsCount} runProtectedSettingsChange={runProtectedSettingsChange} />
          ) : activeTab === 'dispatcher' ? (
            <DispatcherSettingsPanel runProtectedSettingsChange={runProtectedSettingsChange} />
          ) : activeTab === 'other' ? (
            <OtherSettingsPanel runProtectedSettingsChange={runProtectedSettingsChange} />
          ) : (
            <SecuritySettingsPanel runProtectedSettingsChange={runProtectedSettingsChange} />
          )}
        </div>
      </section>
    </div>
  )
}

const SECURITY_PASSWORD_KEYS = {
  entry: 'entryPassword',
  settings: 'settingsPassword',
  edit: 'editPassword',
  importReplace: 'importReplacePassword',
  delete: 'deletePassword',
} as const satisfies Record<SecurityScope, keyof SecuritySettings>

const SECURITY_FLAG_KEYS = {
  entry: 'requirePasswordOnEntry',
  settings: 'protectSettings',
  edit: 'protectEdit',
  importReplace: 'protectImportReplace',
  delete: 'protectDelete',
} as const satisfies Record<SecurityScope, keyof SecuritySettings>

const SECURITY_RULE_CARDS: Array<{
  scope: SecurityScope
  title: string
  passwordTitle: string
  description: string
  example: string
}> = [
  {
    scope: 'entry',
    title: 'Вход на сайт',
    passwordTitle: 'Пароль на вход',
    description: 'Сайт откроется только после ввода пароля для входа.',
    example: 'Пользователь открыл сайт, ввел пароль входа и попал в систему.',
  },
  {
    scope: 'settings',
    title: 'Изменение настроек',
    passwordTitle: 'Пароль на настройки',
    description: 'Раздел “Настройки” можно открыть и читать, но сохранение изменений попросит пароль.',
    example: 'Пользователь поменял правило или галочку, нажал сохранить и ввел пароль настроек.',
  },
  {
    scope: 'edit',
    title: 'Редактирование',
    passwordTitle: 'Пароль на редактирование',
    description: 'Перед изменением, переименованием, очисткой или сохранением данных будет запрошен пароль.',
    example: 'Пользователь нажал редактировать стык или сохранить результат, ввел пароль редактирования.',
  },
  {
    scope: 'importReplace',
    title: 'Изменение данных импортом',
    passwordTitle: 'Пароль на замену данных импортом',
    description: 'Перед сохранением вкладки “Замена данных” в импорте будет запрошен отдельный пароль.',
    example: 'Пользователь загрузил шаблон замены данных, проверил предпросмотр, нажал заменить и ввел пароль импорта.',
  },
  {
    scope: 'delete',
    title: 'Удаление',
    passwordTitle: 'Пароль на удаление',
    description: 'Перед удалением записей будет запрошен отдельный пароль удаления.',
    example: 'Пользователь нажал удалить стык, ввел пароль удаления, затем подтвердил удаление.',
  },
]

function SecuritySettingsPanel({ runProtectedSettingsChange }: { runProtectedSettingsChange: ProtectedSettingsChange }) {
  const settings = useSecuritySettings()
  const [passwordDrafts, setPasswordDrafts] = useState<Record<SecurityScope, string>>({
    entry: '',
    settings: '',
    edit: '',
    importReplace: '',
    delete: '',
  })
  const [repeatDrafts, setRepeatDrafts] = useState<Record<SecurityScope, string>>({
    entry: '',
    settings: '',
    edit: '',
    importReplace: '',
    delete: '',
  })
  const [editingPasswordScopes, setEditingPasswordScopes] = useState<Set<SecurityScope>>(() => new Set())
  const [message, setMessage] = useState<string | null>(null)
  const enabledRulesCount = SECURITY_RULE_CARDS.filter((card) =>
    Boolean(settings[SECURITY_PASSWORD_KEYS[card.scope]]) && settings[SECURITY_FLAG_KEYS[card.scope]] === true,
  ).length
  const configuredPasswordsCount = SECURITY_RULE_CARDS.filter((card) => Boolean(settings[SECURITY_PASSWORD_KEYS[card.scope]])).length

  const updatePasswordDraft = (scope: SecurityScope, value: string) => {
    setPasswordDrafts((current) => ({ ...current, [scope]: value }))
    setMessage(null)
  }

  const updateRepeatDraft = (scope: SecurityScope, value: string) => {
    setRepeatDrafts((current) => ({ ...current, [scope]: value }))
    setMessage(null)
  }

  const setPasswordEditorOpen = (scope: SecurityScope, open: boolean) => {
    setEditingPasswordScopes((current) => {
      const next = new Set(current)
      if (open) next.add(scope)
      else next.delete(scope)
      return next
    })
  }

  async function savePassword(scope: SecurityScope, enableAfterSave = false) {
    const nextPassword = passwordDrafts[scope].trim()
    if (nextPassword.length < 1) {
      setMessage('Введите пароль')
      return
    }
    if (nextPassword !== repeatDrafts[scope].trim()) {
      setMessage('Пароли не совпадают')
      return
    }
    await runProtectedSettingsChange(() => {
      saveSecuritySettings({
        ...settings,
        [SECURITY_PASSWORD_KEYS[scope]]: nextPassword,
        ...(enableAfterSave ? { [SECURITY_FLAG_KEYS[scope]]: true } : {}),
      })
    })
    setPasswordDrafts((current) => ({ ...current, [scope]: '' }))
    setRepeatDrafts((current) => ({ ...current, [scope]: '' }))
    setPasswordEditorOpen(scope, false)
    setMessage(enableAfterSave ? 'Пароль сохранен, защита включена.' : 'Пароль сохранен.')
  }

  async function updateSecurityFlag(scope: SecurityScope, value: boolean) {
    if (!settings[SECURITY_PASSWORD_KEYS[scope]]) {
      setMessage('Сначала задайте пароль для этой защиты')
      return
    }
    await runProtectedSettingsChange(() => {
      saveSecuritySettings({ ...settings, [SECURITY_FLAG_KEYS[scope]]: value })
    })
    setMessage(value ? 'Защита включена. Теперь в этом месте будет запрашиваться свой пароль.' : 'Защита выключена для этого действия.')
  }

  async function resetSecurityScope(scope: SecurityScope) {
    await runProtectedSettingsChange(() => {
      saveSecuritySettings({
        ...settings,
        [SECURITY_PASSWORD_KEYS[scope]]: '',
        [SECURITY_FLAG_KEYS[scope]]: false,
      })
    })
    setPasswordDrafts((current) => ({ ...current, [scope]: '' }))
    setRepeatDrafts((current) => ({ ...current, [scope]: '' }))
    setPasswordEditorOpen(scope, false)
    setMessage('Пароль и защита для выбранного действия сброшены')
  }

  async function resetSecurity() {
    await runProtectedSettingsChange(() => {
      clearSecuritySettings()
    })
    setPasswordDrafts({ entry: '', settings: '', edit: '', importReplace: '', delete: '' })
    setRepeatDrafts({ entry: '', settings: '', edit: '', importReplace: '', delete: '' })
    setEditingPasswordScopes(new Set())
    setMessage('Все пароли и блокировки отключены')
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-slate-300 bg-white p-4 shadow-sm shadow-slate-200/60">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <LockKeyhole className="h-5 w-5 text-slate-500" />
              <h3 className="text-base font-semibold text-slate-900">Блокировка</h3>
            </div>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              Для каждой защиты можно задать свой пароль. Настройки открываются свободно, но если включена защита настроек, изменения и сохранения
              потребуют пароль настроек.
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {configuredPasswordsCount > 0
              ? `Паролей задано: ${configuredPasswordsCount} · защит включено: ${enabledRulesCount}`
              : 'Пароли не заданы · защиты недоступны'}
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="font-semibold text-slate-900">1. Задайте пароли</div>
            <div className="mt-1 leading-5 text-slate-500">Можно один и тот же, а можно разные: например, вход 1111, удаление 9999.</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="font-semibold text-slate-900">2. Включите защиты</div>
            <div className="mt-1 leading-5 text-slate-500">Отдельно включаются вход, настройки, редактирование, замена импортом и удаление.</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="font-semibold text-slate-900">3. Пользователь вводит пароль</div>
            <div className="mt-1 leading-5 text-slate-500">Система спросит пароль только в том месте, где включена защита.</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {SECURITY_RULE_CARDS.map((card) => {
          const hasPassword = Boolean(settings[SECURITY_PASSWORD_KEYS[card.scope]])
          const checked = settings[SECURITY_FLAG_KEYS[card.scope]] === true
          const isEditingPassword = !hasPassword || editingPasswordScopes.has(card.scope)
          return (
            <div
              key={card.scope}
              className={`overflow-hidden rounded-md border bg-white transition-colors ${
                checked ? 'border-sky-200 shadow-md shadow-sky-100/80' : 'border-slate-300 shadow-sm shadow-slate-200/60'
              }`}
            >
              <SecurityToggle
                title={card.title}
                description={card.description}
                example={card.example}
                checked={checked}
                onChange={(isChecked) => updateSecurityFlag(card.scope, isChecked)}
              />

              <div className="border-t border-slate-100 bg-slate-50/80 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-slate-500" />
                    <h4 className="text-sm font-semibold text-slate-900">{card.passwordTitle}</h4>
                  </div>
                  <span
                    className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                      hasPassword ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                    }`}
                  >
                    {hasPassword ? 'пароль задан' : 'пароль не задан'}
                  </span>
                </div>

                {isEditingPassword ? (
                  <>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      <label className="grid gap-1 text-sm font-medium text-slate-700">
                        {hasPassword ? 'Новый пароль' : 'Задайте пароль'}
                        <input
                          type="password"
                          value={passwordDrafts[card.scope]}
                          onChange={(event) => updatePasswordDraft(card.scope, event.target.value)}
                          className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                          placeholder={hasPassword ? 'Введите новый пароль' : 'От 1 символа'}
                        />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-700">
                        Повторите пароль
                        <input
                          type="password"
                          value={repeatDrafts[card.scope]}
                          onChange={(event) => updateRepeatDraft(card.scope, event.target.value)}
                          className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                          placeholder="Еще раз"
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                        onClick={() => savePassword(card.scope, !hasPassword)}
                      >
                        {hasPassword ? 'Сохранить пароль' : 'Сохранить и включить'}
                      </button>
                      {hasPassword ? (
                        <button
                          type="button"
                          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                          onClick={() => {
                            setPasswordDrafts((current) => ({ ...current, [card.scope]: '' }))
                            setRepeatDrafts((current) => ({ ...current, [card.scope]: '' }))
                            setPasswordEditorOpen(card.scope, false)
                          }}
                        >
                          Отмена
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                    <span className="text-sm text-slate-500">Пароль скрыт. Используется только для этой защиты.</span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                        onClick={() => setPasswordEditorOpen(card.scope, true)}
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-red-100 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                        onClick={() => resetSecurityScope(card.scope)}
                      >
                        Сбросить
                      </button>
                    </div>
                  </div>
                )}
                {isEditingPassword && hasPassword ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-xs font-semibold text-red-600 hover:text-red-700"
                      onClick={() => resetSecurityScope(card.scope)}
                    >
                      Сбросить эту защиту
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-300 bg-slate-100/80 p-4 shadow-sm shadow-slate-200/60">
        <button
          type="button"
          className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          onClick={resetSecurity}
        >
          Сбросить все пароли и защиты
        </button>
        {message ? <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{message}</div> : null}
      </div>
    </div>
  )
}

function SecurityToggle({
  title,
  description,
  example,
  checked,
  disabled,
  onChange,
}: {
  title: string
  description: string
  example: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      className={`block p-4 transition-colors ${
        disabled
          ? 'cursor-not-allowed bg-slate-50 opacity-70'
          : checked
            ? 'cursor-pointer bg-sky-50/60 hover:bg-sky-50'
            : 'cursor-pointer bg-white hover:bg-slate-50'
      }`}
    >
      <span className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-500"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">{title}</span>
            <span
              className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${
                checked ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'
              }`}
            >
              {checked ? 'включено' : 'выключено'}
            </span>
          </span>
          <span className="mt-1 block text-sm leading-5 text-slate-500">{description}</span>
          <span className="mt-2 block rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-xs leading-5 text-slate-500">
            {example}
          </span>
        </span>
      </span>
    </label>
  )
}

function OtherSettingsPanel({ runProtectedSettingsChange }: { runProtectedSettingsChange: ProtectedSettingsChange }) {
  const settings = useOtherSettings()
  const [wdiMessage, setWdiMessage] = useState<string | null>(null)

  function updateArchivedWelderStampsSetting(checked: boolean) {
    void runProtectedSettingsChange(() => {
      saveOtherSettings({
        ...settings,
        includeArchivedWelderStampsInForm: checked,
      })
    })
  }

  function updateWdiCalculationMode(mode: WdiCalculationMode) {
    setWdiMessage(null)
    void runProtectedSettingsChange(() => {
      saveOtherSettings({
        ...settings,
        wdiCalculationMode: mode,
      })
    })
  }

  async function handleWdiTableUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    setWdiMessage(null)
    try {
      await runProtectedSettingsChange(async () => {
        const table = await parseWdiTableFile(file)
        saveOtherSettings({
          ...settings,
          wdiCalculationMode: 'table',
          wdiTable: table,
        })
        setWdiMessage(`Таблица загружена: ${table.diameters.length} диаметров × ${table.thicknesses.length} толщин.`)
      })
    } catch (error) {
      setWdiMessage((error as Error).message)
    }
  }

  function openWdiTablePreview() {
    if (!settings.wdiTable) {
      setWdiMessage('Сначала загрузите таблицу дюйм-диаметров.')
      return
    }

    const html = buildWdiTablePreviewHtml(settings.wdiTable)
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener,noreferrer')
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  async function downloadWdiTable() {
    if (!settings.wdiTable) {
      setWdiMessage('Сначала загрузите таблицу дюйм-диаметров.')
      return
    }

    setWdiMessage(null)
    try {
      const bytes = await buildWdiTableXlsxBytes(settings.wdiTable)
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = getWdiTableDownloadName(settings.wdiTable.fileName)
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setWdiMessage((error as Error).message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-slate-300 bg-slate-100/80 p-4 shadow-sm shadow-slate-200/60">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-slate-500" />
          <h3 className="text-base font-semibold text-slate-900">Прочее</h3>
        </div>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
          Дополнительные параметры, которые меняют поведение рабочих форм без изменения данных журнала.
        </p>
      </div>

      <label
        className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 shadow-sm transition-colors ${
          settings.includeArchivedWelderStampsInForm
            ? 'border-sky-200 bg-sky-50 shadow-sky-100/60 hover:bg-sky-50'
            : 'border-slate-300 bg-white shadow-slate-200/60 hover:bg-slate-50'
        }`}
      >
        <input
          type="checkbox"
          checked={settings.includeArchivedWelderStampsInForm}
          onChange={(event) => updateArchivedWelderStampsSetting(event.currentTarget.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-500"
        />
        <span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">Учитывать архив клейм в форме стыка</span>
            <span
              className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${
                settings.includeArchivedWelderStampsInForm
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
            >
              {settings.includeArchivedWelderStampsInForm ? 'включено' : 'выключено'}
            </span>
          </span>
          <span className="mt-1 block text-sm leading-5 text-slate-500">
            Архивные клейма будут доступны в выпадающих списках при создании и редактировании стыков.
          </span>
        </span>
      </label>

      <section className="rounded-md border border-slate-300 bg-white p-4 shadow-sm shadow-slate-200/60">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Расчет WDI</h4>
            <p className="mt-1 text-sm leading-5 text-slate-500">
              Режим влияет на новые сохранения и импорт. Уже сохраненные значения WDI при смене режима не пересчитываются.
            </p>
          </div>
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-500">
            {getWdiModeLabel(settings.wdiCalculationMode)}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <WdiModeCard
            title="Пользовательский"
            description="WDI вводится вручную в форме и в импорте."
            active={settings.wdiCalculationMode === 'manual'}
            onClick={() => updateWdiCalculationMode('manual')}
          />
          <WdiModeCard
            title="Системный: D / 25,4"
            description="Берется меньший D1/D2 и делится на 25,4. Результат округляется до 2 знаков."
            active={settings.wdiCalculationMode === 'formula'}
            onClick={() => updateWdiCalculationMode('formula')}
          />
          <WdiModeCard
            title="Системный: таблица D/T"
            description="Берется меньший D1/D2 и меньший T1/T2, затем значение ищется в загруженной таблице."
            active={settings.wdiCalculationMode === 'table'}
            onClick={() => {
              if (!settings.wdiTable) {
                setWdiMessage('Сначала загрузите таблицу дюйм-диаметров.')
                return
              }
              updateWdiCalculationMode('table')
            }}
          />
        </div>

        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 text-sm text-slate-600">
              <div className="font-semibold text-slate-800">Таблица дюйм-диаметров</div>
              <div className="mt-1">
                {settings.wdiTable
                  ? `${settings.wdiTable.fileName}: ${settings.wdiTable.diameters.length} диаметров × ${settings.wdiTable.thicknesses.length} толщин`
                  : 'Таблица пока не загружена.'}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openWdiTablePreview}
                disabled={!settings.wdiTable}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm shadow-slate-200/40 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ExternalLink className="h-4 w-4" />
                Открыть
              </button>
              <button
                type="button"
                onClick={() => void downloadWdiTable()}
                disabled={!settings.wdiTable}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm shadow-slate-200/40 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                Скачать
              </button>
              <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm shadow-slate-200/40 hover:bg-slate-50">
                <Upload className="h-4 w-4" />
                Загрузить
                <input type="file" accept=".xlsx,.xls" onChange={handleWdiTableUpload} className="hidden" />
              </label>
            </div>
          </div>
          {wdiMessage ? <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{wdiMessage}</div> : null}
        </div>
      </section>
    </div>
  )
}

function WdiModeCard({
  title,
  description,
  active,
  onClick,
}: {
  title: string
  description: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border p-3 text-left transition-colors ${
        active ? 'border-sky-200 bg-sky-50 text-slate-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      <span className="flex items-center gap-2">
        <span className={`h-3 w-3 rounded-full border ${active ? 'border-sky-700 bg-sky-700' : 'border-slate-300 bg-white'}`} />
        <span className="text-sm font-semibold">{title}</span>
      </span>
      <span className="mt-2 block text-sm leading-5 text-slate-500">{description}</span>
    </button>
  )
}

function buildWdiTablePreviewHtml(table: WdiTableSettings) {
  const matrix = getWdiTableMatrix(table)
  const [headerRow = [], ...dataRows] = matrix
  const headerCells = headerRow
    .map((cell) => `<th>${escapeHtml(formatWdiTableCell(cell))}</th>`)
    .join('')
  const rows = dataRows
    .map((row) => `<tr>${row.map((cell, index) => `${index === 0 ? '<th>' : '<td>'}${escapeHtml(formatWdiTableCell(cell))}${index === 0 ? '</th>' : '</td>'}`).join('')}</tr>`)
    .join('')
  const uploadedAt = table.uploadedAt ? new Date(table.uploadedAt).toLocaleString('ru-RU') : 'не указано'

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(table.fileName)} · WDI</title>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f8fafc; color: #0f172a; }
    main { padding: 28px; }
    .header { margin-bottom: 18px; }
    h1 { margin: 0; font-size: 22px; line-height: 1.25; }
    .meta { margin-top: 8px; color: #64748b; font-size: 14px; }
    .table-wrap { max-height: calc(100vh - 132px); overflow: auto; border: 1px solid #dbe3ef; border-radius: 10px; background: white; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }
    table { border-collapse: separate; border-spacing: 0; min-width: 100%; }
    th, td { border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 9px 12px; text-align: center; white-space: nowrap; font-size: 14px; }
    thead th { position: sticky; top: 0; z-index: 2; background: #e8eef6; font-weight: 700; }
    tbody th { position: sticky; left: 0; z-index: 1; background: #eaf6ff; font-weight: 700; color: #0f466b; }
    thead th:first-child { left: 0; z-index: 3; background: linear-gradient(135deg, #d7e1ef 0%, #eef4fb 100%); }
    tbody tr:nth-child(even) td { background: #fbfdff; }
    td:empty::after { content: "—"; color: #cbd5e1; }
  </style>
</head>
<body>
  <main>
    <div class="header">
      <h1>Таблица дюйм-диаметров WDI</h1>
      <div class="meta">${escapeHtml(table.fileName)} · ${table.diameters.length} диаметров × ${table.thicknesses.length} толщин · загружено: ${escapeHtml(uploadedAt)}</div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </main>
</body>
</html>`
}

function getWdiTableDownloadName(fileName: string) {
  const baseName = fileName.trim().replace(/\.(xlsx|xls)$/i, '') || 'Таблица WDI'
  return `${baseName}.xlsx`
}

function formatWdiTableCell(value: number | string) {
  return typeof value === 'number' ? String(value).replace('.', ',') : value
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getWdiModeLabel(mode: WdiCalculationMode) {
  if (mode === 'formula') return 'системный: D / 25,4'
  if (mode === 'table') return 'системный: таблица D/T'
  return 'пользовательский'
}

function DataSettingsPanel({
  rows,
  runProtectedSettingsChange,
}: {
  rows: WeldRow[]
  runProtectedSettingsChange: ProtectedSettingsChange
}) {
  const settings = useDataListSettings()
  const [drafts, setDrafts] = useState<Record<DataListSettingsKey, string>>({
    weldingTypes: '',
    connectionTypes: '',
  })
  const [message, setMessage] = useState<string | null>(null)
  const usageCountsByKey: Record<DataListSettingsKey, Map<string, number>> = {
    weldingTypes: getWeldingTypeUsageCounts(rows),
    connectionTypes: getConnectionTypeUsageCounts(rows),
  }

  async function addListValue(config: DataListConfig) {
    const nextValue = normalizeDataListOption(drafts[config.key])
    const values = settings[config.key]
    if (!nextValue) {
      setMessage(`Введите значение для списка “${config.title}”.`)
      return
    }
    if (values.includes(nextValue)) {
      setMessage(`Значение ${nextValue} уже есть в списке.`)
      return
    }

    const saved = await runProtectedSettingsChange(() => {
      saveDataListSettings({
        ...settings,
        [config.key]: [...values, nextValue],
      })
    })
    if (!saved) return
    setDrafts((current) => ({ ...current, [config.key]: '' }))
    setMessage(`Добавлено значение ${nextValue}.`)
  }

  async function removeListValue(config: DataListConfig, value: string) {
    const values = settings[config.key]
    if (config.minOptions && values.length <= config.minOptions) {
      setMessage(config.minOptionsMessage)
      return
    }
    const usageCount = usageCountsByKey[config.key].get(value) ?? 0
    if (usageCount > 0) {
      setMessage(`Нельзя удалить ${value}: ${config.usedValueText} используется в стыках (${usageCount}).`)
      return
    }

    const saved = await runProtectedSettingsChange(() => {
      saveDataListSettings({
        ...settings,
        [config.key]: values.filter((item) => item !== value),
      })
    })
    if (saved) setMessage(`Значение ${value} удалено из списка.`)
  }

  async function resetListValues(config: DataListConfig) {
    const defaultList = DEFAULT_DATA_LIST_SETTINGS[config.key]
    const defaultValues = new Set(defaultList)
    const values = settings[config.key]
    const usageCounts = usageCountsByKey[config.key]
    const blockedValues = values.filter((value) => !defaultValues.has(value) && (usageCounts.get(value) ?? 0) > 0)
    if (blockedValues.length > 0) {
      setMessage(
        `Нельзя ${config.resetBlockedAction}: в стыках используются значения ${blockedValues
          .map((value) => `${value} (${usageCounts.get(value)})`)
          .join(', ')}.`,
      )
      return
    }

    const saved = await runProtectedSettingsChange(() => {
      saveDataListSettings({
        ...settings,
        [config.key]: defaultList,
      })
    })
    if (saved) {
      setDrafts((current) => ({ ...current, [config.key]: '' }))
      setMessage(config.resetSuccessMessage)
    }
  }

  function renderListValue(config: DataListConfig, value: string) {
    const usageCount = usageCountsByKey[config.key].get(value) ?? 0
    return (
      <span
        key={value}
        className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
          usageCount > 0 ? 'border-sky-100 bg-sky-50 text-sky-900' : 'border-slate-200 bg-slate-50 text-slate-800'
        }`}
      >
        {value}
        {usageCount > 0 ? (
          <span className="rounded border border-sky-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
            стыков: {usageCount}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => removeListValue(config, value)}
          className={`rounded border bg-white px-1.5 py-0.5 text-xs font-semibold transition-colors ${
            usageCount > 0
              ? 'border-slate-200 text-slate-400 hover:bg-slate-50'
              : 'border-sky-200 text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700'
          }`}
          aria-label={`Удалить ${value}`}
          title={usageCount > 0 ? `Нельзя удалить: используется в стыках (${usageCount})` : `Удалить ${value}`}
        >
          ×
        </button>
      </span>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-slate-300 bg-slate-100/80 p-4 shadow-sm shadow-slate-200/60">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-slate-500" />
          <h3 className="text-base font-semibold text-slate-900">Данные</h3>
        </div>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
          Здесь настраиваются выпадающие списки, которые используются в рабочих формах и импорте. Значения нельзя удалить или убрать
          сбросом, если они уже используются хотя бы в одном стыке.
        </p>
      </div>

      {DATA_LIST_CONFIGS.map((config) => (
        <div key={config.key} className="rounded-md border border-slate-300 bg-white shadow-sm shadow-slate-200/60">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-base font-semibold text-slate-900">{config.title}</div>
              <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-500">{config.description}</p>
              <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-500">{config.protectionHint}</p>
            </div>
            <button
              type="button"
              onClick={() => resetListValues(config)}
              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {config.resetButtonLabel}
            </button>
          </div>

          <div className="space-y-4 p-4">
            {settings[config.key].length > 0 ? (
              <div className="flex flex-wrap gap-2">{settings[config.key].map((value) => renderListValue(config, value))}</div>
            ) : (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                {config.emptyListText}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-[minmax(220px,360px)_auto] md:items-end md:justify-start">
              <label className="space-y-1.5 text-sm font-semibold text-slate-700">
                <span>Новое значение</span>
                <input
                  type="text"
                  value={drafts[config.key]}
                  onChange={(event) => {
                    setDrafts((current) => ({ ...current, [config.key]: event.target.value }))
                    setMessage(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void addListValue(config)
                    }
                  }}
                  placeholder={config.placeholder}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm shadow-slate-200/50 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <button
                type="button"
                onClick={() => addListValue(config)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Plus className="h-4 w-4" />
                Добавить
              </button>
            </div>
          </div>
        </div>
      ))}

      {message ? <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">{message}</div> : null}
    </div>
  )
}

type DataListSettingsKey = 'weldingTypes' | 'connectionTypes'

type DataListConfig = {
  key: DataListSettingsKey
  title: string
  description: string
  protectionHint: string
  placeholder: string
  emptyListText: string
  resetButtonLabel: string
  resetBlockedAction: string
  resetSuccessMessage: string
  usedValueText: string
  minOptions?: number
  minOptionsMessage: string
}

const DATA_LIST_CONFIGS: DataListConfig[] = [
  {
    key: 'weldingTypes',
    title: 'Способ сварки',
    description:
      'Пользователь сможет выбрать только значения из этого списка. Список применяется в сварочном журнале, карточках клейм и проверке импорта.',
    protectionHint: 'Уже созданные записи не переименовываются автоматически, но при новом вводе будет применяться актуальный список.',
    placeholder: 'Например: РД',
    emptyListText: 'Список пуст. Добавьте хотя бы один способ сварки.',
    resetButtonLabel: 'Вернуть РД/РАД',
    resetBlockedAction: 'вернуть список к РД/РАД',
    resetSuccessMessage: 'Список “Способ сварки” возвращен к значениям по умолчанию.',
    usedValueText: 'этот способ сварки',
    minOptions: 1,
    minOptionsMessage: 'В списке “Способ сварки” должно остаться хотя бы одно значение.',
  },
  {
    key: 'connectionTypes',
    title: 'Тип соединения',
    description:
      'Пользователь выбирает одно значение из этого списка в меню создания и редактирования стыка. Это одиночный выбор, не набор галочек.',
    protectionHint: 'Если тип соединения уже используется в стыках, удалить его из настроек нельзя.',
    placeholder: 'Например: СТ',
    emptyListText: 'Список пока пуст. После добавления значений поле “Тип соединения” станет выпадающим списком в форме стыка.',
    resetButtonLabel: 'Очистить список',
    resetBlockedAction: 'очистить список “Тип соединения”',
    resetSuccessMessage: 'Список “Тип соединения” очищен.',
    usedValueText: 'этот тип соединения',
    minOptionsMessage: '',
  },
]

function getWeldingTypeUsageCounts(rows: WeldRow[]) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const values = new Set(splitWeldingMethodValues(row.weldingMethod))
    values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1))
  }
  return counts
}

function getConnectionTypeUsageCounts(rows: WeldRow[]) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const value = normalizeDataListOption(row.connectionType)
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

function splitWeldingMethodValues(value: unknown) {
  return String(value ?? '')
    .split(/[+,;]+/)
    .map((part) => normalizeDataListOption(part))
    .filter(Boolean)
}

const SYSTEM_INDEX_ROWS: Array<{
  id: SystemIndexKey
  title: string
  description: string
}> = [
  {
    id: 'shopJoint',
    title: 'Базовые стыки S',
    description: 'Первая буква для стыков этой группы при ручном вводе и импорте.',
  },
  {
    id: 'fieldJoint',
    title: 'Базовые стыки F',
    description: 'Первая буква для второй группы базовых стыков, статистики и фильтров.',
  },
  {
    id: 'repair',
    title: 'Ремонт',
    description: 'Индекс повторного стыка после результата «ремонт».',
  },
  {
    id: 'cutout',
    title: 'Вырез',
    description: 'Индекс повторного стыка после результата «вырез».',
  },
  {
    id: 'coil',
    title: 'Катушка',
    description: 'Индекс стыков катушки, которые диспетчер создает парой.',
  },
]

function SystemIndexesSettingsPanel({
  rowsCount,
  runProtectedSettingsChange,
}: {
  rowsCount: number
  runProtectedSettingsChange: ProtectedSettingsChange
}) {
  const settings = useSystemIndexSettings()
  const [draft, setDraft] = useState<SystemIndexSettings>(settings)
  const canEdit = rowsCount === 0
  const validationError = getSystemIndexValidationError(draft)
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(settings)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  const updateDraft = (id: SystemIndexKey, value: string) => {
    setDraft((current) => ({
      ...current,
      [id]: normalizeSystemIndexLetter(value),
    }))
  }

  const resetDraft = () => runProtectedSettingsChange(() => setDraft(DEFAULT_SYSTEM_INDEX_SETTINGS))

  const saveDraft = async () => {
    if (!canEdit || validationError) return
    await runProtectedSettingsChange(() => saveSystemIndexSettings(draft))
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-slate-300 bg-slate-100/80 p-4 shadow-sm shadow-slate-200/60">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Hash className="h-5 w-5 text-slate-500" />
              <h3 className="text-base font-semibold text-slate-900">Системные индексы</h3>
            </div>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              Индексы используются в именах стыков, задачах диспетчера, проверках цепочек, импорте и статистике. Менять их можно только до
              появления первого стыка в проекте.
            </p>
            <div className={`mt-3 inline-flex rounded-md border px-3 py-1.5 text-xs font-semibold ${canEdit ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              {canEdit ? 'Проект пустой: редактирование доступно' : `Редактирование закрыто: в проекте стыков ${rowsCount}`}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canEdit}
              onClick={resetDraft}
              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Вернуть S/F/R/W/Y
            </button>
            <button
              type="button"
              disabled={!canEdit || Boolean(validationError) || !hasChanges}
              onClick={saveDraft}
              className="inline-flex items-center justify-center rounded-md border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              Сохранить индексы
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-slate-300 bg-white shadow-sm shadow-slate-200/60">
        <div className="hidden grid-cols-[minmax(190px,1fr)_96px_minmax(260px,2fr)] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase text-slate-400 md:grid">
          <div>Индекс</div>
          <div>Буква</div>
          <div>Где применяется</div>
        </div>
        <div className="divide-y divide-slate-100">
          {SYSTEM_INDEX_ROWS.map((row) => (
            <div key={row.id} className="grid grid-cols-1 items-start gap-3 px-4 py-3 md:grid-cols-[minmax(190px,1fr)_96px_minmax(260px,2fr)] md:items-center">
              <div>
                <div className="text-sm font-semibold text-slate-900">{row.title}</div>
                <div className="mt-1 text-xs text-slate-500">По умолчанию: {DEFAULT_SYSTEM_INDEX_SETTINGS[row.id]}</div>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase text-slate-400 md:hidden">Буква</div>
                <input
                  type="text"
                  value={draft[row.id]}
                  disabled={!canEdit}
                  onChange={(event) => updateDraft(row.id, event.target.value)}
                  className="h-10 w-14 rounded-md border border-slate-300 bg-white text-center font-mono text-lg font-semibold text-slate-900 shadow-sm shadow-slate-200/50 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50 disabled:text-slate-400"
                  aria-label={row.title}
                  maxLength={1}
                  inputMode="text"
                />
              </div>
              <div className="text-sm leading-5 text-slate-600">{row.description}</div>
            </div>
          ))}
        </div>
      </div>

      {validationError ? (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {validationError}
        </div>
      ) : null}
    </div>
  )
}

function DocumentTemplatesSettings({ runProtectedSettingsChange }: { runProtectedSettingsChange: ProtectedSettingsChange }) {
  const [activeTemplateId, setActiveTemplateId] = useState<DocumentTemplateId>('weldingJournal')
  const [uploads, setUploads] = useState<Partial<Record<DocumentTemplateId, StoredDocumentTemplate>>>({})
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true)
  const activeTemplate = DOCUMENT_TEMPLATE_TYPES.find((template) => template.id === activeTemplateId) ?? DOCUMENT_TEMPLATE_TYPES[0]
  const activeUpload = uploads[activeTemplateId]
  const weldingJournalOptions = activeUpload?.options?.weldingJournal ?? DEFAULT_WELDING_JOURNAL_TEMPLATE_OPTIONS

  useEffect(() => {
    let isMounted = true
    loadDocumentTemplates()
      .then((storedTemplates) => {
        if (isMounted) setUploads(storedTemplates)
      })
      .catch((error) => {
        if (isMounted) setUploadError(error instanceof Error ? error.message : 'Не удалось загрузить сохраненные шаблоны.')
      })
      .finally(() => {
        if (isMounted) setIsLoadingTemplates(false)
      })
    return () => {
      isMounted = false
    }
  }, [])

  const handleTemplateUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploadError(null)
    await runProtectedSettingsChange(async () => {
      try {
        const parsedTemplate = await parseDocumentTemplateFile(file)
        const savedTemplate = await saveDocumentTemplate(activeTemplateId, parsedTemplate)
        setUploads((currentUploads) => ({
          ...currentUploads,
          [activeTemplateId]: savedTemplate,
        }))
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : 'Не удалось прочитать шаблон.')
      }
    })
  }

  const handleWeldingJournalOptionChange = async (optionKey: keyof WeldingJournalTemplateOptions, checked: boolean) => {
    if (!activeUpload || activeTemplateId !== 'weldingJournal') return

    const nextOptions = {
      ...weldingJournalOptions,
      [optionKey]: checked,
    }
    await runProtectedSettingsChange(async () => {
      const savedTemplate = await updateDocumentTemplateOptions('weldingJournal', { weldingJournal: nextOptions })
      if (!savedTemplate) return
      setUploads((currentUploads) => ({
        ...currentUploads,
        weldingJournal: savedTemplate,
      }))
    })
  }

  const handleTemplateDownload = () => {
    if (!activeUpload) return

    const blob = new Blob([activeUpload.fileData], { type: getTemplateMimeType(activeUpload.fileType) })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = activeUpload.fileName || `${activeTemplate.label}.${activeUpload.fileType || 'xlsx'}`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-slate-300 bg-slate-100/80 p-4 shadow-sm shadow-slate-200/60">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-slate-500" />
              <h3 className="text-base font-semibold text-slate-900">Шаблоны документов</h3>
            </div>
            <div className="mt-2 max-w-4xl space-y-1.5 text-sm leading-6 text-slate-600">
              <p>Загружайте Excel-шаблон под конкретный тип документа и ставьте маркеры в тех ячейках, куда нужно подставить данные.</p>
              <TemplateHintLine label="Основные маркеры">
                <TemplateToken>Линия</TemplateToken>
                <TemplateToken>Дата сварки</TemplateToken>
                <TemplateToken>№ п/п</TemplateToken>
              </TemplateHintLine>
              <p>В маркерах можно использовать название любого системного столбца из журнала.</p>
              <p>
                Если нужно вывести текст при пустом поле, добавьте его после слэша: <TemplateToken>Стык/"н/п"</TemplateToken> или{' '}
                <TemplateToken>Стык/«н/п»</TemplateToken>.
              </p>
              <TemplateHintLine label="ФИО по официальному клейму">
                <TemplateToken>Корень_1ФИО сварщика</TemplateToken>
                <TemplateToken>Заполнение_1ФИО сварщика</TemplateToken>
                <TemplateToken>Облицовка_1ФИО сварщика</TemplateToken>
              </TemplateHintLine>
              <p>
                В одной ячейке можно указать несколько маркеров, например <TemplateToken>Линия</TemplateToken> и{' '}
                <TemplateToken>Контроль швов, (%)</TemplateToken> на разных строках.
              </p>
            </div>
          </div>
          <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 transition-colors hover:border-sky-300 hover:bg-sky-100">
            <Upload className="h-4 w-4" />
            Загрузить шаблон
            <input type="file" accept=".xlsx,.xls,.docx" className="hidden" onChange={handleTemplateUpload} />
          </label>
        </div>

        {uploadError ? (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {uploadError}
          </div>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <div className="rounded-md border border-slate-300 bg-white p-2 shadow-sm shadow-slate-200/60">
          {DOCUMENT_TEMPLATE_TYPES.map((templateType) => {
            const isActive = activeTemplateId === templateType.id
            const hasUpload = Boolean(uploads[templateType.id])
            return (
              <button
                key={templateType.id}
                type="button"
                onClick={() => setActiveTemplateId(templateType.id)}
                className={`flex w-full items-start justify-between gap-3 rounded-md px-3 py-3 text-left transition-colors ${
                  isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span>
                  <span className="block text-sm font-semibold">{templateType.label}</span>
                  <span className={`mt-1 block text-xs ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>{templateType.description}</span>
                </span>
                {hasUpload ? (
                  <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${isActive ? 'text-emerald-300' : 'text-emerald-600'}`} />
                ) : null}
              </button>
            )
          })}
        </div>

        <div className="rounded-md border border-slate-300 bg-white shadow-sm shadow-slate-200/60">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-500" />
                <h4 className="text-base font-semibold text-slate-900">{activeTemplate.label}</h4>
              </div>
              <p className="mt-1 text-sm text-slate-500">{activeTemplate.description}</p>
            </div>
            {activeUpload ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleTemplateDownload}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-4 w-4" />
                  Скачать шаблон
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await runProtectedSettingsChange(async () => {
                      await deleteDocumentTemplate(activeTemplateId)
                      setUploads((currentUploads) => {
                        const nextUploads = { ...currentUploads }
                        delete nextUploads[activeTemplateId]
                        return nextUploads
                      })
                    })
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Удалить шаблон
                </button>
              </div>
            ) : null}
          </div>

          <div className="space-y-6">
            {activeTemplateId === 'weldingJournal' ? (
              <WeldingJournalTemplateOptionsPanel
                disabled={!activeUpload}
                options={weldingJournalOptions}
                onChange={handleWeldingJournalOptionChange}
              />
            ) : null}

            {isLoadingTemplates ? (
              <div className="p-4 text-sm text-slate-500">Загружаю сохраненные шаблоны...</div>
            ) : activeUpload ? (
              <TemplateUploadPreview upload={activeUpload} />
            ) : (
              <EmptyTemplateState />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function WeldingJournalTemplateOptionsPanel({
  disabled,
  options,
  onChange,
}: {
  disabled: boolean
  options: WeldingJournalTemplateOptions
  onChange: (optionKey: keyof WeldingJournalTemplateOptions, checked: boolean) => void
}) {
  return (
    <div className="border-b border-slate-100 px-4 py-4">
      <div className="text-sm font-semibold text-slate-900">Правила формирования сварочного журнала</div>
      <p className="mt-1 text-sm text-slate-500">
        Эти галочки применяются только к документу, который формируется по шаблону сварочного журнала.
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <TemplateOptionCheckbox
          checked={options.officialOnly}
          disabled={disabled}
          label="Учет официальных стыков"
          description="В документ попадут только стыки без статуса «неофициальный»."
          onChange={(checked) => onChange('officialOnly', checked)}
        />
        <TemplateOptionCheckbox
          checked={options.goodOnly}
          disabled={disabled}
          label="Учет только годных стыков"
          description="В документ попадут только стыки с итоговым статусом «годен»."
          onChange={(checked) => onChange('goodOnly', checked)}
        />
      </div>
      {disabled ? <div className="mt-2 text-xs text-slate-500">Загрузите шаблон, чтобы сохранить эти настройки.</div> : null}
    </div>
  )
}

function TemplateOptionCheckbox({
  checked,
  disabled,
  label,
  description,
  onChange,
}: {
  checked: boolean
  disabled: boolean
  label: string
  description: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-md border px-3 py-3 ${
        disabled ? 'border-slate-200 bg-slate-50 text-slate-400' : 'cursor-pointer border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-500"
      />
      <span>
        <span className="block text-sm font-semibold text-slate-900">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      </span>
    </label>
  )
}

function TemplateToken({ children }: { children: string }) {
  return <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs text-slate-800">{`{{${children}}}`}</span>
}

function TemplateHintLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p>
      <span className="font-medium text-slate-700">{label}:</span> <span className="inline-flex flex-wrap gap-1.5 align-middle">{children}</span>
    </p>
  )
}

function getTemplateMimeType(fileType: string) {
  if (fileType === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (fileType === 'xls') return 'application/vnd.ms-excel'
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

function EmptyTemplateState() {
  return (
    <div className="p-4">
      <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        Шаблон пока не загружен. Подготовьте Excel-файл с нужным оформлением и укажите в последней строке или в нужных ячейках маркеры
        подстановки. Система распознает несколько маркеров в одной ячейке, включая вариант с переносом строки.
      </div>
    </div>
  )
}

function TemplateUploadPreview({ upload }: { upload: TemplateUploadInfo }) {
  const knownFields = upload.fields.filter(isKnownTemplateMarkerField)
  const knownLocations = upload.locations
    .map((location) => ({
      ...location,
      fields: location.fields.filter(isKnownTemplateMarkerField),
    }))
    .filter((location) => location.fields.length > 0)

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <TemplateMetaCard label="Файл" value={upload.fileName} detail={`${upload.fileType.toUpperCase()} · ${formatFileSize(upload.fileSize)}`} />
        <TemplateMetaCard label="Найдено маркеров" value={String(knownLocations.reduce((count, location) => count + location.fields.length, 0))} detail={`уникальных полей: ${knownFields.length}`} />
        <TemplateMetaCard label="Загружен" value={upload.uploadedAt} detail="сохранен для формирования документов" />
      </div>

      {upload.warnings.length ? (
        <div className="space-y-2">
          {upload.warnings.map((warning) => (
            <div key={warning} className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <div className="text-sm font-semibold text-slate-900">Поля, найденные в шаблоне</div>
        {knownFields.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {knownFields.map((field) => (
              <span key={field} className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800">
                {field}
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-sm text-slate-500">Пока не найдено ни одного маркера вида {'{{Поле}}'}.</div>
        )}
      </div>

      {knownLocations.length ? (
        <div className="overflow-hidden rounded-md border border-slate-200">
          <div className="grid grid-cols-[130px_90px_1fr] bg-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <div>Лист</div>
            <div>Ячейка</div>
            <div>Маркеры</div>
          </div>
          <div className="max-h-72 overflow-auto">
            {knownLocations.map((location, index) => (
              <div
                key={`${location.sheet}-${location.cell}-${index}`}
                className="grid grid-cols-[130px_90px_1fr] gap-0 border-t border-slate-100 px-3 py-2 text-sm text-slate-700"
              >
                <div className="truncate pr-3 font-medium text-slate-900" title={location.sheet}>
                  {location.sheet}
                </div>
                <div className="font-mono text-xs text-slate-500">{location.cell}</div>
                <div className="flex flex-wrap gap-1.5">
                  {location.fields.map((field) => (
                    <span key={`${location.cell}-${field}`} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                      {field}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function TemplateMetaCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-900" title={value}>
        {value}
      </div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </div>
  )
}

const REQUEST_NAMING_CARDS: Array<{
  id: RequestConclusionNamingKind
  title: string
  description: string
  placeholder: string
}> = [
  {
    id: 'lnkRequest',
    title: 'Заявки ЛНК',
    description: 'Имя новой заявки ЛНК при создании из раздела ЛНК.',
    placeholder: REQUEST_CONCLUSION_DEFAULT_SETTINGS.lnkRequest.systemPattern,
  },
  {
    id: 'lnkConclusion',
    title: 'Заключения ЛНК',
    description: 'Имя заключения ЛНК при внесении результата контроля.',
    placeholder: REQUEST_CONCLUSION_DEFAULT_SETTINGS.lnkConclusion.systemPattern,
  },
  {
    id: 'pstoRequest',
    title: 'Заявки ПСТО',
    description: 'Имя новой заявки ПСТО при создании из раздела термообработки.',
    placeholder: REQUEST_CONCLUSION_DEFAULT_SETTINGS.pstoRequest.systemPattern,
  },
  {
    id: 'pstoConclusion',
    title: 'Заключения ПСТО',
    description: 'Имя диаграммы/заключения ПСТО при внесении результата.',
    placeholder: REQUEST_CONCLUSION_DEFAULT_SETTINGS.pstoConclusion.systemPattern,
  },
]

function RequestConclusionSettingsPanel({ runProtectedSettingsChange }: { runProtectedSettingsChange: ProtectedSettingsChange }) {
  const settings = useRequestConclusionSettings()

  const updateSettings = (
    kind: RequestConclusionNamingKind,
    patch: Partial<RequestConclusionSettings[RequestConclusionNamingKind]>,
  ) => {
    return runProtectedSettingsChange(() => saveRequestConclusionSettings({
      ...settings,
      [kind]: {
        ...settings[kind],
        ...patch,
      },
    }))
  }

  const resetSettings = () => runProtectedSettingsChange(() => saveRequestConclusionSettings(REQUEST_CONCLUSION_DEFAULT_SETTINGS))

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-slate-300 bg-slate-100/80 p-4 shadow-sm shadow-slate-200/60">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-slate-500" />
              <h3 className="text-base font-semibold text-slate-900">Заявки и заключения</h3>
            </div>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              Настройте стартовый режим имени и шаблон системного наименования. Уже созданные заявки и заключения не переименовываются:
              новое правило применяется только при создании следующих записей.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            onClick={resetSettings}
          >
            Вернуть стандартные правила
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
          <TemplateToken>Дата</TemplateToken>
          <TemplateToken>ДатаКороткая</TemplateToken>
          <TemplateToken>Метод</TemplateToken>
          <TemplateToken>№</TemplateToken>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {REQUEST_NAMING_CARDS.map((card) => (
          <RequestNamingSettingsCard
            key={card.id}
            title={card.title}
            description={card.description}
            placeholder={card.placeholder}
            settings={settings[card.id]}
            showMethodHint={card.id === 'lnkConclusion'}
            onModeChange={(defaultMode) => updateSettings(card.id, { defaultMode })}
            onPatternSave={(systemPattern) => updateSettings(card.id, { systemPattern })}
          />
        ))}
      </div>
    </div>
  )
}

function RequestNamingSettingsCard({
  title,
  description,
  placeholder,
  settings,
  showMethodHint,
  onModeChange,
  onPatternSave,
}: {
  title: string
  description: string
  placeholder: string
  settings: RequestConclusionSettings[RequestConclusionNamingKind]
  showMethodHint: boolean
  onModeChange: (mode: RequestNamingState['mode']) => void
  onPatternSave: (pattern: string) => Promise<boolean>
}) {
  const [isEditingPattern, setIsEditingPattern] = useState(false)
  const [patternDraft, setPatternDraft] = useState(settings.systemPattern)

  useEffect(() => {
    if (!isEditingPattern) setPatternDraft(settings.systemPattern)
  }, [isEditingPattern, settings.systemPattern])

  async function savePatternDraft() {
    const saved = await onPatternSave(patternDraft)
    if (saved) setIsEditingPattern(false)
  }

  return (
    <div className="rounded-md border border-slate-300 bg-white p-4 shadow-sm shadow-slate-200/60">
      <div>
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Выбранная вкладка при открытии</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <RequestNamingModeButton
            active={settings.defaultMode === 'system'}
            title="Системное"
            description="В модалке будет выбрано «Системное»."
            onClick={() => onModeChange('system')}
          />
          <RequestNamingModeButton
            active={settings.defaultMode === 'custom'}
            title="Пользовательское"
            description="В модалке будет выбрано «Пользовательское»."
            onClick={() => onModeChange('custom')}
          />
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Правило системного имени</span>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            onClick={() => {
              if (isEditingPattern) {
                void savePatternDraft()
                return
              }
              setPatternDraft(settings.systemPattern)
              setIsEditingPattern(true)
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            {isEditingPattern ? 'Сохранить' : 'Изменить'}
          </button>
        </div>
        {isEditingPattern ? (
          <input
            type="text"
            value={patternDraft}
            onChange={(event) => setPatternDraft(event.target.value)}
            placeholder={placeholder}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm shadow-slate-200/50 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
          />
        ) : (
          <div className="mt-1 min-h-9 truncate rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700" title={settings.systemPattern}>
            {settings.systemPattern || placeholder}
          </div>
        )}
      </div>
    </div>
  )
}

function RequestNamingModeButton({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border p-3 text-left transition-colors ${
        active ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold">
        <span className={`h-2.5 w-2.5 rounded-full ${active ? 'bg-sky-700' : 'bg-slate-300'}`} />
        {title}
      </span>
      <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
    </button>
  )
}

function DispatcherSettingsPanel({ runProtectedSettingsChange }: { runProtectedSettingsChange: ProtectedSettingsChange }) {
  const settings = useDispatcherSettings()
  const disabledCount = Object.values(settings).filter((enabled) => !enabled).length
  const totalCount = Object.values(settings).length

  const updateSetting = (id: DispatcherSettingId, enabled: boolean) => {
    runProtectedSettingsChange(() => saveDispatcherSettings({ ...settings, [id]: enabled }))
  }

  const updateGroup = (group: DispatcherSettingGroup, enabled: boolean) => {
    const nextSettings = { ...settings }
    group.items.forEach((item) => {
      nextSettings[item.id] = enabled
    })
    runProtectedSettingsChange(() => saveDispatcherSettings(nextSettings))
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-slate-300 bg-slate-100/80 p-4 shadow-sm shadow-slate-200/60">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-slate-500" />
              <h3 className="text-base font-semibold text-slate-900">Диспетчер задач и напоминаний</h3>
            </div>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              Отключение скрывает выбранный тип задач из диспетчера и панели напоминаний. Данные журнала, принятые предупреждения и правила
              расчета не изменяются.
            </p>
            <div className="mt-2 text-xs font-semibold text-slate-500">
              Активно: {totalCount - disabledCount} из {totalCount}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              onClick={() => runProtectedSettingsChange(() => saveDispatcherSettings(DEFAULT_DISPATCHER_SETTINGS))}
            >
              Включить все
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              onClick={() => {
                const nextSettings = Object.fromEntries(Object.keys(DEFAULT_DISPATCHER_SETTINGS).map((id) => [id, false])) as DispatcherSettings
                runProtectedSettingsChange(() => saveDispatcherSettings(nextSettings))
              }}
            >
              Отключить все
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {DISPATCHER_SETTING_GROUPS.map((group) => (
          <DispatcherSettingsGroupCard
            key={group.id}
            group={group}
            settings={settings}
            onItemChange={updateSetting}
            onGroupChange={(enabled) => updateGroup(group, enabled)}
          />
        ))}
      </div>
    </div>
  )
}

function DispatcherSettingsGroupCard({
  group,
  settings,
  onItemChange,
  onGroupChange,
}: {
  group: DispatcherSettingGroup
  settings: DispatcherSettings
  onItemChange: (id: DispatcherSettingId, enabled: boolean) => void
  onGroupChange: (enabled: boolean) => void
}) {
  const enabledCount = group.items.filter((item) => settings[item.id]).length
  const allEnabled = enabledCount === group.items.length
  const [expandedItemIds, setExpandedItemIds] = useState<Set<DispatcherSettingId>>(() => new Set())

  const toggleDetails = (id: DispatcherSettingId) => {
    setExpandedItemIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="rounded-md border border-slate-300 bg-white shadow-sm shadow-slate-200/60">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">{group.title}</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">{group.description}</p>
          <div className="mt-1 text-xs font-semibold text-slate-500">
            Включено: {enabledCount} из {group.items.length}
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          onClick={() => onGroupChange(!allEnabled)}
        >
          {allEnabled ? 'Отключить группу' : 'Включить группу'}
        </button>
      </div>
      <div className="divide-y divide-slate-100">
        {group.items.map((item) => {
          const enabled = settings[item.id]
          const expanded = expandedItemIds.has(item.id)
          const help = DISPATCHER_SETTING_HELP[item.id]
          return (
            <div key={item.id} className="px-4 py-3 hover:bg-slate-50">
              <div className="flex items-start gap-3">
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => onItemChange(item.id, event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-semibold ${enabled ? 'text-slate-900' : 'text-slate-400'}`}>{item.label}</span>
                    <span className={`mt-1 block text-xs leading-5 ${enabled ? 'text-slate-500' : 'text-slate-400'}`}>{item.description}</span>
                  </span>
                </label>
                <button
                  type="button"
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  onClick={() => toggleDetails(item.id)}
                  aria-expanded={expanded}
                >
                  Подробнее
                  <ChevronDown className={`h-3.5 w-3.5 transition ${expanded ? 'rotate-180' : ''}`} />
                </button>
              </div>
              {expanded ? (
                <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                  <div>
                    <span className="font-semibold text-slate-800">Смысл: </span>
                    {help.meaning}
                  </div>
                  <div className="mt-1">
                    <span className="font-semibold text-slate-800">Кейс: </span>
                    {help.example}
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
