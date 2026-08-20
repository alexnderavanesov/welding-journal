import { type ChangeEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bell,
  CheckCircle2,
  ChevronDown,
  Database,
  Download,
  FileText,
  Hash,
  Inbox,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react'
import { DialogHeader } from '@/components/dialog-header'
import { DocumentTemplateLoadBoundary } from '@/components/document-template-load-boundary'
import { DocumentTemplateBuilder } from '@/components/document-template-builder'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import {
  RkExposureTableEditorDialog,
  WdiTableEditorDialog,
} from '@/components/settings-reference-table-dialogs'
import {
  analyzeDocumentTemplateReplacement,
  deleteDocumentTemplate,
  DOCUMENT_TEMPLATE_TYPES,
  formatFileSize,
  getWeldingJournalTemplateOptions,
  loadDocumentTemplates,
  parseDocumentTemplateFile,
  saveDocumentTemplate,
  updateDocumentTemplateConstructor,
  updateDocumentTemplateOptions,
  type DocumentTemplateConstructorConfig,
  type DocumentTemplateId,
  type DocumentTemplateReplacementAnalysis,
  type StoredDocumentTemplate,
  type TemplateUploadInfo,
  type WeldingJournalTemplateOptions,
} from '@/lib/document-template-storage'
import { WELDING_JOURNAL_DOCUMENT_SPLIT_MODES } from '@/lib/welding-journal-document-splitting'
import {
  loadGeneratedDocumentSequence,
  resetGeneratedDocumentSequence,
} from '@/lib/generated-document-storage'
import type { GeneratedDocumentType } from '@/server/generated-documents'
import { isGeneratedDocumentType } from '@/lib/generated-document-types'
import {
  loadSystemDocumentSequence,
  resetStoredSystemDocumentSequence,
} from '@/lib/system-document-sequence-storage'
import {
  LNK_CONCLUSION_TEMPLATE_PROFILES,
  isLnkConclusionTemplateId,
  isSystemDocumentTemplateId,
} from '@/lib/system-document-template-types'
import {
  REQUEST_NAMING_PATTERN_FIELDS,
  REQUEST_CONCLUSION_DEFAULT_SETTINGS,
  buildSystemNameFromPattern,
  parseRequestNamingPattern,
  saveRequestConclusionSettings,
  serializeRequestNamingPattern,
  useRequestConclusionSettings,
  type RequestConclusionNamingKind,
  type RequestNamingPatternField,
  type RequestNamingPatternPart,
  type RequestConclusionSettings,
} from '@/lib/request-conclusion-settings'
import type { RequestNamingState } from '@/lib/request-naming-state'
import {
  DEFAULT_DISPATCHER_SETTINGS,
  DISPATCHER_SETTING_ACTION_HELP,
  DISPATCHER_SETTING_HELP,
  DISPATCHER_SETTING_GROUPS,
  MIN_DISPATCHER_REMINDER_DAYS,
  getDispatcherSettingCode,
  getDispatcherSettingTaskTypeLabel,
  isDispatcherReminderSettingId,
  normalizeDispatcherReminderDays,
  saveDispatcherReminderSettings,
  saveDispatcherSettings,
  useDispatcherReminderSettings,
  useDispatcherSettings,
  type DispatcherReminderSettingId,
  type DispatcherReminderSettings,
  type DispatcherSettingGroup,
  type DispatcherSettingId,
  type DispatcherSettings,
} from '@/lib/dispatcher-settings'
import {
  DISPATCHER_BACKGROUND_REFRESH_ENABLED,
  saveDispatcherBackgroundSettings,
  useDispatcherBackgroundSettings,
} from '@/lib/dispatcher-background-settings'
import {
  DEFAULT_SYSTEM_INDEX_SETTINGS,
  getSystemIndexValidationError,
  normalizeSystemIndexLetter,
  saveSystemIndexSettings,
  useSystemIndexSettings,
  type SystemIndexKey,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'
import {
  saveOtherSettingsAndWait,
  useOtherSettings,
  WDI_CALCULATION_RULE_PRESETS,
  type WdiCalculationRules,
  type WdiCalculationMode,
  type WdiConnectionCalculationRule,
} from '@/lib/other-settings'
import {
  DEFAULT_DATA_LIST_SETTINGS,
  getDataListOptionInputError,
  normalizeDataListOption,
  saveDataListSettings,
  useDataListSettings,
} from '@/lib/data-list-settings'
import {
  SAVE_CHECK_SETTING_GROUPS,
  getSaveCheckSettingCode,
  saveSaveCheckSettings,
  useSaveCheckSettings,
  type SaveCheckSettingId,
  type SaveCheckSettings,
} from '@/lib/save-check-settings'
import { SAVE_CHECK_SETTING_HELP } from '@/lib/save-check-settings-help'
import {
  getDispatcherSettingIdsForSaveCheck,
  getSaveCheckSettingIdsForDispatcher,
} from '@/lib/save-check-dispatcher-links'
import {
  DEFAULT_SECURITY_SETTINGS,
  SERVER_SECURITY_PASSWORD_PLACEHOLDER,
  toLocalSecuritySettings,
  clearSecuritySettings,
  saveSecuritySettings,
  type SecurityScope,
  type SecuritySettings,
} from '@/lib/security-settings'
import { useResolvedSecuritySettings, useSecurityGuard } from '@/lib/security-context'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { getWeldDataUsageSummary, type WeldDataUsageSummary } from '@/server/welds'
import {
  previewWdiRecalculation,
  recalculateWdi,
} from '@/server/wdi-recalculation'
import type { WdiRecalculationPreview } from '@/lib/wdi-recalculation'
import { GENERATED_DOCUMENT_STORAGE_EVENT } from '@/lib/document-storage-events'
import { saveRemoteSecuritySettings } from '@/server/security-functions'
import {
  listDispatcherAcceptedWarnings,
  revokeDispatcherAcceptedWarning,
} from '@/server/dispatcher-warnings'
import {
  DISPATCHER_BACKGROUND_STATUS_QUERY_KEY,
  DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
  invalidateWeldJoints,
  invalidateWeldPageQueries,
  STATISTICS_SERVER_QUERY_KEY,
  WELD_DATA_USAGE_QUERY_KEY,
} from '@/lib/weld-query-utils'
import {
  getDispatcherBackgroundStatus,
  refreshDispatcherBackgroundNow,
} from '@/server/dispatcher-background-task-functions'
import { getAcceptedWarningContextParts } from '@/lib/dispatcher-accepted-warning-display'

const SETTINGS_TABS = [
  { id: 'templates', label: 'Шаблоны документов', icon: FileText },
  { id: 'data', label: 'Данные', icon: Database },
  { id: 'requests', label: 'Заявки и заключения', icon: Inbox },
  { id: 'indexes', label: 'Системные индексы', icon: Hash },
  { id: 'dispatcher', label: 'Диспетчер задач и напоминаний', icon: Bell },
  { id: 'saveChecks', label: 'Проверки при сохранении', icon: ShieldCheck },
  { id: 'other', label: 'Прочее', icon: SlidersHorizontal },
  { id: 'security', label: 'Блокировка', icon: LockKeyhole },
] as const

type SettingsTabId = (typeof SETTINGS_TABS)[number]['id']
type ProtectedSettingsChange = (action: () => void | Promise<void>) => Promise<boolean>
type PendingDocumentTemplateReplacement = {
  templateId: DocumentTemplateId
  templateLabel: string
  currentTemplate: StoredDocumentTemplate
  parsedTemplate: TemplateUploadInfo & { fileData: ArrayBuffer }
  analysis: DocumentTemplateReplacementAnalysis
}
const DANGEROUS_SAVE_CHECK_SETTING_IDS = new Set<SaveCheckSettingId>([
  'manualJointName',
  'controlHistoryProtection',
  'systemJointRenameProtection',
])
const EMPTY_WELD_DATA_USAGE: WeldDataUsageSummary = {
  rowsCount: 0,
  leadingLetterIndexedRowsCount: 0,
  weldingTypes: [],
  connectionTypes: [],
  materialGroups: [],
  testTypes: [],
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('templates')
  const needsWeldDataUsage = activeTab === 'data' || activeTab === 'indexes'
  const weldDataUsageQuery = useQuery({
    queryKey: WELD_DATA_USAGE_QUERY_KEY,
    queryFn: () => getWeldDataUsageSummary(),
    enabled: needsWeldDataUsage,
    staleTime: 15_000,
  })
  const weldDataUsage = weldDataUsageQuery.data ?? EMPTY_WELD_DATA_USAGE
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
          ) : activeTab === 'data' && weldDataUsageQuery.isPending ? (
            <SettingsDataLoading />
          ) : activeTab === 'data' && weldDataUsageQuery.error ? (
            <SettingsDataError error={weldDataUsageQuery.error} />
          ) : activeTab === 'data' ? (
            <DataSettingsPanel usage={weldDataUsage} runProtectedSettingsChange={runProtectedSettingsChange} />
          ) : activeTab === 'requests' ? (
            <RequestConclusionSettingsPanel runProtectedSettingsChange={runProtectedSettingsChange} />
          ) : activeTab === 'indexes' ? (
            weldDataUsageQuery.isPending ? (
              <SettingsDataLoading />
            ) : weldDataUsageQuery.error ? (
              <SettingsDataError error={weldDataUsageQuery.error} />
            ) : (
              <SystemIndexesSettingsPanel
                rowsCount={weldDataUsage.rowsCount}
                leadingLetterIndexedRowsCount={weldDataUsage.leadingLetterIndexedRowsCount}
                runProtectedSettingsChange={runProtectedSettingsChange}
              />
            )
          ) : activeTab === 'dispatcher' ? (
            <DispatcherSettingsPanel runProtectedSettingsChange={runProtectedSettingsChange} />
          ) : activeTab === 'saveChecks' ? (
            <SaveChecksSettingsPanel runProtectedSettingsChange={runProtectedSettingsChange} />
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

function SettingsDataLoading() {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
      Загружаем сведения об использовании значений...
    </div>
  )
}

function SettingsDataError({ error }: { error: unknown }) {
  return (
    <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      Не удалось загрузить сведения об использовании значений:{' '}
      {error instanceof Error ? error.message : 'неизвестная ошибка'}
    </div>
  )
}

const SECURITY_PASSWORD_KEYS = {
  entry: 'entryPassword',
  settings: 'settingsPassword',
  edit: 'editPassword',
  importReplace: 'importReplacePassword',
  documentGeneration: 'documentGenerationPassword',
  delete: 'deletePassword',
} as const satisfies Record<SecurityScope, keyof SecuritySettings>

const SECURITY_FLAG_KEYS = {
  entry: 'requirePasswordOnEntry',
  settings: 'protectSettings',
  edit: 'protectEdit',
  importReplace: 'protectImportReplace',
  documentGeneration: 'protectDocumentGeneration',
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
    passwordTitle: 'Пароль на изменение данных импортом',
    description: 'Перед применением любого режима импорта будет запрошен отдельный пароль: импорт новых строк, массовое заполнение или замена данных.',
    example: 'Пользователь загрузил Excel, проверил предпросмотр, нажал применить изменения и ввел пароль импорта.',
  },
  {
    scope: 'documentGeneration',
    title: 'Формирование документов',
    passwordTitle: 'Пароль на формирование документов',
    description:
      'Перед ручным созданием или переформированием пользовательского документа будет запрошен пароль.',
    example:
      'Пользователь формирует ЖСР, Чек-лист или ЗНИ через ПКМ либо раздел “Документы” и вводит пароль. Открытие и скачивание свободны; удаление защищается отдельным паролем удаления. Системные заявки и заключения ЛНК/ПСТО эта защита не затрагивает.',
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
  const settings = useResolvedSecuritySettings()
  const [passwordDrafts, setPasswordDrafts] = useState<Record<SecurityScope, string>>({
    entry: '',
    settings: '',
    edit: '',
    importReplace: '',
    documentGeneration: '',
    delete: '',
  })
  const [repeatDrafts, setRepeatDrafts] = useState<Record<SecurityScope, string>>({
    entry: '',
    settings: '',
    edit: '',
    importReplace: '',
    documentGeneration: '',
    delete: '',
  })
  const [editingPasswordScopes, setEditingPasswordScopes] = useState<Set<SecurityScope>>(() => new Set())
  const [message, setMessage] = useState<string | null>(null)
  const enabledRulesCount = SECURITY_RULE_CARDS.filter((card) =>
    Boolean(settings[SECURITY_PASSWORD_KEYS[card.scope]]) && settings[SECURITY_FLAG_KEYS[card.scope]] === true,
  ).length
  const configuredPasswordsCount = SECURITY_RULE_CARDS.filter((card) => Boolean(settings[SECURITY_PASSWORD_KEYS[card.scope]])).length

  const persistSecuritySettings = async (nextSettings: SecuritySettings) => {
    const remoteSettings = await saveRemoteSecuritySettings({ data: nextSettings })
    saveSecuritySettings(toLocalSecuritySettings(remoteSettings))
  }

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
    const saved = await runProtectedSettingsChange(async () => {
      await persistSecuritySettings({
        ...settings,
        [SECURITY_PASSWORD_KEYS[scope]]: nextPassword,
        ...(enableAfterSave ? { [SECURITY_FLAG_KEYS[scope]]: true } : {}),
      })
    })
    if (!saved) return
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
    const saved = await runProtectedSettingsChange(async () => {
      await persistSecuritySettings({ ...settings, [SECURITY_FLAG_KEYS[scope]]: value })
    })
    if (!saved) return
    setMessage(value ? 'Защита включена. Теперь в этом месте будет запрашиваться свой пароль.' : 'Защита выключена для этого действия.')
  }

  async function resetSecurityScope(scope: SecurityScope) {
    const saved = await runProtectedSettingsChange(async () => {
      await persistSecuritySettings({
        ...settings,
        [SECURITY_PASSWORD_KEYS[scope]]: '',
        [SECURITY_FLAG_KEYS[scope]]: false,
      })
    })
    if (!saved) return
    setPasswordDrafts((current) => ({ ...current, [scope]: '' }))
    setRepeatDrafts((current) => ({ ...current, [scope]: '' }))
    setPasswordEditorOpen(scope, false)
    setMessage('Пароль и защита для выбранного действия сброшены')
  }

  async function resetSecurity() {
    const saved = await runProtectedSettingsChange(async () => {
      clearSecuritySettings()
      await saveRemoteSecuritySettings({ data: DEFAULT_SECURITY_SETTINGS })
    })
    if (!saved) return
    setPasswordDrafts({ entry: '', settings: '', edit: '', importReplace: '', documentGeneration: '', delete: '' })
    setRepeatDrafts({ entry: '', settings: '', edit: '', importReplace: '', documentGeneration: '', delete: '' })
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
            <div className="mt-1 leading-5 text-slate-500">
              Отдельно включаются вход, настройки, редактирование, импорт данных, формирование документов и удаление.
            </div>
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
  const queryClient = useQueryClient()
  const confirmAction = useConfirmAction()
  const [isWdiEditorOpen, setIsWdiEditorOpen] = useState(false)
  const [isRkExposureEditorOpen, setIsRkExposureEditorOpen] = useState(false)
  const [isWdiRulesExpanded, setIsWdiRulesExpanded] = useState(false)
  const [wdiRulesDraft, setWdiRulesDraft] = useState<WdiCalculationRules>(settings.wdiCalculationRules)
  const [wdiRulesMessage, setWdiRulesMessage] = useState<string | null>(null)
  const [wdiPreview, setWdiPreview] = useState<WdiRecalculationPreview | null>(null)
  const [wdiPreviewError, setWdiPreviewError] = useState<string | null>(null)
  const [isLoadingWdiPreview, setIsLoadingWdiPreview] = useState(false)
  const [isRecalculatingWdi, setIsRecalculatingWdi] = useState(false)
  const savedWdiRulesKey = JSON.stringify(settings.wdiCalculationRules)
  const savedWdiCalculationKey = JSON.stringify({
    mode: settings.wdiCalculationMode,
    rules: settings.wdiCalculationRules,
    table: settings.wdiTable,
  })
  const draftWdiRulesKey = JSON.stringify(wdiRulesDraft)
  const wdiRulesDirty = savedWdiRulesKey !== draftWdiRulesKey

  useEffect(() => {
    setWdiRulesDraft(settings.wdiCalculationRules)
    setWdiRulesMessage(null)
  }, [savedWdiRulesKey])

  useEffect(() => {
    setWdiPreview(null)
    setWdiPreviewError(null)
  }, [savedWdiCalculationKey])

  function updateWdiCalculationMode(mode: WdiCalculationMode) {
    setWdiRulesMessage(null)
    void runProtectedSettingsChange(() =>
      saveOtherSettingsAndWait({ ...settings, wdiCalculationMode: mode }),
    ).catch((error) => {
      setWdiRulesMessage(getErrorMessage(error, 'Не удалось сохранить режим расчета WDI.'))
    })
  }

  const saveWdiTable = useCallback(
    (table: NonNullable<typeof settings.wdiTable>) => runProtectedSettingsChange(() =>
      saveOtherSettingsAndWait({ ...settings, wdiCalculationMode: 'table', wdiTable: table }),
    ),
    [runProtectedSettingsChange, settings],
  )

  const saveRkExposureTable = useCallback(
    (table: NonNullable<typeof settings.rkExposureTable>) => runProtectedSettingsChange(() =>
      saveOtherSettingsAndWait({ ...settings, rkExposureTable: table }),
    ),
    [runProtectedSettingsChange, settings],
  )

  function updateWdiRule(
    group: keyof WdiCalculationRules,
    field: keyof WdiConnectionCalculationRule,
    value: string,
  ) {
    setWdiRulesDraft((current) => ({
      ...current,
      [group]: {
        ...current[group],
        [field]: value,
      },
    }))
    setWdiRulesMessage(null)
    setWdiPreview(null)
    setIsWdiRulesExpanded(true)
  }

  async function saveWdiRules() {
    setWdiRulesMessage(null)
    try {
      const saved = await runProtectedSettingsChange(() =>
        saveOtherSettingsAndWait({ ...settings, wdiCalculationRules: wdiRulesDraft }),
      )
      if (saved) setWdiRulesMessage('Правило расчета WDI сохранено для проекта.')
    } catch (error) {
      setWdiRulesMessage(getErrorMessage(error, 'Не удалось сохранить правило расчета WDI.'))
    }
  }

  async function openWdiRecalculationPreview() {
    setWdiPreviewError(null)
    setIsLoadingWdiPreview(true)
    try {
      setWdiPreview(await previewWdiRecalculation())
    } catch (error) {
      setWdiPreviewError(getErrorMessage(error, 'Не удалось проверить пересчет WDI.'))
    } finally {
      setIsLoadingWdiPreview(false)
    }
  }

  async function confirmWdiRecalculation() {
    if (!wdiPreview || wdiPreview.changed === 0) return
    const confirmed = await confirmAction({
      title: 'Пересчитать WDI во всех стыках',
      itemName: `Будет изменено стыков: ${wdiPreview.changed}`,
      description: 'Система применит сохраненный метод расчета ко всем стыкам проекта одной операцией.',
      warning: 'Текущие значения WDI в этих стыках будут заменены. Отменить массовое изменение автоматически нельзя.',
      confirmLabel: 'Пересчитать WDI',
      tone: 'warning',
    })
    if (!confirmed) return

    setWdiPreviewError(null)
    setIsRecalculatingWdi(true)
    try {
      const saved = await runProtectedSettingsChange(async () => {
        await recalculateWdi({
          data: {
            calculationSignature: wdiPreview.calculationSignature,
            sourceSignature: wdiPreview.sourceSignature,
          },
        })
      })
      if (!saved) return
      await invalidateWeldJoints(queryClient)
      window.dispatchEvent(new Event(GENERATED_DOCUMENT_STORAGE_EVENT))
      setWdiRulesMessage(`WDI пересчитан. Обновлено стыков: ${wdiPreview.changed}.`)
      setWdiPreview(await previewWdiRecalculation())
    } catch (error) {
      setWdiPreviewError(getErrorMessage(error, 'Не удалось пересчитать WDI.'))
    } finally {
      setIsRecalculatingWdi(false)
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
          Дополнительные параметры рабочих форм, системных расчетов и связанных операций с данными журнала.
        </p>
      </div>

      <section className="overflow-hidden rounded-md border border-slate-300 bg-white shadow-sm shadow-slate-200/60">
        <div className="border-b border-slate-300 bg-slate-100 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-lg font-semibold text-slate-900">Расчет WDI</h4>
              <p className="mt-1 text-sm leading-5 text-slate-500">
                Режим расчета, справочник D/T и правило выбора исходных диаметра и толщины.
              </p>
            </div>
            <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600">
              {getWdiModeLabel(settings.wdiCalculationMode)}
            </span>
          </div>
        </div>
        <div className="divide-y divide-slate-200">
          <section className="p-4">
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">1. Режим</div>
              <h5 className="mt-1 text-base font-semibold text-slate-900">Режим расчета</h5>
              <p className="mt-1 text-sm leading-5 text-slate-500">
                Определяет, вводится WDI вручную или рассчитывается системой во всех рабочих разделах.
              </p>
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
                description="Расчетный диаметр выбирается по настроенному правилу и делится на 25,4."
                active={settings.wdiCalculationMode === 'formula'}
                onClick={() => updateWdiCalculationMode('formula')}
              />
              <WdiModeCard
                title="Системный: таблица D/T"
                description="Диаметр и толщина выбираются по правилу, затем WDI находится в таблице D/T."
                active={settings.wdiCalculationMode === 'table'}
                onClick={() => {
                  if (!settings.wdiTable) {
                    setIsWdiEditorOpen(true)
                    return
                  }
                  updateWdiCalculationMode('table')
                }}
              />
            </div>
          </section>

          <section className="p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase text-slate-400">2. Справочник</div>
                <h5 className="mt-1 text-base font-semibold text-slate-900">Таблица дюйм-диаметров D/T</h5>
                <p className="mt-1 text-sm leading-5 text-slate-500">
                  Значения для системного табличного режима WDI.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsWdiEditorOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 shadow-sm shadow-sky-100/50 hover:bg-sky-100"
              >
                <SlidersHorizontal className="h-4 w-4" />
                {settings.wdiTable ? 'Редактировать справочник' : 'Заполнить справочник'}
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <WdiSettingFact label="Состояние" value={settings.wdiTable ? 'Настроена' : 'Не настроена'} />
              <WdiSettingFact label="Диаметры" value={settings.wdiTable ? String(settings.wdiTable.diameters.length) : '—'} />
              <WdiSettingFact label="Толщины" value={settings.wdiTable ? String(settings.wdiTable.thicknesses.length) : '—'} />
            </div>
          </section>

          <section className="overflow-hidden">
            <button
              type="button"
              aria-expanded={isWdiRulesExpanded}
              onClick={() => setIsWdiRulesExpanded((current) => !current)}
              className={`flex w-full justify-between gap-4 px-4 text-left hover:bg-slate-50 ${
                isWdiRulesExpanded ? 'items-start py-4' : 'items-center py-2.5'
              }`}
            >
              <span className={`min-w-0 ${isWdiRulesExpanded ? '' : 'flex items-center gap-3'}`}>
                {isWdiRulesExpanded ? (
                  <span className="block shrink-0">
                    <span className="block text-xs font-semibold uppercase text-slate-400">3. Правило расчета</span>
                    <span className="mt-1 block text-base font-semibold text-slate-900">
                      Выбор диаметра и толщины
                    </span>
                  </span>
                ) : (
                  <span className="block shrink-0 text-sm font-semibold text-slate-900">3. Правило расчета</span>
                )}
                {isWdiRulesExpanded ? (
                  <>
                    <span className="mt-1 block text-sm leading-5 text-slate-500">
                      Отдельные правила для соединений типа «У» и остальных типов.
                    </span>
                    <span className="mt-2 block text-xs leading-5 text-slate-600">
                      <span className="font-semibold text-slate-800">У:</span> {formatWdiRuleSummary(settings.wdiCalculationRules.branch)}{' '}
                      <span className="font-semibold text-slate-800">Другие:</span> {formatWdiRuleSummary(settings.wdiCalculationRules.other)}
                    </span>
                  </>
                ) : (
                  <span className="hidden min-w-0 truncate border-l border-slate-200 pl-3 text-xs text-slate-500 md:block">
                    У: {formatWdiRuleCompact(settings.wdiCalculationRules.branch)} · Другие: {formatWdiRuleCompact(settings.wdiCalculationRules.other)}
                  </span>
                )}
              </span>
              <span className={`flex shrink-0 items-center gap-2 text-sm font-semibold text-slate-600 ${isWdiRulesExpanded ? 'pt-0.5' : ''}`}>
                {isWdiRulesExpanded ? 'Скрыть' : 'Настроить'}
                <ChevronDown className={`h-4 w-4 transition-transform ${isWdiRulesExpanded ? 'rotate-180' : ''}`} />
              </span>
            </button>

            {isWdiRulesExpanded ? (
              <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <p className="max-w-3xl text-sm leading-5 text-slate-500">
                    Толщина участвует только в табличном режиме. Пресет заполняет поля, после чего их можно изменить вручную.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <WdiRulePresetButton label="Dmax / У: Dmin" onClick={() => setWdiRulesDraft(cloneWdiRules(WDI_CALCULATION_RULE_PRESETS.current))} />
                    <WdiRulePresetButton label="Все минимальные" onClick={() => setWdiRulesDraft(cloneWdiRules(WDI_CALCULATION_RULE_PRESETS.minimum))} />
                    <WdiRulePresetButton label="Все максимальные" onClick={() => setWdiRulesDraft(cloneWdiRules(WDI_CALCULATION_RULE_PRESETS.maximum))} />
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto rounded-md border border-slate-200 bg-white">
                  <div className="min-w-[760px]">
                    <div className="grid grid-cols-[180px_repeat(3,minmax(0,1fr))] gap-3 border-b border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">
                      <div>Группа соединений</div>
                      <div>Расчетный диаметр</div>
                      <div>Толщина для таблицы</div>
                      <div>Если D1 = D2</div>
                    </div>
                    <WdiRuleConstructorRow
                      title="Тип начинается с У"
                      rule={wdiRulesDraft.branch}
                      onChange={(field, value) => updateWdiRule('branch', field, value)}
                    />
                    <WdiRuleConstructorRow
                      title="Другие и пустой тип"
                      rule={wdiRulesDraft.other}
                      onChange={(field, value) => updateWdiRule('other', field, value)}
                    />
                  </div>
                </div>

                <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-5 text-slate-600">
                  <div><span className="font-semibold text-slate-800">Тип У:</span> {formatWdiRuleSummary(wdiRulesDraft.branch)}</div>
                  <div className="mt-1"><span className="font-semibold text-slate-800">Другие типы:</span> {formatWdiRuleSummary(wdiRulesDraft.other)}</div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className={`text-sm ${wdiRulesMessage?.startsWith('Не удалось') ? 'text-rose-700' : 'text-slate-500'}`}>
                    {wdiRulesDirty ? 'Есть несохраненные изменения правила.' : wdiRulesMessage ?? 'Правило сохранено и используется системой.'}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {wdiRulesDirty ? (
                      <button
                        type="button"
                        onClick={() => setWdiRulesDraft(cloneWdiRules(settings.wdiCalculationRules))}
                        className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Отменить изменения
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={!wdiRulesDirty}
                      onClick={() => void saveWdiRules()}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-sky-700 bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-200 disabled:text-slate-500"
                    >
                      <Save className="h-4 w-4" />
                      Сохранить правило
                    </button>
                  </div>
                </div>

                <div className="mt-4 border-t border-amber-200 pt-4">
                  <div className="flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50/70 p-3 md:flex-row md:items-center md:justify-between">
                    <div className="max-w-3xl">
                      <div className="text-sm font-semibold text-slate-900">Сохраненные значения WDI</div>
                      {wdiRulesDirty ? (
                        <p className="mt-1 text-xs font-semibold text-amber-800">Сначала сохраните изменения правила выбора D/T.</p>
                      ) : settings.wdiCalculationMode === 'manual' ? (
                        <p className="mt-1 text-xs font-semibold text-slate-500">Пересчет доступен только в системном режиме.</p>
                      ) : (
                        <p className="mt-1 text-xs text-slate-600">Предварительная проверка сравнит сохраненные WDI с текущим методом без изменения данных.</p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={wdiRulesDirty || settings.wdiCalculationMode === 'manual' || isLoadingWdiPreview}
                      onClick={() => void openWdiRecalculationPreview()}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <RefreshCw className={`h-4 w-4 ${isLoadingWdiPreview ? 'animate-spin' : ''}`} />
                      {isLoadingWdiPreview ? 'Проверяем...' : 'Проверить и пересчитать WDI'}
                    </button>
                  </div>
                  {wdiPreviewError && !wdiPreview ? (
                    <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{wdiPreviewError}</div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </section>

      <section className="rounded-md border border-slate-300 bg-white p-4 shadow-sm shadow-slate-200/60">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="max-w-4xl">
            <h4 className="text-sm font-semibold text-slate-900">Экспозиции по диаметрам</h4>
            <p className="mt-1 text-sm leading-5 text-slate-500">
              Таблица задаёт варианты снимков или координат мерного пояса для РК. Диаметр строки действует до следующего диаметра,
              а знак «+» отмечает вариант по умолчанию. Замена таблицы не переписывает уже сохранённые описания дефектов.
            </p>
          </div>
          <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${
            settings.rkExposureTable
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 bg-slate-50 text-slate-500'
          }`}>
            {settings.rkExposureTable ? 'настроено' : 'не настроено'}
          </span>
        </div>
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 text-sm text-slate-600">
              <div className="font-semibold text-slate-800">Справочник снимков РК</div>
              <div className="mt-1">
                {settings.rkExposureTable
                  ? `${settings.rkExposureTable.entries.length} диапазонов · ${settings.rkExposureTable.entries.reduce((sum, entry) => sum + entry.options.length, 0)} вариантов`
                  : 'Справочник пока не заполнен.'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsRkExposureEditorOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 shadow-sm shadow-sky-100/50 hover:bg-sky-100"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {settings.rkExposureTable ? 'Редактировать справочник' : 'Заполнить справочник'}
            </button>
          </div>
        </div>
      </section>

      {isWdiEditorOpen ? (
        <WdiTableEditorDialog table={settings.wdiTable} onClose={() => setIsWdiEditorOpen(false)} onSave={saveWdiTable} />
      ) : null}
      {isRkExposureEditorOpen ? (
        <RkExposureTableEditorDialog table={settings.rkExposureTable} onClose={() => setIsRkExposureEditorOpen(false)} onSave={saveRkExposureTable} />
      ) : null}
      {wdiPreview ? (
        <WdiRecalculationPreviewDialog
          preview={wdiPreview}
          error={wdiPreviewError}
          isRecalculating={isRecalculatingWdi}
          onClose={() => {
            if (!isRecalculatingWdi) setWdiPreview(null)
          }}
          onRecalculate={() => void confirmWdiRecalculation()}
        />
      ) : null}
    </div>
  )
}

function WdiRulePresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
    >
      {label}
    </button>
  )
}

function WdiSettingFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  )
}

function WdiRuleConstructorRow({
  title,
  rule,
  onChange,
}: {
  title: string
  rule: WdiConnectionCalculationRule
  onChange: (field: keyof WdiConnectionCalculationRule, value: string) => void
}) {
  const selectClassName = 'h-10 w-full rounded-md border-slate-200 bg-white py-1 pl-3 pr-8 text-sm text-slate-800'
  return (
    <div className="grid grid-cols-[180px_repeat(3,minmax(0,1fr))] gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0">
      <div className="flex items-center text-sm font-semibold text-slate-800">{title}</div>
      <select
        value={rule.diameter}
        onChange={(event) => onChange('diameter', event.target.value)}
        className={selectClassName}
        aria-label={`${title}: расчетный диаметр`}
      >
        <option value="min">Dmin</option>
        <option value="max">Dmax</option>
      </select>
      <select
        value={rule.thickness}
        onChange={(event) => onChange('thickness', event.target.value)}
        className={selectClassName}
        aria-label={`${title}: толщина`}
      >
        <option value="linked">T выбранного диаметра</option>
        <option value="min">Tmin независимо</option>
        <option value="max">Tmax независимо</option>
      </select>
      <select
        value={rule.equalDiameterThickness}
        disabled={rule.thickness !== 'linked'}
        onChange={(event) => onChange('equalDiameterThickness', event.target.value)}
        className={`${selectClassName} disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400`}
        aria-label={`${title}: толщина при равных диаметрах`}
      >
        <option value="min">Tmin</option>
        <option value="max">Tmax</option>
      </select>
    </div>
  )
}

function WdiRecalculationPreviewDialog({
  preview,
  error,
  isRecalculating,
  onClose,
  onRecalculate,
}: {
  preview: WdiRecalculationPreview
  error: string | null
  isRecalculating: boolean
  onClose: () => void
  onRecalculate: () => void
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isRecalculating) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isRecalculating, onClose])

  return (
    <LargeDialogShell maxWidthClassName="max-w-[1040px]" maxHeightClassName="max-h-[90vh]" overlayClassName="z-[150] bg-slate-950/35">
      <DialogHeader
        title={(
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Предварительный пересчет WDI</span>
            <span className={`text-base ${getWdiDeltaToneClassName(preview.wdiDelta)}`}>
              Изменение WDI {formatSignedWdiDelta(preview.wdiDelta)}
            </span>
          </span>
        )}
        subtitle="Данные еще не изменены"
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
          Проверьте изменения перед массовым пересчетом. Подтверждение заменит сохраненное WDI во всех отмеченных ниже стыках.
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <WdiPreviewMetric label="Всего стыков" value={preview.total} />
          <WdiPreviewMetric label="Изменится" value={preview.changed} tone="warning" />
          <WdiPreviewMetric label="Без изменений" value={preview.unchanged} />
          <WdiPreviewMetric label="Будет заполнено" value={preview.filled} tone="success" />
          <WdiPreviewMetric label="Будет очищено" value={preview.cleared} tone="danger" />
        </div>
        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        ) : null}
        {preview.examples.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] table-fixed text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="w-[150px] px-3 py-2">Проект / титул</th>
                    <th className="w-[180px] px-3 py-2">Линия</th>
                    <th className="w-[130px] px-3 py-2">Стык</th>
                    <th className="w-[130px] px-3 py-2">Было WDI</th>
                    <th className="px-3 py-2">Станет WDI по текущему методу расчета</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.examples.map((example) => (
                    <tr key={example.id} className="text-slate-700">
                      <td className="break-words px-3 py-2">{[example.projectTitle, example.subtitleCode].filter(Boolean).join(' / ') || '—'}</td>
                      <td className="break-words px-3 py-2">{example.line || '—'}</td>
                      <td className="break-words px-3 py-2">{example.joint || `ID ${example.id}`}</td>
                      <td className="px-3 py-2 font-semibold text-slate-600">{formatWdiPreviewValue(example.before)}</td>
                      <td className="px-3 py-2 font-semibold text-sky-800">{formatWdiPreviewValue(example.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.examplesTruncated ? (
              <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Показаны первые {preview.examples.length} изменений из {preview.changed}.
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Все сохраненные значения уже соответствуют текущему методу расчета WDI.
          </div>
        )}
      </div>
      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
        <button
          type="button"
          disabled={isRecalculating}
          onClick={onClose}
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Закрыть
        </button>
        <button
          type="button"
          disabled={preview.changed === 0 || isRecalculating}
          onClick={onRecalculate}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-amber-700 bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-200 disabled:text-slate-500"
        >
          <RefreshCw className={`h-4 w-4 ${isRecalculating ? 'animate-spin' : ''}`} />
          {isRecalculating ? 'Пересчитываем...' : `Пересчитать ${preview.changed} стыков`}
        </button>
      </div>
    </LargeDialogShell>
  )
}

function WdiPreviewMetric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'warning' | 'success' | 'danger' }) {
  const toneClassName = {
    neutral: 'border-slate-200 bg-slate-50 text-slate-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    danger: 'border-rose-200 bg-rose-50 text-rose-900',
  }[tone]
  return (
    <div className={`rounded-md border px-3 py-3 ${toneClassName}`}>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs font-medium">{label}</div>
    </div>
  )
}

function cloneWdiRules(rules: WdiCalculationRules): WdiCalculationRules {
  return {
    branch: { ...rules.branch },
    other: { ...rules.other },
  }
}

function formatWdiRuleSummary(rule: WdiConnectionCalculationRule) {
  const diameter = rule.diameter === 'min' ? 'Dmin' : 'Dmax'
  if (rule.thickness === 'min') return `${diameter}; в таблице используется Tmin независимо от диаметра.`
  if (rule.thickness === 'max') return `${diameter}; в таблице используется Tmax независимо от диаметра.`
  return `${diameter}; в таблице используется T выбранного материала, при D1 = D2 — ${rule.equalDiameterThickness === 'min' ? 'Tmin' : 'Tmax'}.`
}

function formatWdiRuleCompact(rule: WdiConnectionCalculationRule) {
  const diameter = rule.diameter === 'min' ? 'Dmin' : 'Dmax'
  if (rule.thickness === 'min') return `${diameter} / Tmin`
  if (rule.thickness === 'max') return `${diameter} / Tmax`
  return `${diameter} / T материала / D1 = D2: ${rule.equalDiameterThickness === 'min' ? 'Tmin' : 'Tmax'}`
}

function formatWdiPreviewValue(value: number | null) {
  return value === null
    ? 'не рассчитано'
    : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value)
}

function formatSignedWdiDelta(value: number) {
  const formatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(Math.abs(value))
  if (value > 0) return `+${formatted}`
  if (value < 0) return `−${formatted}`
  return '0'
}

function getWdiDeltaToneClassName(value: number) {
  if (value > 0) return 'text-emerald-700'
  if (value < 0) return 'text-rose-700'
  return 'text-slate-500'
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
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

function getWdiModeLabel(mode: WdiCalculationMode) {
  if (mode === 'formula') return 'системный: D / 25,4'
  if (mode === 'table') return 'системный: таблица D/T'
  return 'пользовательский'
}

function DataSettingsPanel({
  usage,
  runProtectedSettingsChange,
}: {
  usage: WeldDataUsageSummary
  runProtectedSettingsChange: ProtectedSettingsChange
}) {
  const settings = useDataListSettings()
  const [drafts, setDrafts] = useState<Record<DataListSettingsKey, string>>({
    weldingTypes: '',
    connectionTypes: '',
    materialGroups: '',
    testTypes: '',
  })
  const [message, setMessage] = useState<string | null>(null)
  const usageCountsByKey: Record<DataListSettingsKey, Map<string, number>> = {
    weldingTypes: new Map(usage.weldingTypes),
    connectionTypes: new Map(usage.connectionTypes),
    materialGroups: new Map(usage.materialGroups),
    testTypes: new Map(usage.testTypes),
  }

  async function addListValue(config: DataListConfig) {
    const nextValue = normalizeDataListOption(drafts[config.key])
    const values = settings[config.key]
    if (!nextValue) {
      setMessage(`Введите значение для списка “${config.title}”.`)
      return
    }
    const inputError = getDataListOptionInputError(config.key, nextValue)
    if (inputError) {
      setMessage(`${config.title}: ${inputError}`)
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

      {DATA_LIST_CONFIGS.map((config) => {
        const inputError = getDataListOptionInputError(config.key, drafts[config.key])
        const hasRestrictedAlphabet = config.key !== 'testTypes'

        return (
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
                    aria-invalid={inputError ? true : undefined}
                    className={`h-10 w-full rounded-md border bg-white px-3 text-sm text-slate-900 shadow-sm shadow-slate-200/50 focus:outline-none focus:ring-2 ${
                      inputError
                        ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'
                        : 'border-slate-300 focus:border-sky-400 focus:ring-sky-100'
                    }`}
                  />
                  {inputError ? (
                    <span className="block text-xs font-normal leading-5 text-rose-600">{inputError}</span>
                  ) : hasRestrictedAlphabet ? (
                    <span className="block text-xs font-normal leading-5 text-slate-500">
                      Разрешены кириллические буквы, цифры и пробелы.
                    </span>
                  ) : null}
                </label>
                <button
                  type="button"
                  onClick={() => addListValue(config)}
                  disabled={Boolean(inputError)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <Plus className="h-4 w-4" />
                  Добавить
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {message ? <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">{message}</div> : null}
    </div>
  )
}

type DataListSettingsKey = 'weldingTypes' | 'connectionTypes' | 'materialGroups' | 'testTypes'

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
  {
    key: 'materialGroups',
    title: 'Группа материалов',
    description:
      'Пользователь выбирает одно значение из этого списка в меню создания и редактирования стыка. Поле находится в разделе “Сварка” после “Тип соединения”.',
    protectionHint: 'Если группа материалов уже используется в стыках, удалить ее из настроек нельзя.',
    placeholder: 'Например: М01',
    emptyListText: 'Список пока пуст. После добавления значений поле “Группа материалов” станет выпадающим списком в форме стыка.',
    resetButtonLabel: 'Очистить список',
    resetBlockedAction: 'очистить список “Группа материалов”',
    resetSuccessMessage: 'Список “Группа материалов” очищен.',
    usedValueText: 'эта группа материалов',
    minOptionsMessage: '',
  },
  {
    key: 'testTypes',
    title: 'Вид испытаний',
    description:
      'В разделе “Испытания” формы стыка пользователь сможет выбрать один или несколько вариантов. Несколько видов сохраняются одной записью через запятую, например: “ГИ, ПИ”.',
    protectionHint: 'Если вид испытаний уже используется хотя бы в одном стыке, удалить его из настроек нельзя.',
    placeholder: 'Например: ГИ',
    emptyListText: 'Список пуст. Добавьте виды испытаний, которые используются на проекте.',
    resetButtonLabel: 'Вернуть ГИ/ПИ',
    resetBlockedAction: 'вернуть список к ГИ/ПИ',
    resetSuccessMessage: 'Список “Вид испытаний” возвращен к значениям по умолчанию.',
    usedValueText: 'этот вид испытаний',
    minOptionsMessage: '',
  },
]

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
  leadingLetterIndexedRowsCount,
  runProtectedSettingsChange,
}: {
  rowsCount: number
  leadingLetterIndexedRowsCount: number
  runProtectedSettingsChange: ProtectedSettingsChange
}) {
  const settings = useSystemIndexSettings()
  const [draft, setDraft] = useState<SystemIndexSettings>(settings)
  const canEditIndexLetters = rowsCount === 0
  const validationError = getSystemIndexValidationError(draft)
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(settings)
  const indexLettersChanged = SYSTEM_INDEX_ROWS.some((row) => draft[row.id] !== settings[row.id])
  const canSave = hasChanges && !validationError && (canEditIndexLetters || !indexLettersChanged)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  const updateDraft = (id: SystemIndexKey, value: string) => {
    setDraft((current) => ({
      ...current,
      [id]: normalizeSystemIndexLetter(value),
    }))
  }

  const resetDraft = () => runProtectedSettingsChange(() => setDraft((current) => ({
    ...DEFAULT_SYSTEM_INDEX_SETTINGS,
    allowLeadingLetterIndex: current.allowLeadingLetterIndex,
  })))

  const saveDraft = async () => {
    if (!canSave) return
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
            <div className={`mt-3 inline-flex rounded-md border px-3 py-1.5 text-xs font-semibold ${canEditIndexLetters ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              {canEditIndexLetters ? 'Проект пустой: буквы можно изменить' : `Буквы индексов закреплены: в проекте стыков ${rowsCount}`}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canEditIndexLetters}
              onClick={resetDraft}
              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Вернуть S/F/R/W/Y
            </button>
            <button
              type="button"
              disabled={!canSave}
              onClick={saveDraft}
              className="inline-flex items-center justify-center rounded-md border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              Сохранить настройки
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
                  disabled={!canEditIndexLetters}
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

      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-sky-200 bg-sky-50/70 p-4">
        <input
          type="checkbox"
          checked={draft.allowLeadingLetterIndex}
          onChange={(event) => setDraft((current) => ({
            ...current,
            allowLeadingLetterIndex: event.target.checked,
          }))}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
        />
        <span>
          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
            <span>Разрешать буквенный индекс перед номером стыка</span>
            <span className="inline-flex shrink-0 items-center rounded-md border border-sky-200 bg-white px-2 py-0.5 text-xs font-semibold text-sky-800">
              Стыков: {leadingLetterIndexedRowsCount}
            </span>
          </span>
          <span className="mt-1 block text-sm leading-5 text-slate-600">
            Разрешает создавать и импортировать имена с одной латинской буквой после S/F, например FB01 или SB43.
            Ранее созданные такие стыки и их цепочки остаются корректными, даже если настройку потом выключить.
          </span>
        </span>
      </label>

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
  const [templateLoadError, setTemplateLoadError] = useState<string | null>(null)
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true)
  const [templateLoadAttempt, setTemplateLoadAttempt] = useState(0)
  const [builderTemplate, setBuilderTemplate] = useState<StoredDocumentTemplate | null>(null)
  const [nextDocumentNumber, setNextDocumentNumber] = useState<number | null>(null)
  const [isResettingDocumentNumber, setIsResettingDocumentNumber] = useState(false)
  const [isUploadingTemplate, setIsUploadingTemplate] = useState(false)
  const [pendingTemplateReplacement, setPendingTemplateReplacement] =
    useState<PendingDocumentTemplateReplacement | null>(null)
  const templateFileInputRef = useRef<HTMLInputElement>(null)
  const templateFileMenuRef = useRef<HTMLDetailsElement>(null)
  const confirmAction = useConfirmAction()
  const { requireDeletePassword } = useSecurityGuard()
  const activeTemplate = DOCUMENT_TEMPLATE_TYPES.find((template) => template.id === activeTemplateId) ?? DOCUMENT_TEMPLATE_TYPES[0]
  const activeUpload = uploads[activeTemplateId]
  const documentOptions = getWeldingJournalTemplateOptions(
    isGeneratedDocumentType(activeTemplateId)
      ? activeUpload?.options?.[activeTemplateId]
      : undefined,
  )

  useEffect(() => {
    let isMounted = true
    setIsLoadingTemplates(true)
    setTemplateLoadError(null)
    loadDocumentTemplates()
      .then((storedTemplates) => {
        if (isMounted) setUploads(storedTemplates)
      })
      .catch((error) => {
        if (isMounted) {
          setTemplateLoadError(error instanceof Error ? error.message : 'Не удалось загрузить сохраненные шаблоны.')
        }
      })
      .finally(() => {
        if (isMounted) setIsLoadingTemplates(false)
      })
    return () => {
      isMounted = false
    }
  }, [templateLoadAttempt])

  useEffect(() => {
    if (!isGeneratedDocumentType(activeTemplateId) && !isSystemDocumentTemplateId(activeTemplateId)) {
      setNextDocumentNumber(null)
      return
    }
    let isMounted = true
    setNextDocumentNumber(null)
    const loadSequence = isGeneratedDocumentType(activeTemplateId)
      ? loadGeneratedDocumentSequence(activeTemplateId)
      : loadSystemDocumentSequence(activeTemplateId)
    loadSequence
      .then((result) => {
        if (isMounted) setNextDocumentNumber(result.nextNumber)
      })
      .catch((error) => {
        if (isMounted) {
          setUploadError(error instanceof Error ? error.message : 'Не удалось загрузить номер следующего документа.')
        }
      })
    return () => {
      isMounted = false
    }
  }, [activeTemplateId])

  useEffect(() => {
    templateFileMenuRef.current?.removeAttribute('open')
  }, [activeTemplateId])

  const handleTemplateUploadRequest = async () => {
    setUploadError(null)
    const allowed = await runProtectedSettingsChange(() => undefined)
    if (!allowed) return
    templateFileMenuRef.current?.removeAttribute('open')
    templateFileInputRef.current?.click()
  }

  const handleTemplateUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploadError(null)
    setIsUploadingTemplate(true)
    try {
      const parsedTemplate = await parseDocumentTemplateFile(file)
      if (activeUpload) {
        const analysis = await analyzeDocumentTemplateReplacement(activeUpload, parsedTemplate)
        if (analysis.status === 'incompatible') {
          setPendingTemplateReplacement({
            templateId: activeTemplateId,
            templateLabel: activeTemplate.label,
            currentTemplate: activeUpload,
            parsedTemplate,
            analysis,
          })
          return
        }

        const mappingDescription =
          analysis.status === 'adjusted'
            ? `Настройки будут перенесены на лист «${analysis.targetSheetName}» со сдвигом строк ${formatTemplateOffset(analysis.rowOffset)} и столбцов ${formatTemplateOffset(analysis.columnOffset)}.`
            : analysis.bindingCount > 0
              ? `Все назначения конструктора сохранены: ${analysis.retainedBindingCount} из ${analysis.bindingCount}.`
              : 'У текущего шаблона нет назначений ячеек, поэтому перенос не требуется.'
        const confirmed = await confirmAction({
          title: `Заменить шаблон «${activeTemplate.label}»?`,
          itemName: `${activeUpload.fileName} → ${file.name}`,
          description:
            'Система проверила листы, назначенные ячейки, повторяемый блок и объединения. Новый файл станет активным только после успешного сохранения.',
          warning: mappingDescription,
          confirmLabel: 'Заменить шаблон',
          tone: 'warning',
        })
        if (!confirmed) return

        const savedTemplate = await saveDocumentTemplate(activeTemplateId, parsedTemplate, {
          constructorConfig: analysis.constructorConfig,
        })
        setUploads((currentUploads) => ({
          ...currentUploads,
          [activeTemplateId]: savedTemplate,
        }))
        return
      }

      const savedTemplate = await saveDocumentTemplate(activeTemplateId, parsedTemplate, {
        constructorConfig: null,
      })
      setUploads((currentUploads) => ({
        ...currentUploads,
        [activeTemplateId]: savedTemplate,
      }))
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Не удалось прочитать шаблон.')
    } finally {
      setIsUploadingTemplate(false)
    }
  }

  const savePendingTemplateReplacement = async (
    constructorConfig: DocumentTemplateConstructorConfig | null,
  ) => {
    const pending = pendingTemplateReplacement
    if (!pending) return
    setUploadError(null)
    setIsUploadingTemplate(true)
    try {
      const savedTemplate = await saveDocumentTemplate(
        pending.templateId,
        pending.parsedTemplate,
        { constructorConfig },
      )
      setUploads((currentUploads) => ({
        ...currentUploads,
        [pending.templateId]: savedTemplate,
      }))
      setPendingTemplateReplacement(null)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Не удалось заменить шаблон.')
    } finally {
      setIsUploadingTemplate(false)
    }
  }

  const handleResetConstructorAndReplace = async () => {
    const pending = pendingTemplateReplacement
    if (!pending) return
    const confirmed = await confirmAction({
      title: `Сбросить конструктор «${pending.templateLabel}»?`,
      itemName: `${pending.currentTemplate.fileName} → ${pending.parsedTemplate.fileName}`,
      description:
        'Новый файл будет сохранен, но все назначения ячеек и повторяемого блока этого шаблона удалятся.',
      warning:
        'Используйте этот вариант только если структура Excel действительно создана заново и перенос старых адресов не нужен.',
      confirmLabel: 'Заменить и сбросить',
      tone: 'danger',
    })
    if (confirmed) await savePendingTemplateReplacement(null)
  }

  const handleDocumentOptionChange = async (
    optionKey: keyof WeldingJournalTemplateOptions,
    value: WeldingJournalTemplateOptions[keyof WeldingJournalTemplateOptions],
  ) => {
    if (!activeUpload || !isGeneratedDocumentType(activeTemplateId)) return

    const nextOptions = {
      ...documentOptions,
      [optionKey]: value,
    }
    await runProtectedSettingsChange(async () => {
      const savedTemplate = await updateDocumentTemplateOptions(activeTemplateId, {
        [activeTemplateId]: nextOptions,
      })
      if (!savedTemplate) return
      setUploads((currentUploads) => ({
        ...currentUploads,
        [activeTemplateId]: savedTemplate,
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

  const handleTemplateDelete = async () => {
    if (!activeUpload) return
    if (!(await requireDeletePassword('удаление шаблона документа'))) return

    const confirmed = await confirmAction({
      title: 'Удалить шаблон документа?',
      itemName: `${activeTemplate.label} · ${activeUpload.fileName}`,
      description: 'Общий исходный файл и настройки конструктора будут удалены для всех пользователей проекта.',
      warning:
        'Данные стыков и уже созданные записи истории не изменятся, но новые документы этого типа нельзя будет сформировать до загрузки нового шаблона.',
      confirmLabel: 'Удалить шаблон',
      tone: 'danger',
    })
    if (!confirmed) return

    setUploadError(null)
    try {
      await deleteDocumentTemplate(activeTemplateId)
      setUploads((currentUploads) => {
        const nextUploads = { ...currentUploads }
        delete nextUploads[activeTemplateId]
        return nextUploads
      })
      setBuilderTemplate((currentTemplate) => currentTemplate?.id === activeTemplateId ? null : currentTemplate)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Не удалось удалить шаблон.')
    }
  }

  const handleDocumentSequenceReset = async () => {
    if (!isGeneratedDocumentType(activeTemplateId) && !isSystemDocumentTemplateId(activeTemplateId)) return
    const isSystemDocument = isSystemDocumentTemplateId(activeTemplateId)
    const confirmed = await confirmAction({
      title: 'Обнулить счетчик документов?',
      itemName: activeTemplate.label,
      description: 'Следующий новый документ этого типа получит порядковый номер 1.',
      warning:
        isSystemDocument
          ? 'Имена уже созданных заявок и заключений не изменятся. Если сочетание системного имени и даты уже занято, система пропустит такой номер, чтобы не объединить разные документы.'
          : 'Номера уже сформированных документов не изменятся. Поэтому после обнуления в истории могут появиться документы с одинаковыми порядковыми номерами.',
      confirmLabel: 'Обнулить счетчик',
      tone: 'danger',
    })
    if (!confirmed) return

    setIsResettingDocumentNumber(true)
    setUploadError(null)
    try {
      await runProtectedSettingsChange(async () => {
        const result = isSystemDocument
          ? await resetStoredSystemDocumentSequence(activeTemplateId)
          : await resetGeneratedDocumentSequence(activeTemplateId as GeneratedDocumentType)
        setNextDocumentNumber(result.nextNumber)
      })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Не удалось обнулить счетчик документов.')
    } finally {
      setIsResettingDocumentNumber(false)
    }
  }

  return (
    <div className="space-y-6">
      <input
        ref={templateFileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleTemplateUpload}
      />
      <div className="rounded-md border border-slate-300 bg-slate-100/80 px-4 py-3 shadow-sm shadow-slate-200/60">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-slate-500" />
            <h3 className="text-base font-semibold text-slate-900">Шаблоны документов</h3>
          </div>
          <p className="text-sm leading-5 text-slate-600">
            Загрузите оформленный Excel и назначьте его ячейкам поля в конструкторе. Поддерживаются повторяемые строки и группы.
          </p>
        </div>

        {uploadError ? (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {uploadError}
          </div>
        ) : null}
      </div>

      <DocumentTemplateLoadBoundary
        isLoading={isLoadingTemplates}
        error={templateLoadError}
        onRetry={() => setTemplateLoadAttempt((current) => current + 1)}
      >
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <div className="rounded-md border border-slate-300 bg-white p-2 shadow-sm shadow-slate-200/60">
          {DOCUMENT_TEMPLATE_TYPES.map((templateType) => {
            if (
              isLnkConclusionTemplateId(templateType.id) &&
              templateType.id !== LNK_CONCLUSION_TEMPLATE_PROFILES[0].id
            ) {
              return null
            }
            if (templateType.id === LNK_CONCLUSION_TEMPLATE_PROFILES[0].id) {
              const isActive = isLnkConclusionTemplateId(activeTemplateId)
              const uploadedCount = LNK_CONCLUSION_TEMPLATE_PROFILES.filter(
                (profile) => Boolean(uploads[profile.id]),
              ).length
              return (
                <button
                  key="lnkConclusion"
                  type="button"
                  onClick={() =>
                    setActiveTemplateId(
                      isLnkConclusionTemplateId(activeTemplateId)
                        ? activeTemplateId
                        : LNK_CONCLUSION_TEMPLATE_PROFILES[0].id,
                    )
                  }
                  className={`flex w-full items-start justify-between gap-3 rounded-md px-3 py-3 text-left transition-colors ${
                    isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span>
                    <span className="block text-sm font-semibold">Заключения ЛНК</span>
                    <span className={`mt-1 block text-xs ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>
                      Отдельные формы ВИК, РК, УЗК, ПВК и прочих видов НК.
                    </span>
                  </span>
                  {uploadedCount > 0 ? (
                    <span
                      className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
                        isActive
                          ? 'border-slate-600 bg-slate-800 text-emerald-300'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {uploadedCount}/{LNK_CONCLUSION_TEMPLATE_PROFILES.length}
                    </span>
                  ) : null}
                </button>
              )
            }
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
          {isLnkConclusionTemplateId(activeTemplateId) ? (
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Форма заключения
              </div>
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Форма заключения ЛНК">
                {LNK_CONCLUSION_TEMPLATE_PROFILES.map((profile) => {
                  const isActive = activeTemplateId === profile.id
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveTemplateId(profile.id)}
                      className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors ${
                        isActive
                          ? 'border-sky-700 bg-sky-700 text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-800'
                      }`}
                    >
                      {profile.label}
                      {uploads[profile.id] ? (
                        <CheckCircle2 className={`h-3.5 w-3.5 ${isActive ? 'text-emerald-200' : 'text-emerald-600'}`} />
                      ) : null}
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                «Прочие» используется для видов НК без отдельной формы. Новую самостоятельную форму,
                например РФА, можно будет добавить без изменения созданных заключений.
              </p>
            </div>
          ) : null}
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
                {['xlsx', 'xls'].includes(activeUpload.fileType) ? (
                  <button
                    type="button"
                    onClick={() => setBuilderTemplate(activeUpload)}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 transition-colors hover:border-sky-300 hover:bg-sky-100"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    Открыть конструктор
                  </button>
                ) : null}
                <details
                  ref={templateFileMenuRef}
                  className="relative"
                >
                  <summary
                    className="inline-flex h-full min-h-10 cursor-pointer list-none items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-slate-600 hover:bg-slate-50 hover:text-slate-900 [&::-webkit-details-marker]:hidden"
                    title="Управление файлом шаблона"
                    aria-label="Управление файлом шаблона"
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </summary>
                  <div className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-md border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-300/40">
                    <button
                      type="button"
                      onClick={() => {
                        templateFileMenuRef.current?.removeAttribute('open')
                        handleTemplateDownload()
                      }}
                      className="flex w-full items-start gap-3 rounded px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-sky-50 hover:text-sky-900"
                    >
                      <Download className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        <span className="block font-semibold">Скачать шаблон</span>
                        <span className="mt-0.5 block text-xs leading-4 text-slate-500">
                          Скачать текущий исходный файл без изменений.
                        </span>
                      </span>
                    </button>
                    <div className="my-1 border-t border-slate-100" />
                    <button
                      type="button"
                      disabled={isUploadingTemplate}
                      onClick={() => void handleTemplateUploadRequest()}
                      className="flex w-full items-start gap-3 rounded px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-amber-50 hover:text-amber-900 disabled:opacity-50"
                    >
                      <Upload className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        <span className="block font-semibold">
                          {isUploadingTemplate ? 'Загружаю...' : 'Заменить файл шаблона'}
                        </span>
                        <span className="mt-0.5 block text-xs leading-4 text-slate-500">
                          Потребуется пароль настроек и подтверждение.
                        </span>
                      </span>
                    </button>
                    <div className="my-1 border-t border-slate-100" />
                    <button
                      type="button"
                      onClick={() => {
                        templateFileMenuRef.current?.removeAttribute('open')
                        void handleTemplateDelete()
                      }}
                      className="flex w-full items-start gap-3 rounded px-3 py-2.5 text-left text-sm text-rose-700 hover:bg-rose-50"
                    >
                      <Trash2 className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        <span className="block font-semibold">Удалить шаблон</span>
                        <span className="mt-0.5 block text-xs leading-4 text-rose-600">
                          Потребуется пароль удаления и подтверждение.
                        </span>
                      </span>
                    </button>
                  </div>
                </details>
              </div>
            ) : (
              <button
                type="button"
                disabled={isUploadingTemplate}
                onClick={() => void handleTemplateUploadRequest()}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-sky-700 bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {isUploadingTemplate ? 'Загружаю...' : 'Загрузить первый шаблон'}
              </button>
            )}
          </div>

          <div className="space-y-6">
            {(activeUpload && isGeneratedDocumentType(activeTemplateId)) ||
            isSystemDocumentTemplateId(activeTemplateId) ? (
              <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600">
                    <Hash className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Нумерация документов</div>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500">
                      Следующий новый {isLnkConclusionTemplateId(activeTemplateId) ? 'документ этой формы' : 'документ'} получит номер{' '}
                      <span className="font-semibold text-slate-800">{nextDocumentNumber ?? '…'}</span>.
                      {isSystemDocumentTemplateId(activeTemplateId)
                        ? ' Пользовательское имя и изменение состава существующего документа счетчик не расходуют. При приведении пользовательского имени к системному выделяется следующий номер.'
                        : ' Повторное формирование существующего документа сохраняет его номер.'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDocumentSequenceReset()}
                  disabled={isResettingDocumentNumber || nextDocumentNumber === null}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Hash className="h-4 w-4" />
                  {isResettingDocumentNumber ? 'Обнуляю...' : 'Обнулить счетчик'}
                </button>
              </div>
            ) : null}
            {isGeneratedDocumentType(activeTemplateId) ? (
              <WeldingJournalTemplateOptionsPanel
                disabled={!activeUpload}
                documentLabel={activeTemplate.label}
                options={documentOptions}
                onChange={handleDocumentOptionChange}
              />
            ) : null}

            {activeUpload ? (
              <TemplateUploadPreview upload={activeUpload} />
            ) : (
              <EmptyTemplateState />
            )}
          </div>
        </div>
      </div>
      </DocumentTemplateLoadBoundary>
      {builderTemplate ? (
        <DocumentTemplateBuilder
          template={builderTemplate}
          onClose={() => setBuilderTemplate(null)}
          onSave={async (config: DocumentTemplateConstructorConfig) => {
            return runProtectedSettingsChange(async () => {
              const savedTemplate = await updateDocumentTemplateConstructor(builderTemplate.id, config)
              if (!savedTemplate) throw new Error('Шаблон больше не найден.')
              setUploads((currentUploads) => ({
                ...currentUploads,
                [savedTemplate.id]: savedTemplate,
              }))
              setBuilderTemplate(savedTemplate)
            })
          }}
        />
      ) : null}
      {pendingTemplateReplacement ? (
        <DocumentTemplateReplacementDialog
          replacement={pendingTemplateReplacement}
          isSaving={isUploadingTemplate}
          onClose={() => setPendingTemplateReplacement(null)}
          onApply={(constructorConfig) => void savePendingTemplateReplacement(constructorConfig)}
          onReset={() => void handleResetConstructorAndReplace()}
        />
      ) : null}
    </div>
  )
}

function DocumentTemplateReplacementDialog({
  replacement,
  isSaving,
  onClose,
  onApply,
  onReset,
}: {
  replacement: PendingDocumentTemplateReplacement
  isSaving: boolean
  onClose: () => void
  onApply: (constructorConfig: DocumentTemplateConstructorConfig) => void
  onReset: () => void
}) {
  const [sheetName, setSheetName] = useState(
    replacement.analysis.targetSheetName
      ?? replacement.analysis.candidateSheetNames[0]
      ?? '',
  )
  const [rowOffset, setRowOffset] = useState(replacement.analysis.rowOffset)
  const [columnOffset, setColumnOffset] = useState(replacement.analysis.columnOffset)
  const [analysis, setAnalysis] = useState(replacement.analysis)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [mappingDirty, setMappingDirty] = useState(false)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || isSaving) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isSaving, onClose])

  const checkMapping = async () => {
    setIsAnalyzing(true)
    try {
      const nextAnalysis = await analyzeDocumentTemplateReplacement(
        replacement.currentTemplate,
        replacement.parsedTemplate,
        {
          sheetName,
          rowOffset,
          columnOffset,
        },
      )
      setAnalysis(nextAnalysis)
      setMappingDirty(false)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const canApply =
    !isSaving
    && !isAnalyzing
    && !mappingDirty
    && analysis.status !== 'incompatible'
    && Boolean(analysis.constructorConfig)

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[820px]"
      maxHeightClassName="max-h-[90vh]"
      overlayClassName="z-[150] bg-slate-950/35"
      panelRadiusClassName="rounded-lg"
      panelClassName="overflow-hidden"
    >
      <DialogHeader
        title={`Проверить перенос конструктора «${replacement.templateLabel}»`}
        subtitle={`${replacement.currentTemplate.fileName} → ${replacement.parsedTemplate.fileName}`}
        onClose={() => {
          if (!isSaving) onClose()
        }}
      />

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
          Новый Excel пока не активен. Система обнаружила структурные отличия и не будет удалять старый шаблон,
          пока перенос не пройдет проверку или вы явно не выберете сброс конструктора.
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_150px_auto] sm:items-end">
          <label className="space-y-1.5">
            <span className="block text-xs font-semibold uppercase text-slate-500">Лист нового Excel</span>
            <select
              value={sheetName}
              onChange={(event) => {
                setSheetName(event.target.value)
                setMappingDirty(true)
              }}
              className="h-10 w-full rounded-md border-slate-200 bg-white py-1 pl-3 pr-8 text-sm text-slate-800"
            >
              {analysis.candidateSheetNames.map((candidateSheetName) => (
                <option key={candidateSheetName} value={candidateSheetName}>{candidateSheetName}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="block text-xs font-semibold uppercase text-slate-500">Сдвиг строк</span>
            <input
              type="number"
              value={rowOffset}
              onChange={(event) => {
                setRowOffset(Number(event.target.value) || 0)
                setMappingDirty(true)
              }}
              className="h-10 w-full rounded-md border-slate-200 bg-white px-3 text-sm text-slate-800"
            />
          </label>
          <label className="space-y-1.5">
            <span className="block text-xs font-semibold uppercase text-slate-500">Сдвиг столбцов</span>
            <input
              type="number"
              value={columnOffset}
              onChange={(event) => {
                setColumnOffset(Number(event.target.value) || 0)
                setMappingDirty(true)
              }}
              className="h-10 w-full rounded-md border-slate-200 bg-white px-3 text-sm text-slate-800"
            />
          </label>
          <button
            type="button"
            disabled={isAnalyzing || isSaving || !sheetName}
            onClick={() => void checkMapping()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 text-sm font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
            Проверить
          </button>
        </div>

        <div className={`rounded-md border px-4 py-3 ${
          analysis.status === 'incompatible' || mappingDirty
            ? 'border-rose-200 bg-rose-50'
            : 'border-emerald-200 bg-emerald-50'
        }`}>
          <div className={`text-sm font-semibold ${
            analysis.status === 'incompatible' || mappingDirty
              ? 'text-rose-900'
              : 'text-emerald-900'
          }`}>
            {mappingDirty
              ? 'Параметры изменены. Нажмите «Проверить».'
              : analysis.status === 'incompatible'
                ? `Перенесено назначений: ${analysis.retainedBindingCount} из ${analysis.bindingCount}`
                : `Все назначения сохранены: ${analysis.retainedBindingCount} из ${analysis.bindingCount}`}
          </div>
          {!mappingDirty && analysis.issues.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-sm leading-5 text-rose-700">
              {analysis.issues.map((issue) => (
                <li key={`${issue.code}:${issue.message}`}>• {issue.message}</li>
              ))}
            </ul>
          ) : null}
          {!mappingDirty && analysis.status !== 'incompatible' ? (
            <p className="mt-1 text-sm leading-5 text-emerald-700">
              Лист, назначения ячеек, повторяемый блок и объединения совместимы.
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          disabled={isSaving}
          onClick={onReset}
          className="inline-flex items-center justify-center rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          Заменить без настроек
        </button>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={!canApply}
            onClick={() => {
              if (analysis.constructorConfig) onApply(analysis.constructorConfig)
            }}
            className="rounded-md border border-sky-700 bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-200 disabled:text-slate-500"
          >
            {isSaving ? 'Сохраняю...' : 'Перенести и заменить'}
          </button>
        </div>
      </div>
    </LargeDialogShell>
  )
}

function formatTemplateOffset(value: number) {
  if (value > 0) return `+${value}`
  return String(value)
}

function WeldingJournalTemplateOptionsPanel({
  disabled,
  documentLabel,
  options,
  onChange,
}: {
  disabled: boolean
  documentLabel: string
  options: WeldingJournalTemplateOptions
  onChange: (
    optionKey: keyof WeldingJournalTemplateOptions,
    value: WeldingJournalTemplateOptions[keyof WeldingJournalTemplateOptions],
  ) => void
}) {
  return (
    <div className="border-b border-slate-100 px-4 py-4">
      <div className="text-sm font-semibold text-slate-900">Правила формирования: {documentLabel}</div>
      <p className="mt-1 text-sm text-slate-500">
        Эти правила применяются только к документам типа «{documentLabel}».
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
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
        <TemplateOptionCheckbox
          checked={options.actualOnly}
          disabled={disabled}
          label="Учет только актуальных стыков"
          description="Будут исключены строки со значением «не актуален» в поле «Актуальность по ИЗМу». Пустое значение считается актуальным."
          onChange={(checked) => onChange('actualOnly', checked)}
        />
      </div>
      <div className={`mt-3 flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${
        disabled ? 'border-slate-200 bg-slate-50' : 'border-sky-100 bg-sky-50/50'
      }`}>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">Разделение формирования</div>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">
            Определяет, сколько отдельных документов «{documentLabel}» будет создано из выбранных стыков.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600">
          <span>Разделять по</span>
          <select
            value={options.splitMode}
            disabled={disabled}
            onChange={(event) => onChange('splitMode', event.target.value as WeldingJournalTemplateOptions['splitMode'])}
            className="h-9 min-w-36 rounded-md border-slate-200 bg-white py-1 pl-3 pr-8 text-sm font-medium text-slate-800 disabled:bg-slate-100 disabled:text-slate-400"
          >
            {WELDING_JOURNAL_DOCUMENT_SPLIT_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>{mode.label}</option>
            ))}
          </select>
        </label>
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

function TemplateHintLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p>
      <span className="font-medium text-slate-700">{label}:</span> <span className="inline-flex flex-wrap gap-1.5 align-middle">{children}</span>
    </p>
  )
}

function getTemplateMimeType(fileType: string) {
  if (fileType === 'xls') return 'application/vnd.ms-excel'
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

function EmptyTemplateState() {
  return (
    <div className="p-4">
      <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        Шаблон пока не загружен. Подготовьте чистый Excel с нужным оформлением. После загрузки откройте конструктор и укажите, какие
        данные должны попадать в нужные ячейки.
      </div>
    </div>
  )
}

function TemplateUploadPreview({ upload }: { upload: StoredDocumentTemplate }) {
  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <TemplateMetaCard label="Файл" value={upload.fileName} detail={`${upload.fileType.toUpperCase()} · ${formatFileSize(upload.fileSize)}`} />
        <TemplateMetaCard
          label="Листы"
          value={String(upload.sheetNames?.length || 1)}
          detail={upload.sheetNames?.join(', ') || 'основной лист'}
        />
        <TemplateMetaCard
          label="Загружен"
          value={formatStoredTemplateDate(upload.uploadedAt)}
          detail="общий шаблон для всех пользователей"
        />
      </div>

      <div
        className={`rounded-md border px-4 py-3 ${
          upload.constructorConfig?.bindings.length
            ? 'border-emerald-200 bg-emerald-50'
            : 'border-amber-200 bg-amber-50'
        }`}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          {upload.constructorConfig?.bindings.length ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-700" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-700" />
          )}
          {upload.constructorConfig?.bindings.length ? 'Конструктор настроен' : 'Нужно настроить заполнение'}
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          {upload.constructorConfig?.bindings.length
            ? `Лист «${upload.constructorConfig.sheetName}» · назначено ячеек: ${upload.constructorConfig.bindings.length}${
                upload.constructorConfig.repeatRow
                  ? ` · повторяемый блок: ${upload.constructorConfig.repeatRow}${
                      upload.constructorConfig.repeatRowEnd &&
                      upload.constructorConfig.repeatRowEnd !== upload.constructorConfig.repeatRow
                        ? `–${upload.constructorConfig.repeatRowEnd}`
                        : ''
                    }`
                  : ''
              }.`
            : 'Откройте конструктор, выберите повторяемый блок строк и назначьте ячейкам данные системы.'}
        </p>
      </div>
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

function formatStoredTemplateDate(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('ru-RU')
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

type RequestNamingPatternDraftPart = RequestNamingPatternPart & { id: string }

let requestNamingPatternPartCounter = 0

function createRequestNamingPatternDraftParts(pattern: string): RequestNamingPatternDraftPart[] {
  return parseRequestNamingPattern(pattern).map((part) => ({
    ...part,
    id: `request-name-part-${requestNamingPatternPartCounter += 1}`,
  }))
}

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
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {REQUEST_NAMING_CARDS.map((card) => (
          <RequestNamingSettingsCard
            key={card.id}
            kind={card.id}
            title={card.title}
            description={card.description}
            placeholder={card.placeholder}
            settings={settings[card.id]}
            onModeChange={(defaultMode) => updateSettings(card.id, { defaultMode })}
            onPatternSave={(systemPattern) => updateSettings(card.id, { systemPattern })}
          />
        ))}
      </div>
    </div>
  )
}

function RequestNamingSettingsCard({
  kind,
  title,
  description,
  placeholder,
  settings,
  onModeChange,
  onPatternSave,
}: {
  kind: RequestConclusionNamingKind
  title: string
  description: string
  placeholder: string
  settings: RequestConclusionSettings[RequestConclusionNamingKind]
  onModeChange: (mode: RequestNamingState['mode']) => void
  onPatternSave: (pattern: string) => Promise<boolean>
}) {
  const [isPatternExpanded, setIsPatternExpanded] = useState(false)
  const [parts, setParts] = useState<RequestNamingPatternDraftPart[]>(() =>
    createRequestNamingPatternDraftParts(settings.systemPattern),
  )

  useEffect(() => {
    setParts(createRequestNamingPatternDraftParts(settings.systemPattern))
  }, [settings.systemPattern])

  const availableFields = REQUEST_NAMING_PATTERN_FIELDS.filter(
    (field) => field.id !== 'method' || kind === 'lnkConclusion',
  )
  const patternDraft = serializeRequestNamingPattern(parts)
  const hasPattern = patternDraft.trim().length > 0
  const hasNumberField = parts.some((part) => part.type === 'field' && part.field === 'number')
  const hasChanges = patternDraft !== settings.systemPattern
  const preview = buildSystemNameFromPattern(
    hasPattern ? patternDraft : placeholder,
    {
      date: new Date(),
      methodCode: kind === 'lnkConclusion' ? 'РК' : undefined,
      projectTitle: 'Риформинг',
      subtitleCode: '400',
      line: 'LIN-001',
    },
    [],
  )

  function addPart(type: RequestNamingPatternPart['type']) {
    setParts((current) => [
      ...current,
      type === 'field'
        ? {
            id: `request-name-part-${requestNamingPatternPartCounter += 1}`,
            type: 'field',
            field: availableFields[0]?.id ?? 'date',
          }
        : {
            id: `request-name-part-${requestNamingPatternPartCounter += 1}`,
            type: 'text',
            value: '',
          },
    ])
  }

  function updatePart(id: string, patch: Partial<RequestNamingPatternPart>) {
    setParts((current) => current.map((part) => (part.id === id ? { ...part, ...patch } as RequestNamingPatternDraftPart : part)))
  }

  function movePart(index: number, direction: -1 | 1) {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= parts.length) return
    setParts((current) => {
      const next = [...current]
      const [part] = next.splice(index, 1)
      next.splice(targetIndex, 0, part)
      return next
    })
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
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Правило системного имени</div>
        <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Пример имени</div>
            <div className="mt-1 break-words text-sm font-semibold text-slate-900">{preview}</div>
          </div>
          <button
            type="button"
            onClick={() => setIsPatternExpanded((current) => !current)}
            aria-expanded={isPatternExpanded}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-sky-200 bg-white px-2.5 text-xs font-semibold text-sky-700 shadow-sm hover:bg-sky-100"
          >
            {isPatternExpanded ? 'Свернуть' : 'Раскрыть'}
            <ChevronDown className={`h-4 w-4 transition-transform ${isPatternExpanded ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {isPatternExpanded ? (
          <>
            <div className="mt-3 overflow-hidden rounded-md border border-slate-200">
              <div className="grid grid-cols-[2rem_6rem_minmax(0,1fr)_5rem] items-center gap-2 bg-slate-50 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <span>№</span>
                <span>Тип</span>
                <span>Содержимое</span>
                <span className="text-center">Порядок</span>
              </div>
              {parts.length ? (
                parts.map((part, index) => (
                  <div
                    key={part.id}
                    className="grid grid-cols-[2rem_6rem_minmax(0,1fr)_5rem] items-center gap-2 border-t border-slate-200 bg-white px-2 py-2"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded bg-slate-100 text-xs font-semibold text-slate-500">
                      {index + 1}
                    </span>
                  <select
                    value={part.type}
                    onChange={(event) => {
                      const nextType = event.target.value as RequestNamingPatternPart['type']
                      updatePart(
                        part.id,
                        nextType === 'field'
                          ? { type: 'field', field: availableFields[0]?.id ?? 'date' }
                          : { type: 'text', value: '' },
                      )
                    }}
                    className="h-9 min-w-0 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                    aria-label={`Тип части ${index + 1}`}
                  >
                    <option value="field">Поле</option>
                    <option value="text">Текст</option>
                  </select>

                    {part.type === 'field' ? (
                      <select
                        value={part.field}
                        onChange={(event) => updatePart(part.id, { field: event.target.value as RequestNamingPatternField })}
                        className="h-9 min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                        aria-label={`Поле части ${index + 1}`}
                      >
                        {availableFields.map((field) => (
                          <option key={field.id} value={field.id}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={part.value}
                        onChange={(event) => updatePart(part.id, { value: event.target.value })}
                        placeholder="Постоянный текст"
                        className="h-9 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                        aria-label={`Текст части ${index + 1}`}
                      />
                    )}

                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        type="button"
                        title="Поднять"
                        aria-label={`Поднять часть ${index + 1}`}
                        disabled={index === 0}
                        onClick={() => movePart(index, -1)}
                        className="inline-flex h-8 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-200"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="Опустить"
                        aria-label={`Опустить часть ${index + 1}`}
                        disabled={index === parts.length - 1}
                        onClick={() => movePart(index, 1)}
                        className="inline-flex h-8 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-200"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="Удалить"
                        aria-label={`Удалить часть ${index + 1}`}
                        onClick={() => setParts((current) => current.filter((item) => item.id !== part.id))}
                        className="inline-flex h-8 w-7 items-center justify-center rounded text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="border-t border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
                  Добавьте поле или постоянный текст.
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => addPart('field')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-sky-200 bg-white px-3 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                >
                  <Plus className="h-4 w-4" />
                  Добавить поле
                </button>
                <button
                  type="button"
                  onClick={() => addPart('text')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <Plus className="h-4 w-4" />
                  Добавить текст
                </button>
              </div>
              <div className="flex items-center gap-2">
                {hasChanges ? (
                  <button
                    type="button"
                    onClick={() => setParts(createRequestNamingPatternDraftParts(settings.systemPattern))}
                    className="h-9 rounded-md px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  >
                    Отменить
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={!hasPattern || !hasNumberField || !hasChanges}
                  onClick={() => void onPatternSave(patternDraft)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-sky-700 px-3 text-xs font-semibold text-white shadow-sm hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                >
                  <Save className="h-4 w-4" />
                  Сохранить правило
                </button>
              </div>
            </div>
            {!hasNumberField ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                Добавьте поле «Порядковый номер». Без него системные заявки и заключения нельзя создавать:
                после обнуления счётчика документы могли бы получить одинаковые имена.
              </div>
            ) : null}
          </>
        ) : null}
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
  const reminderSettings = useDispatcherReminderSettings()
  const backgroundSettings = useDispatcherBackgroundSettings()
  const [acceptedWarningsExpanded, setAcceptedWarningsExpanded] = useState(true)
  const disabledCount = Object.values(settings).filter((enabled) => !enabled).length
  const totalCount = Object.values(settings).length
  const confirmAction = useConfirmAction()
  const queryClient = useQueryClient()
  const acceptedWarningsQuery = useQuery({
    queryKey: ['dispatcher-accepted-warnings'],
    queryFn: () => listDispatcherAcceptedWarnings(),
  })
  const backgroundStatusQuery = useQuery({
    queryKey: DISPATCHER_BACKGROUND_STATUS_QUERY_KEY,
    queryFn: () => getDispatcherBackgroundStatus(),
    enabled: DISPATCHER_BACKGROUND_REFRESH_ENABLED && backgroundSettings.enabled,
    staleTime: 60_000,
  })
  const refreshBackgroundMutation = useMutation({
    mutationFn: () => refreshDispatcherBackgroundNow(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DISPATCHER_BACKGROUND_STATUS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY }),
        invalidateWeldPageQueries(queryClient),
      ])
    },
  })
  const revokeAcceptedWarningMutation = useMutation({
    mutationFn: (key: string) => revokeDispatcherAcceptedWarning({ data: { key } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dispatcher-accepted-warnings'] }),
        queryClient.invalidateQueries({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: STATISTICS_SERVER_QUERY_KEY }),
        invalidateWeldPageQueries(queryClient),
      ])
    },
  })

  const updateSetting = (id: DispatcherSettingId, enabled: boolean) => {
    runProtectedSettingsChange(() => saveDispatcherSettings({ ...settings, [id]: enabled }))
  }

  const updateReminderDays = (id: DispatcherSettingId, value: number) => {
    if (!isDispatcherReminderSettingId(id)) return Promise.resolve(false)
    return runProtectedSettingsChange(() => saveDispatcherReminderSettings({ ...reminderSettings, [id]: value }))
  }

  const updateGroup = (group: DispatcherSettingGroup, enabled: boolean) => {
    const nextSettings = { ...settings }
    group.items.forEach((item) => {
      nextSettings[item.id] = enabled
    })
    runProtectedSettingsChange(() => saveDispatcherSettings(nextSettings))
  }

  const updateBackgroundSetting = (enabled: boolean) => {
    runProtectedSettingsChange(() => saveDispatcherBackgroundSettings({ enabled }))
  }

  const refreshBackgroundTasks = () => {
    void runProtectedSettingsChange(async () => {
      await refreshBackgroundMutation.mutateAsync()
    })
  }

  const revokeAcceptedWarning = async (key: string, label: string) => {
    const confirmed = await confirmAction({
      title: 'Отменить принятое исключение',
      itemName: label,
      description: 'Если нарушение все еще существует, после пересчета оно снова появится в диспетчере.',
      confirmLabel: 'Отменить исключение',
      tone: 'warning',
    })
    if (!confirmed) return
    await runProtectedSettingsChange(async () => {
      await revokeAcceptedWarningMutation.mutateAsync(key)
    })
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-slate-300 bg-slate-100/80 p-4 shadow-sm shadow-slate-200/60">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
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
          <div className="flex shrink-0 flex-wrap gap-2 sm:flex-nowrap">
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

      <div className="space-y-5">
        {DISPATCHER_SETTING_GROUPS.map((group) => (
          <DispatcherSettingsGroupCard
            key={group.id}
            group={group}
            settings={settings}
            reminderSettings={reminderSettings}
            onItemChange={updateSetting}
            onGroupChange={(enabled) => updateGroup(group, enabled)}
            onReminderDaysChange={updateReminderDays}
          />
        ))}
      </div>

      <section className="rounded-md border border-sky-200 bg-sky-50/60 p-4 shadow-sm shadow-slate-200/40">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <label className={`flex min-w-0 items-start gap-3 ${DISPATCHER_BACKGROUND_REFRESH_ENABLED ? 'cursor-pointer' : 'cursor-default'}`}>
            <input
              type="checkbox"
              checked={backgroundSettings.enabled}
              onChange={(event) => updateBackgroundSetting(event.target.checked)}
              disabled={!DISPATCHER_BACKGROUND_REFRESH_ENABLED}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-900">Показывать коды выключенных проверок в отчетах</span>
              <span className="mt-1 block max-w-4xl text-xs leading-5 text-slate-600">
                {DISPATCHER_BACKGROUND_REFRESH_ENABLED
                  ? 'Выключенные проверки не появятся в диспетчере, счетчике и подсветке строк. Их коды будут доступны только в системном поле «Задачи диспетчера», чтобы находить и постепенно исправлять такие стыки через фильтр.'
                  : backgroundSettings.enabled
                    ? 'Настройка сохранена включенной, но новые фоновые коды временно не рассчитываются. Ранее рассчитанные коды могут оставаться в системном поле «Задачи диспетчера».'
                    : 'Настройка сохранена выключенной. Фоновые коды выключенных проверок не рассчитываются и не показываются в отчетах.'}
              </span>
            </span>
          </label>
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={refreshBackgroundTasks}
            disabled={
              !DISPATCHER_BACKGROUND_REFRESH_ENABLED ||
              !backgroundSettings.enabled ||
              refreshBackgroundMutation.isPending ||
              backgroundStatusQuery.data?.status === 'running'
            }
          >
            <RefreshCw className={`h-4 w-4 ${refreshBackgroundMutation.isPending ? 'animate-spin' : ''}`} />
            Обновить сейчас
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-sky-100 pt-3 text-xs text-slate-600">
          {DISPATCHER_BACKGROUND_REFRESH_ENABLED ? (
            <>
              <span>Автоматически: ежедневно в 03:00 МСК</span>
              <span>
                Последнее обновление: {backgroundStatusQuery.data?.computedAt
                  ? formatSettingsTimestamp(backgroundStatusQuery.data.computedAt)
                  : 'еще не выполнялось'}
              </span>
              {backgroundSettings.enabled && backgroundStatusQuery.data ? (
                <span>Стыков с фоновыми кодами: {backgroundStatusQuery.data.rowCount}</span>
              ) : null}
            </>
          ) : (
            <span className="font-semibold text-amber-700">
              Фоновое обновление временно приостановлено. Обычный диспетчер продолжает работать.
            </span>
          )}
        </div>
        {backgroundStatusQuery.data?.status === 'failed' ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {backgroundStatusQuery.data.lastError || 'Последнее обновление не завершилось.'} Старые рассчитанные коды сохранены;
            повторите обновление позже.
          </div>
        ) : null}
        {refreshBackgroundMutation.isError ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            Не удалось обновить коды. Проверьте соединение и повторите попытку.
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-md border border-slate-300 bg-white shadow-sm shadow-slate-200/60">
        <div className={`flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-3 ${acceptedWarningsExpanded ? 'border-b border-slate-200' : ''}`}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-slate-900">Принятые исключения</h4>
              <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">
                {acceptedWarningsQuery.data?.length ?? 0}
              </span>
            </div>
            <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500">
              Здесь хранятся ситуации, которые пользователь осознанно разрешил кнопкой «Принять». Диспетчер продолжает показывать все остальные
              задачи. Исключение можно отменить в любой момент.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            onClick={() => setAcceptedWarningsExpanded((current) => !current)}
            aria-expanded={acceptedWarningsExpanded}
          >
            {acceptedWarningsExpanded ? 'Свернуть' : 'Развернуть'}
            <ChevronDown className={`h-4 w-4 transition-transform ${acceptedWarningsExpanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {acceptedWarningsExpanded ? (
          acceptedWarningsQuery.isLoading ? (
            <div className="px-4 py-5 text-sm text-slate-500">Загружаем исключения...</div>
          ) : acceptedWarningsQuery.data?.length ? (
            <div className="divide-y divide-slate-100">
              {acceptedWarningsQuery.data.map((warning) => {
                const category = getAcceptedWarningCategory(warning.kind)
                const label = warning.title || category
                const contextParts = getAcceptedWarningContextParts(warning)
                return (
                  <div key={warning.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                      {warning.code || category}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900">{label}</div>
                      {contextParts.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-slate-600">
                          {contextParts.map((part, index) => (
                            <span key={`${part.label}:${part.value}:${index}`}>
                              <span className="font-semibold text-slate-500">{part.label}:</span> {part.value}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-0.5 text-xs text-slate-500">
                        Принято: {formatSettingsTimestamp(warning.acceptedAt)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                      onClick={() => void revokeAcceptedWarning(warning.key, warning.context || label)}
                      disabled={revokeAcceptedWarningMutation.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Отменить
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="px-4 py-5 text-sm text-slate-500">Принятых исключений пока нет.</div>
          )
        ) : null}
      </section>
    </div>
  )
}

function getAcceptedWarningCategory(kind: string) {
  switch (kind) {
    case 'create':
    case 'coil':
    case 'delete':
    case 'rename':
      return 'Цепочка стыков'
    case 'check':
    case 'duplicate-check':
      return 'Проверка стыка'
    case 'line-consistency':
      return 'Проверка линии'
    case 'percentage-line-control':
      return 'Процентная линия'
    case 'welder-stamp-expiry':
      return 'Клеймо и допуски'
    default:
      return 'Исключение'
  }
}

function formatSettingsTimestamp(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
}

function DispatcherSettingsGroupCard({
  group,
  settings,
  reminderSettings,
  onItemChange,
  onGroupChange,
  onReminderDaysChange,
}: {
  group: DispatcherSettingGroup
  settings: DispatcherSettings
  reminderSettings: DispatcherReminderSettings
  onItemChange: (id: DispatcherSettingId, enabled: boolean) => void
  onGroupChange: (enabled: boolean) => void
  onReminderDaysChange: (id: DispatcherReminderSettingId, value: number) => Promise<boolean>
}) {
  const enabledCount = group.items.filter((item) => settings[item.id]).length
  const allEnabled = enabledCount === group.items.length
  const [collapsed, setCollapsed] = useState(false)
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
      <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 hover:bg-slate-50">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start justify-between gap-4 text-left"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
        >
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{group.title}</span>
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-500">
                {enabledCount}/{group.items.length}
              </span>
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">{group.description}</span>
          </span>
          <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-slate-500 transition ${collapsed ? '' : 'rotate-180'}`} />
        </button>
        <button
          type="button"
          className="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          onClick={() => onGroupChange(!allEnabled)}
        >
          {allEnabled ? 'Отключить все' : 'Включить все'}
        </button>
      </div>
      {!collapsed ? <div className="divide-y divide-slate-100">
        {group.items.map((item) => {
          const enabled = settings[item.id]
          const expanded = expandedItemIds.has(item.id)
          const help = DISPATCHER_SETTING_HELP[item.id]
          const actionHelp = DISPATCHER_SETTING_ACTION_HELP[item.id]
          const isReminder = isDispatcherReminderSettingId(item.id)
          const linkedSaveCheckIds = getSaveCheckSettingIdsForDispatcher(item.id)
          return (
            <div key={item.id} className={`px-4 py-3 transition-colors ${expanded ? 'bg-slate-50/80' : 'hover:bg-slate-50/60'}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => onItemChange(item.id, event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={`text-sm font-semibold ${enabled ? 'text-slate-900' : 'text-slate-500'}`}>{item.label}</span>
                      <span className="inline-flex shrink-0 items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                        {getDispatcherSettingCode(item.id)}
                      </span>
                    </span>
                    <span className={`mt-1 block text-sm leading-5 ${enabled ? 'text-slate-600' : 'text-slate-400'}`}>{item.description}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span className={`inline-flex items-center gap-1.5 font-semibold ${enabled ? 'text-emerald-700' : 'text-slate-400'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                        {enabled ? 'Включена' : 'Выключена'}
                      </span>
                      {linkedSaveCheckIds.length > 0 ? (
                        <span className={enabled ? 'text-violet-700' : 'text-slate-400'}>
                          Связанные проверки: {formatLinkedSaveCheckCodes(linkedSaveCheckIds)}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </label>
                <button
                  type="button"
                  className="ml-7 inline-flex h-8 w-28 shrink-0 items-center justify-center gap-1 self-start rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 sm:ml-0"
                  onClick={() => toggleDetails(item.id)}
                  aria-expanded={expanded}
                  aria-controls={`dispatcher-setting-help-${item.id}`}
                >
                  {expanded ? 'Свернуть' : 'Подробнее'}
                  <ChevronDown className={`h-3.5 w-3.5 transition ${expanded ? 'rotate-180' : ''}`} />
                </button>
              </div>
              {isReminder ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 sm:ml-7">
                  <span className="font-semibold text-slate-700">Срок напоминания</span>
                  <span>за</span>
                  <DispatcherReminderDaysInput
                    id={item.id as DispatcherReminderSettingId}
                    value={reminderSettings[item.id as DispatcherReminderSettingId]}
                    onSave={onReminderDaysChange}
                  />
                  <span>дней до окончания, минимум {MIN_DISPATCHER_REMINDER_DAYS} дней</span>
                </div>
              ) : null}
              {expanded ? (
                <dl
                  id={`dispatcher-setting-help-${item.id}`}
                  className="mt-4 rounded-r-md border-y border-l-2 border-sky-200 border-l-sky-400 bg-sky-50/70 px-4 py-3 text-sm leading-6 text-slate-600 sm:ml-7"
                >
                  <div className="grid gap-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
                    <dt className="font-semibold text-slate-800">Тип задачи</dt>
                    <dd>{getDispatcherSettingTaskTypeLabel(item.id)}</dd>
                  </div>
                  <div className="mt-3 grid gap-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
                    <dt className="font-semibold text-slate-800">Смысл</dt>
                    <dd>{help.meaning}</dd>
                  </div>
                  <div className="mt-3 grid gap-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
                    <dt className="font-semibold text-slate-800">Кейс</dt>
                    <dd>{help.example}</dd>
                  </div>
                  {actionHelp.length ? (
                    <div className="mt-3 grid gap-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
                      <dt className="font-semibold text-slate-800">Действия</dt>
                      <dd className="space-y-1">
                        {actionHelp.map((action) => (
                          <div key={action.label}>
                            <span className="font-semibold text-slate-700">{action.label}: </span>
                            {action.description}
                          </div>
                        ))}
                      </dd>
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
                    <dt className="font-semibold text-slate-800">Если выключить</dt>
                    <dd>
                      Этот тип задач перестанет показываться в диспетчере и счетчике. Данные журнала и принятые исключения не изменятся.
                      {linkedSaveCheckIds.length > 0
                        ? ` Связанные проверки ${formatLinkedSaveCheckCodes(linkedSaveCheckIds)} продолжат независимо блокировать некорректное сохранение, пока они включены.`
                        : ''}
                    </dd>
                  </div>
                </dl>
              ) : null}
            </div>
          )
        })}
      </div> : null}
    </div>
  )
}

function DispatcherReminderDaysInput({
  id,
  value,
  onSave,
}: {
  id: DispatcherReminderSettingId
  value: number
  onSave: (id: DispatcherReminderSettingId, value: number) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(() => String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = async () => {
    const normalizedValue = normalizeDispatcherReminderDays(draft, value)
    setDraft(String(normalizedValue))
    if (normalizedValue === value) return

    const saved = await onSave(id, normalizedValue)
    if (!saved) setDraft(String(value))
  }

  return (
    <input
      type="number"
      min={MIN_DISPATCHER_REMINDER_DAYS}
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        void commit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
      }}
      className="h-8 w-20 rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
    />
  )
}

function SaveChecksSettingsPanel({ runProtectedSettingsChange }: { runProtectedSettingsChange: ProtectedSettingsChange }) {
  const settings = useSaveCheckSettings()
  const confirmAction = useConfirmAction()
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set())
  const [expandedItemIds, setExpandedItemIds] = useState<Set<SaveCheckSettingId>>(() => new Set())
  const enabledCount = Object.values(settings).filter(Boolean).length
  const totalCount = Object.values(settings).length

  async function confirmDangerousSaveChecksChange(enabled: boolean) {
    return confirmAction({
      title: 'Вы уверены?',
      itemName: enabled ? 'Включить опасные проверки формы стыка' : 'Отключить опасные проверки формы стыка',
      description:
        'Эти проверки защищают ручное имя обычного стыка, историю контроля и системные имена стыков. Их отключают только в проектах, где заказчик сам ведет нумерацию, контроль и документы, а система используется почти как сварочный журнал.',
      warning: enabled
        ? 'После включения система снова начнет блокировать нарушения этих правил при сохранении формы стыка.'
        : 'После отключения пользователь сможет сохранить данные, которые раньше считались опасными для ручной нумерации, цепочек или истории ЛНК/ПСТО.',
      confirmLabel: enabled ? 'Да, включить' : 'Да, отключить',
      cancelLabel: 'Отмена',
      tone: 'danger',
    })
  }

  async function updateSetting(id: SaveCheckSettingId, enabled: boolean) {
    if (DANGEROUS_SAVE_CHECK_SETTING_IDS.has(id)) {
      const confirmed = await confirmDangerousSaveChecksChange(enabled)
      if (!confirmed) return
    }

    await runProtectedSettingsChange(() => saveSaveCheckSettings({ ...settings, [id]: enabled }))
  }

  async function updateAllSettings(enabled: boolean) {
    const changesDangerousCheck = [...DANGEROUS_SAVE_CHECK_SETTING_IDS].some((id) => settings[id] !== enabled)
    if (changesDangerousCheck) {
      const confirmed = await confirmDangerousSaveChecksChange(enabled)
      if (!confirmed) return
    }

    await runProtectedSettingsChange(() =>
      saveSaveCheckSettings(Object.fromEntries(Object.keys(settings).map((id) => [id, enabled])) as SaveCheckSettings),
    )
  }

  async function updateGroupSettings(groupItems: { id: SaveCheckSettingId }[], enabled: boolean) {
    const groupIds = groupItems.map((item) => item.id)
    const changesDangerousCheck = groupIds.some((id) => DANGEROUS_SAVE_CHECK_SETTING_IDS.has(id) && settings[id] !== enabled)
    if (changesDangerousCheck) {
      const confirmed = await confirmDangerousSaveChecksChange(enabled)
      if (!confirmed) return
    }

    await runProtectedSettingsChange(() => {
      saveSaveCheckSettings({
        ...settings,
        ...Object.fromEntries(groupIds.map((id) => [id, enabled])),
      } as SaveCheckSettings)
    })
  }

  function toggleGroup(groupId: string) {
    setCollapsedGroupIds((current) => {
      const next = new Set(current)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  function toggleDetails(id: SaveCheckSettingId) {
    setExpandedItemIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-slate-300 bg-slate-100/80 p-4 shadow-sm shadow-slate-200/60">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-slate-500" />
              <h3 className="text-base font-semibold text-slate-900">Проверки при сохранении</h3>
            </div>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              Эти правила блокируют некорректное сохранение в форме стыка, результатах ЛНК/ПСТО и соответствующих массовых операциях. Импорт,
              замена и массовое заполнение проверяют итоговую запись после объединения новых и сохраненных данных. Диспетчер настраивается
              отдельно и независимо проверяет уже существующие строки.
            </p>
            <div className="mt-2 text-xs font-semibold text-slate-500">
              Включено: {enabledCount} из {totalCount}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 sm:flex-nowrap">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              onClick={() => {
                void updateAllSettings(true)
              }}
            >
              Включить все
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              onClick={() => {
                void updateAllSettings(false)
              }}
            >
              Отключить все
            </button>
          </div>
        </div>
      </div>

      {SAVE_CHECK_SETTING_GROUPS.map((group) => {
        const collapsed = collapsedGroupIds.has(group.id)
        const groupEnabledCount = group.items.filter((item) => settings[item.id]).length
        const isGroupFullyEnabled = groupEnabledCount === group.items.length
        const isGroupFullyDisabled = groupEnabledCount === 0

        return (
          <section key={group.id} className="rounded-md border border-slate-300 bg-white shadow-sm shadow-slate-200/60">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 hover:bg-slate-50 lg:flex-row lg:items-start lg:justify-between">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-start justify-between gap-4 text-left"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={!collapsed}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{group.title}</span>
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-500">
                      {groupEnabledCount}/{group.items.length}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">{group.description}</span>
                </span>
                <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-slate-500 transition ${collapsed ? '' : 'rotate-180'}`} />
              </button>
              <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                <button
                  type="button"
                  disabled={isGroupFullyEnabled}
                  className="inline-flex items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                  onClick={() => {
                    void updateGroupSettings(group.items, true)
                  }}
                >
                  Включить раздел
                </button>
                <button
                  type="button"
                  disabled={isGroupFullyDisabled}
                  className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                  onClick={() => {
                    void updateGroupSettings(group.items, false)
                  }}
                >
                  Отключить раздел
                </button>
              </div>
            </div>
            {!collapsed ? (
              <div className="divide-y divide-slate-100">
                {group.items.map((item) => {
                  const enabled = settings[item.id]
                  const expanded = expandedItemIds.has(item.id)
                  const help = SAVE_CHECK_SETTING_HELP[item.id]
                  const linkedDispatcherIds = getDispatcherSettingIdsForSaveCheck(item.id)
                  return (
                    <div
                      key={item.id}
                      className={`px-4 py-3 transition-colors ${expanded ? 'bg-slate-50/80' : 'hover:bg-slate-50/60'}`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(event) => {
                              void updateSetting(item.id, event.currentTarget.checked)
                            }}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-500"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className={`text-sm font-semibold ${enabled ? 'text-slate-900' : 'text-slate-500'}`}>{item.label}</span>
                              <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                                {getSaveCheckSettingCode(item.id)}
                              </span>
                            </span>
                            <span className={`mt-1 block text-sm leading-5 ${enabled ? 'text-slate-600' : 'text-slate-400'}`}>{item.description}</span>
                            <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                              <span className={`inline-flex items-center gap-1.5 font-semibold ${enabled ? 'text-emerald-700' : 'text-slate-400'}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                {enabled ? 'Включена' : 'Выключена'}
                              </span>
                              {linkedDispatcherIds.length > 0 ? (
                                <span className={enabled ? 'text-violet-700' : 'text-slate-400'}>
                                  Связанные задачи: {linkedDispatcherIds.map(getDispatcherSettingCode).join(', ')}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </label>
                        <button
                          type="button"
                          className="ml-7 inline-flex h-8 w-28 shrink-0 items-center justify-center gap-1 self-start rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 sm:ml-0"
                          onClick={() => toggleDetails(item.id)}
                          aria-expanded={expanded}
                          aria-controls={`save-check-help-${item.id}`}
                        >
                          {expanded ? 'Свернуть' : 'Подробнее'}
                          <ChevronDown className={`h-3.5 w-3.5 transition ${expanded ? 'rotate-180' : ''}`} />
                        </button>
                      </div>
                      {expanded ? (
                        <dl
                          id={`save-check-help-${item.id}`}
                          className="mt-4 rounded-r-md border-y border-l-2 border-sky-200 border-l-sky-400 bg-sky-50/70 px-4 py-3 text-sm leading-6 text-slate-600 sm:ml-7"
                        >
                          <div className="grid gap-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
                            <dt className="font-semibold text-slate-800">Смысл</dt>
                            <dd>{help.meaning}</dd>
                          </div>
                          <div className="mt-3 grid gap-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
                            <dt className="font-semibold text-slate-800">Кейс</dt>
                            <dd>{help.example}</dd>
                          </div>
                          <div className="mt-3 grid gap-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
                            <dt className="font-semibold text-slate-800">Если выключить</dt>
                            <dd>
                              Эта причина перестанет блокировать сохранение в тех операциях, где применяется ЗВ.
                              {linkedDispatcherIds.length > 0
                                ? ` Связанные задачи ${linkedDispatcherIds.map(getDispatcherSettingCode).join(', ')} продолжат независимо проверять уже сохраненные данные, пока они включены в диспетчере.`
                                : ' Автоматические системные расчеты и остальные включенные проверки продолжат работать.'}
                            </dd>
                          </div>
                        </dl>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

function formatLinkedSaveCheckCodes(ids: SaveCheckSettingId[]) {
  const codes = ids.map(getSaveCheckSettingCode)
  if (codes.length === 0) return ''
  const numbers = codes.map((code) => Number(code.match(/\d+/)?.[0] ?? Number.NaN))
  const isContinuous = numbers.every((value, index) => index === 0 || value === numbers[index - 1] + 1)
  if (codes.length > 2 && isContinuous) {
    return `${codes[0]}…${codes.at(-1)}`
  }
  return codes.join(', ')
}
