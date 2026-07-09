import { type ChangeEvent, useEffect, useState } from 'react'
import { AlertTriangle, Bell, CheckCircle2, FileText, Hash, Inbox, SlidersHorizontal, Trash2, Upload } from 'lucide-react'
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

const SETTINGS_TABS = [
  { id: 'templates', label: 'Шаблоны документов', icon: FileText },
  { id: 'requests', label: 'Заявки и заключения', icon: Inbox },
  { id: 'indexes', label: 'Системные индексы', icon: Hash },
  { id: 'dispatcher', label: 'Диспетчер задач и напоминаний', icon: Bell },
  { id: 'other', label: 'Прочее', icon: SlidersHorizontal },
] as const

type SettingsTabId = (typeof SETTINGS_TABS)[number]['id']

const SETTINGS_PLACEHOLDERS: Record<Exclude<SettingsTabId, 'templates'>, string> = {
  requests: 'Здесь позже настроим правила для заявок и заключений.',
  indexes: 'Здесь позже настроим системные индексы цепочек и повторных стыков.',
  dispatcher: 'Здесь позже настроим поведение диспетчера задач и напоминаний.',
  other: 'Здесь позже соберем остальные системные параметры.',
}

export function SettingsPage() {
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
          {activeTab === 'templates' ? <DocumentTemplatesSettings /> : <SettingsPlaceholder tab={activeTab} />}
        </div>
      </section>
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

function SettingsPlaceholder({ tab }: { tab: Exclude<SettingsTabId, 'templates'> }) {
  const activeTab = SETTINGS_TABS.find((item) => item.id === tab)
  const Icon = activeTab?.icon ?? SlidersHorizontal

  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-5">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-slate-500" />
        <h3 className="text-base font-semibold text-slate-900">{activeTab?.label}</h3>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{SETTINGS_PLACEHOLDERS[tab]}</p>
    </div>
  )
}
