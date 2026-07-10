import { type ChangeEvent, useEffect, useState } from 'react'
import { AlertTriangle, Bell, CheckCircle2, ChevronDown, FileText, Hash, Inbox, Pencil, SlidersHorizontal, Trash2, Upload } from 'lucide-react'
import {
  deleteDocumentTemplate,
  DEFAULT_WELDING_JOURNAL_TEMPLATE_OPTIONS,
  DOCUMENT_TEMPLATE_TYPES,
  formatFileSize,
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
import { saveOtherSettings, useOtherSettings } from '@/lib/other-settings'

const SETTINGS_TABS = [
  { id: 'templates', label: 'Шаблоны документов', icon: FileText },
  { id: 'requests', label: 'Заявки и заключения', icon: Inbox },
  { id: 'indexes', label: 'Системные индексы', icon: Hash },
  { id: 'dispatcher', label: 'Диспетчер задач и напоминаний', icon: Bell },
  { id: 'other', label: 'Прочее', icon: SlidersHorizontal },
] as const

type SettingsTabId = (typeof SETTINGS_TABS)[number]['id']

export function SettingsPage({ rowsCount = 0 }: { rowsCount?: number }) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('templates')

  return (
    <div className="space-y-5">
      <section className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
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

        <div className="p-5">
          {activeTab === 'templates' ? (
            <DocumentTemplatesSettings />
          ) : activeTab === 'requests' ? (
            <RequestConclusionSettingsPanel />
          ) : activeTab === 'indexes' ? (
            <SystemIndexesSettingsPanel rowsCount={rowsCount} />
          ) : activeTab === 'dispatcher' ? (
            <DispatcherSettingsPanel />
          ) : (
            <OtherSettingsPanel />
          )}
        </div>
      </section>
    </div>
  )
}

function OtherSettingsPanel() {
  const settings = useOtherSettings()

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-slate-500" />
          <h3 className="text-base font-semibold text-slate-900">Прочее</h3>
        </div>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
          Дополнительные параметры, которые меняют поведение рабочих форм без изменения данных журнала.
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white p-4 hover:bg-slate-50">
        <input
          type="checkbox"
          checked={settings.includeArchivedWelderStampsInForm}
          onChange={(event) =>
            saveOtherSettings({
              ...settings,
              includeArchivedWelderStampsInForm: event.target.checked,
            })
          }
          className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-500"
        />
        <span>
          <span className="block text-sm font-semibold text-slate-900">Учитывать архив клейм в форме стыка</span>
          <span className="mt-1 block text-sm leading-5 text-slate-500">
            Архивные клейма будут доступны в выпадающих списках при создании и редактировании стыков.
          </span>
        </span>
      </label>
    </div>
  )
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

function SystemIndexesSettingsPanel({ rowsCount }: { rowsCount: number }) {
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

  const resetDraft = () => setDraft(DEFAULT_SYSTEM_INDEX_SETTINGS)

  const saveDraft = () => {
    if (!canEdit || validationError) return
    saveSystemIndexSettings(draft)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
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

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
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

function DocumentTemplatesSettings() {
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
  }

  const handleWeldingJournalOptionChange = async (optionKey: keyof WeldingJournalTemplateOptions, checked: boolean) => {
    if (!activeUpload || activeTemplateId !== 'weldingJournal') return

    const nextOptions = {
      ...weldingJournalOptions,
      [optionKey]: checked,
    }
    const savedTemplate = await updateDocumentTemplateOptions('weldingJournal', { weldingJournal: nextOptions })
    if (!savedTemplate) return
    setUploads((currentUploads) => ({
      ...currentUploads,
      weldingJournal: savedTemplate,
    }))
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-slate-500" />
              <h3 className="text-base font-semibold text-slate-900">Шаблоны документов</h3>
            </div>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              Загружайте шаблон под конкретный тип документа. В Excel используйте маркеры вида <TemplateToken>Линия</TemplateToken>.
              В одной ячейке можно указать несколько маркеров, например <TemplateToken>Линия</TemplateToken> и{' '}
              <TemplateToken>Контроль швов, (%)</TemplateToken> на разных строках одной ячейки.
            </p>
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

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="rounded-md border border-slate-200 bg-white p-2">
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

        <div className="rounded-md border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-500" />
                <h4 className="text-base font-semibold text-slate-900">{activeTemplate.label}</h4>
              </div>
              <p className="mt-1 text-sm text-slate-500">{activeTemplate.description}</p>
            </div>
            {activeUpload ? (
              <button
                type="button"
                onClick={async () => {
                  await deleteDocumentTemplate(activeTemplateId)
                  setUploads((currentUploads) => {
                    const nextUploads = { ...currentUploads }
                    delete nextUploads[activeTemplateId]
                    return nextUploads
                  })
                }}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
              >
                <Trash2 className="h-4 w-4" />
                Удалить шаблон
              </button>
            ) : null}
          </div>

          <div className="space-y-4">
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
  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <TemplateMetaCard label="Файл" value={upload.fileName} detail={`${upload.fileType.toUpperCase()} · ${formatFileSize(upload.fileSize)}`} />
        <TemplateMetaCard label="Найдено маркеров" value={String(upload.markerCount)} detail={`уникальных полей: ${upload.fields.length}`} />
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
        {upload.fields.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {upload.fields.map((field) => (
              <span key={field} className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800">
                {field}
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-sm text-slate-500">Пока не найдено ни одного маркера вида {'{{Поле}}'}.</div>
        )}
      </div>

      {upload.locations.length ? (
        <div className="overflow-hidden rounded-md border border-slate-200">
          <div className="grid grid-cols-[130px_90px_1fr] bg-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <div>Лист</div>
            <div>Ячейка</div>
            <div>Маркеры</div>
          </div>
          <div className="max-h-72 overflow-auto">
            {upload.locations.map((location, index) => (
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

function RequestConclusionSettingsPanel() {
  const settings = useRequestConclusionSettings()

  const updateSettings = (
    kind: RequestConclusionNamingKind,
    patch: Partial<RequestConclusionSettings[RequestConclusionNamingKind]>,
  ) => {
    saveRequestConclusionSettings({
      ...settings,
      [kind]: {
        ...settings[kind],
        ...patch,
      },
    })
  }

  const resetSettings = () => saveRequestConclusionSettings(REQUEST_CONCLUSION_DEFAULT_SETTINGS)

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
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

      <div className="grid gap-4 xl:grid-cols-2">
        {REQUEST_NAMING_CARDS.map((card) => (
          <RequestNamingSettingsCard
            key={card.id}
            title={card.title}
            description={card.description}
            placeholder={card.placeholder}
            settings={settings[card.id]}
            showMethodHint={card.id === 'lnkConclusion'}
            onModeChange={(defaultMode) => updateSettings(card.id, { defaultMode })}
            onPatternChange={(systemPattern) => updateSettings(card.id, { systemPattern })}
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
  onPatternChange,
}: {
  title: string
  description: string
  placeholder: string
  settings: RequestConclusionSettings[RequestConclusionNamingKind]
  showMethodHint: boolean
  onModeChange: (mode: RequestNamingState['mode']) => void
  onPatternChange: (pattern: string) => void
}) {
  const [isEditingPattern, setIsEditingPattern] = useState(false)

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
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
            onClick={() => setIsEditingPattern((isEditing) => !isEditing)}
          >
            <Pencil className="h-3.5 w-3.5" />
            {isEditingPattern ? 'Готово' : 'Изменить'}
          </button>
        </div>
        {isEditingPattern ? (
          <input
            type="text"
            value={settings.systemPattern}
            onChange={(event) => onPatternChange(event.target.value)}
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

function DispatcherSettingsPanel() {
  const settings = useDispatcherSettings()
  const disabledCount = Object.values(settings).filter((enabled) => !enabled).length
  const totalCount = Object.values(settings).length

  const updateSetting = (id: DispatcherSettingId, enabled: boolean) => {
    saveDispatcherSettings({ ...settings, [id]: enabled })
  }

  const updateGroup = (group: DispatcherSettingGroup, enabled: boolean) => {
    const nextSettings = { ...settings }
    group.items.forEach((item) => {
      nextSettings[item.id] = enabled
    })
    saveDispatcherSettings(nextSettings)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
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
              onClick={() => saveDispatcherSettings(DEFAULT_DISPATCHER_SETTINGS)}
            >
              Включить все
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              onClick={() => {
                const nextSettings = Object.fromEntries(Object.keys(DEFAULT_DISPATCHER_SETTINGS).map((id) => [id, false])) as DispatcherSettings
                saveDispatcherSettings(nextSettings)
              }}
            >
              Отключить все
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
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
    <div className="rounded-md border border-slate-200 bg-white">
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
