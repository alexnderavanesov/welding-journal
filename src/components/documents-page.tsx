import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Rows3,
  Search,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { ContextActionMenu, type ContextActionMenuState } from '@/components/context-action-menu'
import { Button } from '@/components/ui/button'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { useSecurityGuard } from '@/lib/security-context'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  DOCUMENT_TEMPLATE_TYPES,
  DOCUMENT_TEMPLATE_STORAGE_EVENT,
  createWeldingJournalDocumentPreview,
  getWeldingJournalTemplateOptions,
  type DocumentTemplateId,
  loadDocumentTemplate,
  type DocumentTemplateWorkbookPreview,
  type StoredDocumentTemplate,
} from '@/lib/document-template-storage'
import {
  deleteGeneratedDocument,
  downloadGeneratedDocument,
  GENERATED_DOCUMENT_STORAGE_EVENT,
  loadGeneratedDocumentRows,
  loadGeneratedDocuments,
  openGeneratedDocument,
  type StoredGeneratedDocument,
} from '@/lib/generated-document-storage'
import { previewGeneratedDocumentNamePattern } from '@/lib/generated-document-naming'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import { createCurrentGeneratedDocumentBlob } from '@/lib/welding-journal-document'
import {
  WELDING_JOURNAL_DOCUMENT_SPLIT_MODES,
} from '@/lib/welding-journal-document-splitting'
import {
  isGeneratedDocumentType,
  type GeneratedDocumentType,
} from '@/lib/generated-document-types'
import {
  buildWeldingJournalGenerationPlan,
  ensureWeldingJournalXlsxFileName,
  formatWeldingJournalGenerationSuccess,
  prepareWeldingJournalDocumentRows,
  saveWeldingJournalGenerationPlan,
} from '@/lib/welding-journal-generation'
import {
  downloadSystemDocument,
  loadSystemDocuments,
  openSystemDocument,
} from '@/lib/system-document-storage'
import {
  getSystemDocumentProfile,
  isSystemDocumentType,
  type SystemDocumentSummary,
} from '@/lib/system-document-types'
import { WELD_JOINTS_QUERY_KEY } from '@/lib/weld-query-utils'
import { getDocumentGenerationData } from '@/server/welds'

type DocumentsPageProps = {
  welderStamps: WelderStampRecord[]
  onOpenDocumentRows?: (rowIds: number[], documentTitle: string) => void
}

const DOCUMENT_PREVIEW_ROW_LIMIT = 3
const DOCUMENT_PREVIEW_SCALE = 1.2
const DOCUMENT_PREVIEW_MIN_SCALE = 0.45
const DOCUMENT_PREVIEW_MAX_SCALE = 1.8
const DOCUMENT_PREVIEW_SCALE_STEP = 0.15
const DOCUMENT_PARAMETERS_COLLAPSED_STORAGE_KEY = 'welding-journal:documents:parameters-collapsed'

const DOCUMENT_TYPE_OPTIONS: Array<{
  type: GeneratedDocumentType
  label: string
  title: string
  description: string
}> = [
  {
    type: 'weldingJournal',
    label: 'ЖСР',
    title: 'Формирование ЖСР',
    description: 'Выберите период и состав стыков, затем сформируйте актуальный ЖСР.',
  },
  {
    type: 'checklist',
    label: 'Чек-лист',
    title: 'Формирование Чек-листа',
    description: 'Выберите период и состав стыков, затем сформируйте актуальный Чек-лист.',
  },
  {
    type: 'zni',
    label: 'ЗНИ',
    title: 'Формирование ЗНИ',
    description: 'Выберите период и состав стыков, затем сформируйте актуальный запрос на инспекцию.',
  },
]

const SYSTEM_DOCUMENT_TYPE_OPTIONS = DOCUMENT_TEMPLATE_TYPES.filter(
  (templateType) => !DOCUMENT_TYPE_OPTIONS.some((option) => option.type === templateType.id),
)

function toInputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getCurrentMonthRange() {
  const now = new Date()
  return {
    from: toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toInputDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  }
}

function parseDate(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]))
  }

  const displayMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (displayMatch) {
    return new Date(Number(displayMatch[3]), Number(displayMatch[2]) - 1, Number(displayMatch[1]))
  }

  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDate(value: unknown) {
  const parsed = parseDate(value)
  if (!parsed) return String(value ?? '').trim()
  return `${String(parsed.getDate()).padStart(2, '0')}.${String(parsed.getMonth() + 1).padStart(2, '0')}.${parsed.getFullYear()}`
}

function getCellValue(row: WeldRow, key: string) {
  const value = (row as Record<string, unknown>)[key]
  if (key.toLowerCase().includes('date')) return formatDate(value)
  return value == null || value === '' ? '-' : String(value)
}

function getTextValue(value: unknown) {
  return String(value ?? '').trim()
}

export function DocumentsPage({
  welderStamps,
  onOpenDocumentRows,
}: DocumentsPageProps) {
  const queryClient = useQueryClient()
  const { requireDocumentGenerationPassword } = useSecurityGuard()
  const initialRange = useMemo(() => getCurrentMonthRange(), [])
  const [periodFrom, setPeriodFrom] = useState(initialRange.from)
  const [periodTo, setPeriodTo] = useState(initialRange.to)
  const [selectedProjects, setSelectedProjects] = useState<string[]>([])
  const [selectedSubtitles, setSelectedSubtitles] = useState<string[]>([])
  const [selectedLines, setSelectedLines] = useState<string[]>([])
  const [manualFileName, setManualFileName] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [activeDocumentType, setActiveDocumentType] = useState<DocumentTemplateId>('weldingJournal')
  const [activeDocumentTemplate, setActiveDocumentTemplate] = useState<StoredDocumentTemplate | null>(null)
  const [templateDocumentPreview, setTemplateDocumentPreview] = useState<DocumentTemplateWorkbookPreview | null>(null)
  const [templatePreviewError, setTemplatePreviewError] = useState<string | null>(null)
  const [isTemplatePreviewLoading, setIsTemplatePreviewLoading] = useState(false)
  const [generatedDocuments, setGeneratedDocuments] = useState<StoredGeneratedDocument[]>([])
  const [systemDocuments, setSystemDocuments] = useState<SystemDocumentSummary[]>([])
  const [systemDocumentsError, setSystemDocumentsError] = useState<string | null>(null)
  const [isSystemDocumentsLoading, setIsSystemDocumentsLoading] = useState(false)
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<'history' | 'generation'>('history')
  const [isParametersCollapsed, setIsParametersCollapsed] = useState(false)
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false)
  const [previewScale, setPreviewScale] = useState(DOCUMENT_PREVIEW_SCALE)
  const previewViewportRef = useRef<HTMLDivElement>(null)
  const [generationNotice, setGenerationNotice] = useState<{
    tone: 'success' | 'error'
    text: string
  } | null>(null)
  const isSystemDocument = isSystemDocumentType(activeDocumentType)
  const activeGeneratedDocumentType: GeneratedDocumentType = isGeneratedDocumentType(activeDocumentType)
    ? activeDocumentType
    : 'weldingJournal'
  const activeDocumentProfile =
    DOCUMENT_TYPE_OPTIONS.find((option) => option.type === activeGeneratedDocumentType) ?? DOCUMENT_TYPE_OPTIONS[0]
  const activeDocumentOptions = useMemo(
    () =>
      getWeldingJournalTemplateOptions(
        activeDocumentTemplate?.options?.[activeGeneratedDocumentType],
      ),
    [
      activeDocumentTemplate?.options?.checklist,
      activeDocumentTemplate?.options?.weldingJournal,
      activeDocumentTemplate?.options?.zni,
      activeGeneratedDocumentType,
    ],
  )
  const generationDataRequest = useMemo(
    () => ({
      periodFrom,
      periodTo,
      projects: selectedProjects,
      subtitles: selectedSubtitles,
      lines: selectedLines,
    }),
    [periodFrom, periodTo, selectedLines, selectedProjects, selectedSubtitles],
  )
  const generationDataQuery = useQuery({
    queryKey: [...WELD_JOINTS_QUERY_KEY, 'document-generation', generationDataRequest],
    queryFn: () => getDocumentGenerationData({ data: generationDataRequest }),
    enabled: !isSystemDocument,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  })
  const rows = generationDataQuery.data?.rows ?? []

  useEffect(() => {
    try {
      setIsParametersCollapsed(
        window.localStorage.getItem(DOCUMENT_PARAMETERS_COLLAPSED_STORAGE_KEY) === 'true',
      )
    } catch {
      // Local storage may be unavailable in a restricted browser mode.
    }
  }, [])

  useEffect(() => {
    if (!isPreviewFullscreen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPreviewFullscreen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPreviewFullscreen])

  const scopeOptions = generationDataQuery.data?.scopeOptions ?? {
    projects: [],
    subtitles: [],
    lines: [],
  }

  useEffect(() => {
    let isMounted = true
    const syncTemplate = () => {
      loadDocumentTemplate(activeDocumentType)
        .then((template) => {
          if (isMounted) setActiveDocumentTemplate(template ?? null)
        })
        .catch(() => {
          if (isMounted) setActiveDocumentTemplate(null)
        })
    }

    syncTemplate()
    window.addEventListener(DOCUMENT_TEMPLATE_STORAGE_EVENT, syncTemplate)
    return () => {
      isMounted = false
      window.removeEventListener(DOCUMENT_TEMPLATE_STORAGE_EVENT, syncTemplate)
    }
  }, [activeDocumentType])

  useEffect(() => {
    let isMounted = true
    if (!isSystemDocument || !activeDocumentTemplate) {
      setSystemDocuments([])
      setSystemDocumentsError(null)
      setIsSystemDocumentsLoading(false)
      return () => {
        isMounted = false
      }
    }

    setIsSystemDocumentsLoading(true)
    setSystemDocumentsError(null)
    loadSystemDocuments(activeDocumentType)
      .then((documents) => {
        if (isMounted) setSystemDocuments(documents)
      })
      .catch((error) => {
        if (!isMounted) return
        setSystemDocuments([])
        setSystemDocumentsError(
          error instanceof Error ? error.message : 'Не удалось загрузить системные документы.',
        )
      })
      .finally(() => {
        if (isMounted) setIsSystemDocumentsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [activeDocumentTemplate, activeDocumentType, isSystemDocument])

  useEffect(() => {
    let isMounted = true
    const syncGeneratedDocuments = () => {
      loadGeneratedDocuments()
        .then((documents) => {
          if (isMounted) setGeneratedDocuments(documents)
        })
        .catch(() => {
          if (isMounted) setGeneratedDocuments([])
        })
    }
    const handleGeneratedDocumentChange = () => {
      syncGeneratedDocuments()
      void queryClient.invalidateQueries({
        queryKey: [...WELD_JOINTS_QUERY_KEY, 'document-generation'],
      })
    }

    syncGeneratedDocuments()
    window.addEventListener(GENERATED_DOCUMENT_STORAGE_EVENT, handleGeneratedDocumentChange)
    return () => {
      isMounted = false
      window.removeEventListener(GENERATED_DOCUMENT_STORAGE_EVENT, handleGeneratedDocumentChange)
    }
  }, [queryClient])

  useEffect(() => {
    if (!generationNotice) return
    const timeoutId = window.setTimeout(() => setGenerationNotice(null), 4500)
    return () => window.clearTimeout(timeoutId)
  }, [generationNotice])

  const journalRows = useMemo(
    () => {
      if (isSystemDocument) return []
      return prepareWeldingJournalDocumentRows({
        sourceRows: rows,
        contextRows: rows,
        periodFrom,
        periodTo,
        options: activeDocumentOptions,
        filters: {
          projects: selectedProjects,
          subtitles: selectedSubtitles,
          lines: selectedLines,
        },
      })
    },
    [
      isSystemDocument,
      periodFrom,
      periodTo,
      rows,
      selectedLines,
      selectedProjects,
      selectedSubtitles,
      activeDocumentOptions,
    ],
  )

  const generationPlan = useMemo(
    () =>
      buildWeldingJournalGenerationPlan({
        type: activeGeneratedDocumentType,
        documentLabel: activeDocumentProfile.label,
        rows: journalRows,
        template: activeDocumentTemplate,
        options: activeDocumentOptions,
        periodFrom,
        periodTo,
        manualTitle: manualFileName,
      }),
    [
      journalRows,
      manualFileName,
      periodFrom,
      periodTo,
      activeDocumentOptions,
      activeDocumentProfile.label,
      activeDocumentTemplate,
      activeGeneratedDocumentType,
    ],
  )
  const journalDocumentGroups = generationPlan.groups
  const documentTitles = generationPlan.titles.map((title) => previewGeneratedDocumentNamePattern(title))
  const firstDocumentTitle = documentTitles[0] ?? activeDocumentProfile.label
  const splitModeLabel =
    WELDING_JOURNAL_DOCUMENT_SPLIT_MODES.find((mode) => mode.value === activeDocumentOptions.splitMode)?.label ??
    'Проект'

  const previewRows = useMemo(
    () => journalRows.slice(0, DOCUMENT_PREVIEW_ROW_LIMIT),
    [journalRows],
  )
  const wdiTotal = journalRows.reduce((sum, row) => sum + (Number(row.wdi) || 0), 0)

  useEffect(() => {
    let isActive = true
    if (isSystemDocument || !activeDocumentTemplate || previewRows.length === 0) {
      setTemplateDocumentPreview(null)
      setTemplatePreviewError(null)
      setIsTemplatePreviewLoading(false)
      return () => {
        isActive = false
      }
    }

    setIsTemplatePreviewLoading(true)
    setTemplatePreviewError(null)
    createWeldingJournalDocumentPreview(activeDocumentTemplate, previewRows, { welderStamps })
      .then((preview) => {
        if (isActive) setTemplateDocumentPreview(preview)
      })
      .catch((error) => {
        if (!isActive) return
        setTemplateDocumentPreview(null)
        setTemplatePreviewError(error instanceof Error ? error.message : 'Не удалось сформировать предпросмотр документа.')
      })
      .finally(() => {
        if (isActive) setIsTemplatePreviewLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [activeDocumentTemplate, isSystemDocument, previewRows, welderStamps])

  const handleGenerateDocuments = async () => {
    if (journalDocumentGroups.length === 0 || isGenerating) return
    setIsGenerating(true)
    const accessGranted = await requireDocumentGenerationPassword(
      `формирование ${activeDocumentProfile.label}`,
    )
    if (!accessGranted) {
      setIsGenerating(false)
      return
    }
    setGenerationNotice(null)
    try {
      const savedDocuments = await saveWeldingJournalGenerationPlan(generationPlan)
      setGenerationNotice({
        tone: 'success',
        text: formatWeldingJournalGenerationSuccess(
          savedDocuments,
          firstDocumentTitle,
          activeDocumentProfile.label,
        ),
      })
    } catch (error) {
      setGenerationNotice({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : `Не удалось сформировать ${activeDocumentProfile.label}.`,
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const changePreviewScale = (delta: number) => {
    setPreviewScale((current) =>
      Math.min(
        DOCUMENT_PREVIEW_MAX_SCALE,
        Math.max(DOCUMENT_PREVIEW_MIN_SCALE, Number((current + delta).toFixed(2))),
      ),
    )
  }

  const changeParametersCollapsed = (collapsed: boolean) => {
    setIsParametersCollapsed(collapsed)
    try {
      window.localStorage.setItem(DOCUMENT_PARAMETERS_COLLAPSED_STORAGE_KEY, String(collapsed))
    } catch {
      // The current view still works when local storage is unavailable.
    }
  }

  const fitPreviewToWidth = () => {
    const viewportWidth = previewViewportRef.current?.clientWidth ?? 0
    const sheetWidth =
      templateDocumentPreview?.columnWidths.reduce((sum, width) => sum + Math.max(width, 1), 0) ?? 0
    if (viewportWidth <= 0 || sheetWidth <= 0) return
    setPreviewScale(
      Math.min(
        DOCUMENT_PREVIEW_MAX_SCALE,
        Math.max(DOCUMENT_PREVIEW_MIN_SCALE, Number(((viewportWidth - 28) / sheetWidth).toFixed(2))),
      ),
    )
  }

  return (
    <div className="w-full min-w-0 space-y-5 overflow-x-hidden">
      <div className="min-w-0 rounded-md border border-[#cfdee6] bg-[#f4f8fa] p-4">
        <div className="flex flex-wrap items-center gap-2">
          {DOCUMENT_TYPE_OPTIONS.map((option) => {
            const isActive = activeDocumentType === option.type
            return (
              <button
                key={option.type}
                type="button"
                onClick={() => {
                  setActiveDocumentType(option.type)
                  setManualFileName('')
                  setTemplateDocumentPreview(null)
                  setTemplatePreviewError(null)
                }}
                className={`rounded-md border px-4 py-2 text-sm font-semibold shadow-sm transition ${
                  isActive
                    ? 'border-[#17627d] bg-[#17627d] text-white'
                    : 'border-[#cbdde6] bg-white text-[#31566a] hover:border-[#79aebe] hover:bg-[#edf7fa]'
                }`}
              >
                {option.label}
              </button>
            )
          })}
          {SYSTEM_DOCUMENT_TYPE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setActiveDocumentType(option.id)
                setActiveWorkspaceTab('history')
                setTemplateDocumentPreview(null)
                setTemplatePreviewError(null)
              }}
              className={`rounded-md border px-4 py-2 text-sm font-semibold shadow-sm transition ${
                activeDocumentType === option.id
                  ? 'border-[#17627d] bg-[#17627d] text-white'
                  : 'border-[#cbdde6] bg-white text-[#31566a] hover:border-[#79aebe] hover:bg-[#edf7fa]'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="flex min-w-0 items-center gap-1 rounded-md border border-[#c8dbe4] bg-[#eaf3f6] p-1"
        role="tablist"
        aria-label="Раздел документов"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeWorkspaceTab === 'history'}
          onClick={() => setActiveWorkspaceTab('history')}
          className={`inline-flex h-10 min-w-36 items-center justify-center gap-2 rounded px-4 text-sm font-semibold transition ${
            activeWorkspaceTab === 'history'
              ? 'bg-[#17627d] text-white shadow-sm'
              : 'text-slate-600 hover:bg-white hover:text-[#17627d]'
          }`}
        >
          <FileText className="h-4 w-4" />
          История
          <span className={`rounded px-1.5 py-0.5 text-[11px] ${
            activeWorkspaceTab === 'history' ? 'bg-white/20 text-white' : 'bg-white text-slate-500'
          }`}>
            {isSystemDocument
              ? systemDocuments.length
              : generatedDocuments.filter((documentRecord) => documentRecord.type === activeGeneratedDocumentType).length}
          </span>
        </button>
        {!isSystemDocument ? (
          <button
          type="button"
          role="tab"
          aria-selected={activeWorkspaceTab === 'generation'}
          onClick={() => setActiveWorkspaceTab('generation')}
          className={`inline-flex h-10 min-w-36 items-center justify-center gap-2 rounded px-4 text-sm font-semibold transition ${
            activeWorkspaceTab === 'generation'
              ? 'bg-[#17627d] text-white shadow-sm'
              : 'text-slate-600 hover:bg-white hover:text-[#17627d]'
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          Формирование
          </button>
        ) : null}
      </div>

      {!isSystemDocument && activeWorkspaceTab === 'generation' ? (
      <section className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="grid min-w-0 border-b border-slate-200 bg-slate-50/50 xl:grid-cols-[minmax(0,1fr)_minmax(460px,0.72fr)]">
          <div className="min-w-0 px-4 py-3.5">
            <div className="flex max-w-full items-start gap-2 text-left">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500">
                <FileSpreadsheet className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-base font-semibold leading-6 text-slate-900">{activeDocumentProfile.title}</span>
                <span className="mt-0.5 block max-w-3xl text-xs leading-5 text-slate-500">
                  {activeDocumentProfile.description}
                </span>
              </span>
            </div>
            <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-1.5 pl-8">
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
                {activeDocumentTemplate ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="truncate">
                  {activeDocumentTemplate ? activeDocumentTemplate.fileName : 'Системная форма'}
                </span>
              </span>
              {activeDocumentTemplate && (activeDocumentOptions.officialOnly || activeDocumentOptions.goodOnly || activeDocumentOptions.actualOnly) ? (
                <>
                  <span className="px-1 text-[11px] text-slate-400">В документ:</span>
                  {[
                    activeDocumentOptions.officialOnly ? 'официальные' : null,
                    activeDocumentOptions.goodOnly ? 'годные' : null,
                    activeDocumentOptions.actualOnly ? 'актуальные' : null,
                  ]
                    .filter((value): value is string => Boolean(value))
                    .map((value) => (
                      <span
                        key={value}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600"
                      >
                        {value}
                      </span>
                    ))}
                </>
              ) : (
                <span className="text-[11px] text-slate-400">Без дополнительных ограничений шаблона</span>
              )}
              <span className="rounded-md border border-sky-100 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700">
                Разделение: {splitModeLabel.toLocaleLowerCase('ru')}
              </span>
            </div>
          </div>
          <div className="min-w-0 border-t border-slate-200 bg-white px-4 py-3.5 xl:border-l xl:border-t-0">
            <div className="grid min-w-0 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <label className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Название документа
                </span>
                <input
                  value={manualFileName}
                  onChange={(event) => setManualFileName(event.target.value.replace(/\s*\n+\s*/g, ' '))}
                  placeholder={firstDocumentTitle}
                  title={firstDocumentTitle}
                  className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <Button
                type="button"
                onClick={() => void handleGenerateDocuments()}
                disabled={journalRows.length === 0 || isGenerating || generationDataQuery.isFetching}
                className="h-10 gap-2 bg-slate-900 px-4 text-white hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 sm:min-w-40"
              >
                <FileSpreadsheet className="h-4 w-4" />
                {isGenerating
                  ? 'Формирую'
                  : generationDataQuery.isFetching
                    ? 'Обновляю'
                  : journalDocumentGroups.length > 1
                    ? `Сформировать (${journalDocumentGroups.length})`
                    : 'Сформировать'}
              </Button>
            </div>
            <div className="mt-1.5 truncate text-[11px] text-slate-400" title={ensureWeldingJournalXlsxFileName(firstDocumentTitle, activeDocumentProfile.label)}>
              {journalDocumentGroups.length > 1
                ? `Будет сформировано документов «${activeDocumentProfile.label}»: ${journalDocumentGroups.length}. Все документы появятся в истории.`
                : `Итоговый файл: ${ensureWeldingJournalXlsxFileName(firstDocumentTitle, activeDocumentProfile.label)}`}
            </div>
          </div>
        </div>

          <div
            className={`grid min-w-0 gap-4 p-4 ${
              isParametersCollapsed
                ? 'grid-cols-1'
                : 'lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]'
            }`}
          >
            {!isParametersCollapsed ? (
            <aside className="min-w-0 space-y-3">
              <div className="flex items-center justify-between gap-2 px-1">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Параметры</div>
                  <div className="text-xs text-slate-500">Период и состав документа</div>
                </div>
                <button
                  type="button"
                  onClick={() => changeParametersCollapsed(true)}
                  title="Свернуть параметры"
                  aria-label="Свернуть параметры"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-sm font-medium text-slate-700">
                    Период с
                    <input
                      type="date"
                      value={periodFrom}
                      onChange={(event) => setPeriodFrom(event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    по
                    <input
                      type="date"
                      value={periodTo}
                      onChange={(event) => setPeriodTo(event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900"
                    />
                  </label>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 h-8 w-full text-sm"
                  onClick={() => {
                    setPeriodFrom(initialRange.from)
                    setPeriodTo(initialRange.to)
                  }}
                >
                  Текущий месяц
                </Button>
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">Срез документа</div>
                  {(selectedProjects.length > 0 || selectedSubtitles.length > 0 || selectedLines.length > 0) && (
                    <button
                      type="button"
                      className="text-xs font-medium text-sky-700 hover:text-sky-900"
                      onClick={() => {
                        setSelectedProjects([])
                        setSelectedSubtitles([])
                        setSelectedLines([])
                      }}
                    >
                      сбросить все
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  <DocumentMultiFilter
                    label="Проекты"
                    options={scopeOptions.projects}
                    selectedValues={selectedProjects}
                    emptyLabel="все проекты"
                    onChange={setSelectedProjects}
                  />
                  <DocumentMultiFilter
                    label="Шифры"
                    options={scopeOptions.subtitles}
                    selectedValues={selectedSubtitles}
                    emptyLabel="все шифры"
                    onChange={setSelectedSubtitles}
                  />
                  <DocumentMultiFilter
                    label="Линии"
                    options={scopeOptions.lines}
                    selectedValues={selectedLines}
                    emptyLabel="все линии"
                    onChange={setSelectedLines}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <CompactMetricCard label="Стыков" value={journalRows.length} />
                <CompactMetricCard label="WDI" value={wdiTotal} />
              </div>
            </aside>
            ) : null}

            <div className={`${isPreviewFullscreen ? 'fixed inset-4 z-[90] flex flex-col bg-white shadow-2xl' : ''} min-w-0 overflow-hidden rounded-md border border-slate-200`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  {isParametersCollapsed ? (
                    <button
                      type="button"
                      onClick={() => changeParametersCollapsed(false)}
                      title="Показать параметры"
                      aria-label="Показать параметры"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    >
                      <PanelLeftOpen className="h-4 w-4" />
                    </button>
                  ) : null}
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-slate-500" />
                  <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">Предпросмотр</div>
                  <div className="truncate text-xs text-slate-500">
                    {activeDocumentTemplate ? `Лист «${templateDocumentPreview?.sheetName ?? activeDocumentTemplate.constructorConfig?.sheetName ?? activeDocumentTemplate.sheetNames?.[0] ?? 'Excel'}»: ` : ''}
                    показаны первые {previewRows.length} из {journalRows.length}
                  </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => changePreviewScale(-DOCUMENT_PREVIEW_SCALE_STEP)}
                    disabled={previewScale <= DOCUMENT_PREVIEW_MIN_SCALE}
                    title="Уменьшить масштаб"
                    aria-label="Уменьшить масштаб"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:text-slate-300"
                  >
                    <ZoomOut className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={fitPreviewToWidth}
                    title="Вписать лист по ширине"
                    className="h-8 min-w-14 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold tabular-nums text-slate-600 hover:bg-slate-100"
                  >
                    {Math.round(previewScale * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={() => changePreviewScale(DOCUMENT_PREVIEW_SCALE_STEP)}
                    disabled={previewScale >= DOCUMENT_PREVIEW_MAX_SCALE}
                    title="Увеличить масштаб"
                    aria-label="Увеличить масштаб"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:text-slate-300"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPreviewFullscreen((current) => !current)}
                    title={isPreviewFullscreen ? 'Закрыть полноэкранный просмотр' : 'Открыть на весь экран'}
                    aria-label={isPreviewFullscreen ? 'Закрыть полноэкранный просмотр' : 'Открыть на весь экран'}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                  >
                    {isPreviewFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div ref={previewViewportRef} className={`min-w-0 overflow-hidden ${isPreviewFullscreen ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
                {activeDocumentTemplate ? (
                  isTemplatePreviewLoading ? (
                    <DocumentPreviewLoading />
                  ) : templatePreviewError ? (
                    <div className="m-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">
                      {templatePreviewError}
                    </div>
                  ) : templateDocumentPreview ? (
                    <SpreadsheetDocumentPreview
                      preview={templateDocumentPreview}
                      previewedRows={previewRows.length}
                      totalRows={journalRows.length}
                      scale={previewScale}
                      fullscreen={isPreviewFullscreen}
                    />
                  ) : (
                    <DocumentPreviewEmpty />
                  )
                ) : (
                  <div className="min-w-0 overflow-hidden">
                    <BasePreviewTable rows={previewRows} totalRows={journalRows.length} />
                  </div>
                )}
              </div>
            </div>
          </div>
      </section>
      ) : null}

      {generationNotice ? (
        <div
          className={`fixed bottom-5 right-5 z-[80] flex max-w-sm items-start gap-2 rounded-md border px-3 py-2.5 text-sm shadow-lg ${
            generationNotice.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
          role="status"
          aria-live="polite"
        >
          {generationNotice.tone === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          )}
          <span className="min-w-0 leading-5">{generationNotice.text}</span>
          <button
            type="button"
            className="ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-current/60 hover:bg-black/5 hover:text-current"
            onClick={() => setGenerationNotice(null)}
            aria-label="Закрыть уведомление"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {activeWorkspaceTab === 'history' ? (
        isSystemDocument ? (
          <SystemDocumentsPanel
            documents={systemDocuments}
            documentLabel={getSystemDocumentProfile(activeDocumentType).label}
            template={activeDocumentTemplate}
            isLoading={isSystemDocumentsLoading}
            error={systemDocumentsError}
            welderStamps={welderStamps}
          />
        ) : (
          <GeneratedDocumentsPanel
            documents={generatedDocuments.filter((documentRecord) => documentRecord.type === activeGeneratedDocumentType)}
            documentLabel={activeDocumentProfile.label}
            documentFieldLabel={activeDocumentProfile.label}
            onOpenRows={async (documentRecord) => {
              const documentRows = await loadGeneratedDocumentRows(documentRecord.id)
              if (documentRows.length === 0) throw new Error('В документе больше нет стыков.')
              onOpenDocumentRows?.(documentRows.map((row) => row.id), documentRecord.title)
            }}
            createDocumentBlob={async (documentRecord) => {
              const documentRows = await loadGeneratedDocumentRows(documentRecord.id)
              if (documentRows.length === 0) throw new Error('В документе больше нет стыков.')
              return createCurrentGeneratedDocumentBlob({
                type: activeGeneratedDocumentType,
                rows: documentRows,
                welderStamps,
                template: activeDocumentTemplate,
              })
            }}
          />
        )
      ) : null}
    </div>
  )
}

function GeneratedDocumentsPanel({
  documents,
  documentLabel,
  documentFieldLabel,
  createDocumentBlob,
  onOpenRows,
}: {
  documents: StoredGeneratedDocument[]
  documentLabel: string
  documentFieldLabel: string
  createDocumentBlob: (documentRecord: StoredGeneratedDocument) => Promise<Blob>
  onOpenRows: (documentRecord: StoredGeneratedDocument) => Promise<void>
}) {
  const { requireDeletePassword } = useSecurityGuard()
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextActionMenuState>(null)
  const [openingRowsDocumentId, setOpeningRowsDocumentId] = useState<number | null>(null)
  const [openRowsError, setOpenRowsError] = useState<string | null>(null)
  const confirmAction = useConfirmAction()
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase('ru-RU')
  const filteredDocuments = useMemo(
    () =>
      normalizedSearchQuery
        ? documents.filter((documentRecord) =>
            [
              documentRecord.title,
              documentRecord.fileName,
              documentLabel,
              documentRecord.periodFrom,
              documentRecord.periodTo,
              formatDate(documentRecord.periodFrom),
              formatDate(documentRecord.periodTo),
              ...documentRecord.projects,
              ...documentRecord.subtitleCodes,
              ...documentRecord.lines,
            ]
              .filter(Boolean)
              .some((value) => String(value).toLocaleLowerCase('ru-RU').includes(normalizedSearchQuery)),
          )
        : documents,
    [documentLabel, documents, normalizedSearchQuery],
  )
  const deleteDocumentRecord = async (documentRecord: StoredGeneratedDocument) => {
    if (!(await requireDeletePassword(`удаление документа «${documentRecord.title}»`))) return
    const confirmed = await confirmAction({
      title: 'Удалить документ',
      itemName: documentRecord.title,
      description: `Документ «${documentLabel}» связан с ${documentRecord.rowCount} ${formatJointCount(documentRecord.rowCount)}. После удаления поле «${documentFieldLabel}» у этих стыков будет очищено.`,
      warning: 'Документ будет удален из истории сформированных документов. Это действие нельзя отменить.',
    })
    if (confirmed) await deleteGeneratedDocument(documentRecord.id)
  }
  const openDocumentRows = async (documentRecord: StoredGeneratedDocument) => {
    setOpeningRowsDocumentId(documentRecord.id)
    setOpenRowsError(null)
    try {
      await onOpenRows(documentRecord)
    } catch (error) {
      setOpenRowsError(error instanceof Error ? error.message : 'Не удалось открыть стыки документа.')
    } finally {
      setOpeningRowsDocumentId(null)
    }
  }
  const openDocumentRecord = async (documentRecord: StoredGeneratedDocument) => {
    await openGeneratedDocument(documentRecord, () => createDocumentBlob(documentRecord))
  }
  const downloadDocumentRecord = async (documentRecord: StoredGeneratedDocument) => {
    await downloadGeneratedDocument(documentRecord, () => createDocumentBlob(documentRecord))
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-[#cbdde6] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8e5eb] bg-[#f6fafc] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-left">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#c9dce5] bg-white text-[#17627d] shadow-sm">
            <FileText className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900">История документов</h2>
            <p className="text-xs text-slate-500">
              {documents.length > 0 ? `${documents.length} ${formatDocumentCount(documents.length)}` : 'Сформированные документы появятся здесь.'}
            </p>
          </div>
        </div>
        {documents.length > 0 ? (
          <label className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Найти документ"
              aria-label="Найти документ"
              className="h-9 w-full rounded-md border border-[#cbdde6] bg-white pl-9 pr-9 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                title="Очистить поиск"
                aria-label="Очистить поиск"
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
        ) : null}
      </div>

      {openRowsError ? (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {openRowsError}
        </div>
      ) : null}

      {documents.length > 0 ? (
        <div className="min-w-0">
          <div className="grid grid-cols-[minmax(0,1fr)_76px_140px] items-center gap-3 border-b border-[#cfdee6] bg-[#eaf2f6] px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#60778a] md:grid-cols-[minmax(220px,1.6fr)_70px_minmax(145px,0.8fr)_66px_130px_140px] 2xl:grid-cols-[minmax(220px,1.3fr)_54px_minmax(90px,0.65fr)_minmax(80px,0.55fr)_minmax(100px,0.7fr)_minmax(135px,0.8fr)_58px_125px_140px] 2xl:gap-2">
            <span>Документ</span>
            <span className="hidden md:block">Тип</span>
            <span className="hidden 2xl:block">Проект</span>
            <span className="hidden 2xl:block">Шифр</span>
            <span className="hidden 2xl:block">Линия</span>
            <span className="hidden md:block">Период</span>
            <span className="text-right">Стыков</span>
            <span className="hidden md:block">Обновлен</span>
            <span className="text-right">Действия</span>
          </div>
          {filteredDocuments.length > 0 ? (
            <div className="divide-y divide-[#dce7ed]">
              {filteredDocuments.map((documentRecord, documentIndex) => (
                <div
                  key={documentRecord.id}
                  className={`grid min-w-0 grid-cols-[minmax(0,1fr)_76px_140px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[#e2f2f6] md:grid-cols-[minmax(220px,1.6fr)_70px_minmax(145px,0.8fr)_66px_130px_140px] 2xl:grid-cols-[minmax(220px,1.3fr)_54px_minmax(90px,0.65fr)_minmax(80px,0.55fr)_minmax(100px,0.7fr)_minmax(135px,0.8fr)_58px_125px_140px] 2xl:gap-2 ${
                    documentIndex % 2 === 0 ? 'bg-white' : 'bg-[#f4f8fa]'
                  }`}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      items: [
                        {
                          id: 'show-document-rows',
                          label: 'Показать стыки в журнале',
                          icon: Rows3,
                          onSelect: () => openDocumentRows(documentRecord),
                        },
                        { type: 'separator', id: 'open-separator' },
                        {
                          id: 'open-document',
                          label: 'Открыть',
                          icon: ExternalLink,
                          onSelect: () => openDocumentRecord(documentRecord),
                        },
                        {
                          id: 'download-document',
                          label: 'Скачать',
                          icon: Download,
                          onSelect: () => downloadDocumentRecord(documentRecord),
                        },
                        { type: 'separator', id: 'delete-separator' },
                        {
                          id: 'delete-document',
                          label: 'Удалить',
                          icon: Trash2,
                          danger: true,
                          onSelect: () => deleteDocumentRecord(documentRecord),
                        },
                      ],
                    })
                  }}
                >
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() => void openDocumentRecord(documentRecord)}
                    title="Сформировать заново и открыть в новой вкладке"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 shrink-0 text-[#14779a]" />
                      <span className="truncate text-sm font-semibold text-[#155f7a] hover:text-[#0b4258]">{documentRecord.title}</span>
                      <ExternalLink className="hidden h-3.5 w-3.5 shrink-0 text-slate-400 sm:block" />
                    </span>
                    <span className="mt-0.5 block truncate pl-6 text-xs text-slate-500 md:hidden">
                      {documentLabel} · {formatDate(documentRecord.periodFrom)} - {formatDate(documentRecord.periodTo)}
                    </span>
                    <span className="mt-0.5 hidden truncate pl-6 text-xs text-slate-500 md:block 2xl:hidden">
                      {formatDocumentDimensions(documentRecord)}
                    </span>
                  </button>
                  <span className="hidden text-xs font-semibold text-slate-600 md:block">{documentLabel}</span>
                  <DocumentDimensionCell values={documentRecord.projects} />
                  <DocumentDimensionCell values={documentRecord.subtitleCodes} />
                  <DocumentDimensionCell values={documentRecord.lines} />
                  <span className="hidden text-xs text-slate-600 md:block">
                    {formatDate(documentRecord.periodFrom)} - {formatDate(documentRecord.periodTo)}
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums text-slate-800">{documentRecord.rowCount}</span>
                  <span className="hidden text-xs leading-4 text-slate-500 md:block">
                    {formatGeneratedDocumentDate(documentRecord.updatedAt)}
                  </span>
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => void openDocumentRows(documentRecord)}
                      disabled={openingRowsDocumentId === documentRecord.id}
                      title="Показать стыки документа в сварочном журнале"
                      aria-label="Показать стыки документа в сварочном журнале"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      <Rows3 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void openDocumentRecord(documentRecord)}
                      title="Сформировать заново и открыть"
                      aria-label="Сформировать заново и открыть"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void downloadDocumentRecord(documentRecord)}
                      title="Скачать Excel"
                      aria-label="Скачать Excel"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteDocumentRecord(documentRecord)}
                      title="Удалить документ"
                      aria-label="Удалить документ"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-10 text-center">
              <div className="text-sm font-medium text-slate-700">Документы не найдены</div>
              <div className="mt-1 text-xs text-slate-500">Измените запрос или очистите строку поиска.</div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#dbe6ec] bg-[#f4f8fa] px-4 py-2 text-xs text-slate-500">
            <span>
              Найдено: {filteredDocuments.length} из {documents.length}
            </span>
            <span>Нажмите название или кнопку открытия, чтобы сформировать актуальную версию.</span>
          </div>
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-slate-500">Пока нет сохраненных документов.</div>
      )}
      <ContextActionMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </section>
  )
}

function SystemDocumentsPanel({
  documents,
  documentLabel,
  template,
  isLoading,
  error,
  welderStamps,
}: {
  documents: SystemDocumentSummary[]
  documentLabel: string
  template: StoredDocumentTemplate | null
  isLoading: boolean
  error: string | null
  welderStamps: WelderStampRecord[]
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase('ru-RU')
  const filteredDocuments = useMemo(
    () =>
      normalizedSearchQuery
        ? documents.filter((documentRecord) =>
            [
              documentRecord.title,
              documentRecord.label,
              documentRecord.date,
              ...documentRecord.methodCodes,
              ...documentRecord.projects,
              ...documentRecord.subtitleCodes,
              ...documentRecord.lines,
            ].some((value) =>
              String(value).toLocaleLowerCase('ru-RU').includes(normalizedSearchQuery),
            ),
          )
        : documents,
    [documents, normalizedSearchQuery],
  )

  const runAction = async (action: () => Promise<unknown> | void) => {
    setActionError(null)
    try {
      await action()
    } catch (actionFailure) {
      setActionError(
        actionFailure instanceof Error
          ? actionFailure.message
          : 'Не удалось сформировать актуальную версию документа.',
      )
    }
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-[#cbdde6] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8e5eb] bg-[#f6fafc] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-left">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#c9dce5] bg-white text-[#17627d] shadow-sm">
            <FileText className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900">История документов</h2>
            <p className="text-xs text-slate-500">
              {template
                ? `${documents.length} ${formatDocumentCount(documents.length)} · актуальные данные системы`
                : `Загрузите шаблон «${documentLabel}» в настройках.`}
            </p>
          </div>
        </div>
        {template && documents.length > 0 ? (
          <label className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Найти документ"
              aria-label="Найти документ"
              className="h-9 w-full rounded-md border border-[#cbdde6] bg-white pl-9 pr-9 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                title="Очистить поиск"
                aria-label="Очистить поиск"
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
        ) : null}
      </div>

      {error || actionError ? (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error ?? actionError}
        </div>
      ) : null}

      {!template ? (
        <div className="px-4 py-10 text-center">
          <div className="text-sm font-medium text-slate-700">Шаблон не загружен</div>
          <div className="mt-1 text-xs text-slate-500">
            Существующие заявки и заключения сохраняются без изменений, но Excel-документы пока недоступны.
          </div>
        </div>
      ) : isLoading ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">Загружаем актуальную историю...</div>
      ) : documents.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <div className="text-sm font-medium text-slate-700">Документов пока нет</div>
          <div className="mt-1 text-xs text-slate-500">
            Они появятся автоматически после создания соответствующих заявок или заключений.
          </div>
        </div>
      ) : (
        <div className="min-w-0">
          <div className="grid grid-cols-[minmax(0,1fr)_70px_130px] items-center gap-3 border-b border-[#cfdee6] bg-[#eaf2f6] px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#60778a] lg:grid-cols-[minmax(220px,1.5fr)_90px_minmax(120px,0.8fr)_minmax(110px,0.7fr)_70px_120px_100px]">
            <span>Документ</span>
            <span className="hidden lg:block">Вид НК</span>
            <span className="hidden lg:block">Проект / шифр</span>
            <span className="hidden lg:block">Линия</span>
            <span className="text-right">Стыков</span>
            <span className="hidden lg:block">Дата</span>
            <span className="text-right">Действия</span>
          </div>
          {filteredDocuments.length > 0 ? (
            <div className="divide-y divide-[#dce7ed]">
              {filteredDocuments.map((documentRecord, documentIndex) => (
                <div
                  key={documentRecord.id}
                  className={`grid min-w-0 grid-cols-[minmax(0,1fr)_70px_130px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[#e2f2f6] lg:grid-cols-[minmax(220px,1.5fr)_90px_minmax(120px,0.8fr)_minmax(110px,0.7fr)_70px_120px_100px] ${
                    documentIndex % 2 === 0 ? 'bg-white' : 'bg-[#f4f8fa]'
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() =>
                      void runAction(() =>
                        openSystemDocument({
                          reference: documentRecord,
                          summary: documentRecord,
                          welderStamps,
                          template,
                        }),
                      )
                    }
                    title="Сформировать актуальную версию и открыть в новой вкладке"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 shrink-0 text-[#14779a]" />
                      <span className="truncate text-sm font-semibold text-[#155f7a] hover:text-[#0b4258]">
                        {documentRecord.title}
                      </span>
                      <ExternalLink className="hidden h-3.5 w-3.5 shrink-0 text-slate-400 sm:block" />
                    </span>
                    <span className="mt-0.5 block truncate pl-6 text-xs text-slate-500 lg:hidden">
                      {documentLabel}
                      {documentRecord.methodCodes.length > 0
                        ? ` · ${documentRecord.methodCodes.join(', ')}`
                        : ''}
                    </span>
                  </button>
                  <span className="hidden text-xs font-semibold text-slate-600 lg:block">
                    {documentRecord.methodCodes.join(', ') || '-'}
                  </span>
                  <span className="hidden min-w-0 text-xs leading-4 text-slate-600 lg:block">
                    <span className="block truncate">{documentRecord.projects.join(', ') || '-'}</span>
                    <span className="block truncate text-slate-400">{documentRecord.subtitleCodes.join(', ') || '-'}</span>
                  </span>
                  <span className="hidden truncate text-xs text-slate-600 lg:block">
                    {documentRecord.lines.join(', ') || '-'}
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums text-slate-800">
                    {documentRecord.rowCount}
                  </span>
                  <span className="hidden text-xs text-slate-600 lg:block">
                    {formatDate(documentRecord.date) || '-'}
                  </span>
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(() =>
                          openSystemDocument({
                            reference: documentRecord,
                            summary: documentRecord,
                            welderStamps,
                            template,
                          }),
                        )
                      }
                      title="Сформировать актуальную версию и открыть"
                      aria-label="Открыть актуальный документ"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(() =>
                          downloadSystemDocument({
                            reference: documentRecord,
                            summary: documentRecord,
                            welderStamps,
                            template,
                          }),
                        )
                      }
                      title="Скачать актуальный Excel"
                      aria-label="Скачать актуальный документ"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-10 text-center">
              <div className="text-sm font-medium text-slate-700">Документы не найдены</div>
              <div className="mt-1 text-xs text-slate-500">Измените запрос или очистите строку поиска.</div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#dbe6ec] bg-[#f4f8fa] px-4 py-2 text-xs text-slate-500">
            <span>Найдено: {filteredDocuments.length} из {documents.length}</span>
            <span>Документ каждый раз формируется по текущему шаблону и актуальным данным.</span>
          </div>
        </div>
      )}
    </section>
  )
}

function formatGeneratedDocumentDate(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function DocumentDimensionCell({ values }: { values: string[] }) {
  const text = values.length > 0 ? values.join(', ') : '-'
  return (
    <span className="hidden truncate text-xs text-slate-600 2xl:block" title={text}>
      {text}
    </span>
  )
}

function formatDocumentDimensions(documentRecord: StoredGeneratedDocument) {
  return [
    documentRecord.projects.length > 0 ? `Проект: ${documentRecord.projects.join(', ')}` : '',
    documentRecord.subtitleCodes.length > 0 ? `Шифр: ${documentRecord.subtitleCodes.join(', ')}` : '',
    documentRecord.lines.length > 0 ? `Линия: ${documentRecord.lines.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ') || 'Проект, шифр и линия не указаны'
}

function formatDocumentCount(count: number) {
  const lastTwo = count % 100
  const last = count % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 'документов'
  if (last === 1) return 'документ'
  if (last >= 2 && last <= 4) return 'документа'
  return 'документов'
}

function formatJointCount(count: number) {
  const lastTwo = count % 100
  const last = count % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 'стыками'
  if (last === 1) return 'стыком'
  return 'стыками'
}

function DocumentMultiFilter({
  label,
  options,
  selectedValues,
  emptyLabel,
  onChange,
}: {
  label: string
  options: string[]
  selectedValues: string[]
  emptyLabel: string
  onChange: (values: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const selectedSet = new Set(selectedValues)
  const normalizedQuery = query.trim().toLowerCase()
  const filteredOptions = normalizedQuery ? options.filter((option) => option.toLowerCase().includes(normalizedQuery)) : options
  const summary = selectedValues.length === 0 ? emptyLabel : formatSelectedFilterSummary(selectedValues)

  const toggleValue = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selectedValues.filter((selectedValue) => selectedValue !== value))
      return
    }
    onChange([...selectedValues, value])
  }

  return (
    <details className="group rounded-md border border-slate-200 bg-slate-50">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 marker:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
            <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
              {options.length}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs font-semibold text-slate-800">{summary}</div>
        </div>
        {selectedValues.length > 0 ? (
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:text-slate-900"
            title={`Сбросить ${label.toLowerCase()}`}
            aria-label={`Сбросить ${label.toLowerCase()}`}
            onClick={(event) => {
              event.preventDefault()
              onChange([])
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
      </summary>

      <div className="border-t border-slate-200 p-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск"
            className="h-8 w-full rounded-md border border-slate-200 bg-white py-1 pl-8 pr-2 text-sm text-slate-900 placeholder:text-slate-400"
          />
        </label>

        <div className="mt-2 max-h-44 overflow-auto rounded-md border border-slate-200 bg-white">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => {
              const isSelected = selectedSet.has(option)
              return (
                <label
                  key={option}
                  className="flex min-h-8 cursor-pointer items-center gap-2 border-b border-slate-100 px-2.5 py-1.5 last:border-b-0 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleValue(option)}
                    className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700" title={option}>
                    {option}
                  </span>
                </label>
              )
            })
          ) : (
            <div className="px-2.5 py-3 text-center text-xs text-slate-400">нет значений</div>
          )}
        </div>
      </div>
    </details>
  )
}

function formatSelectedFilterSummary(values: string[]) {
  if (values.length === 1) return values[0]
  return `${values.length} выбрано · ${values.slice(0, 2).join(', ')}${values.length > 2 ? ` +${values.length - 2}` : ''}`
}

function SpreadsheetDocumentPreview({
  preview,
  previewedRows,
  totalRows,
  scale,
  fullscreen,
}: {
  preview: DocumentTemplateWorkbookPreview
  previewedRows: number
  totalRows: number
  scale: number
  fullscreen: boolean
}) {
  const cellsByRow = new Map<number, typeof preview.cells>()
  for (const cell of preview.cells) {
    const rowCells = cellsByRow.get(cell.row) ?? []
    rowCells.push(cell)
    cellsByRow.set(cell.row, rowCells)
  }
  const totalColumnWidth = preview.columnWidths.reduce((sum, width) => sum + Math.max(width, 1), 0) || 1

  return (
    <>
      <div className={`${fullscreen ? 'min-h-0 flex-1 max-h-none' : 'max-h-[620px]'} min-w-0 overflow-auto bg-slate-100/80 p-3`}>
        <div
          className="w-max overflow-hidden rounded border border-slate-300 bg-white shadow-sm"
          style={{ minWidth: `${Math.round(totalColumnWidth * scale)}px` }}
        >
          <table
            className="table-fixed border-separate border-spacing-0 text-slate-800"
            style={{ width: `${Math.round(totalColumnWidth * scale)}px` }}
          >
            <colgroup>
              {preview.columnWidths.map((width, index) => (
                <col
                  key={`${preview.sheetName}:column:${preview.startColumn + index}`}
                  style={{ width: `${Math.round(Math.max(width, 1) * scale)}px` }}
                />
              ))}
            </colgroup>
            <tbody>
              {Array.from({ length: preview.rowCount }, (_, index) => preview.startRow + index).map((row, rowIndex) => {
                const rowCells = (cellsByRow.get(row) ?? []).sort((left, right) => left.column - right.column)
                return (
                  <tr
                    key={`${preview.sheetName}:row:${row}`}
                    style={{ height: `${Math.round((preview.rowHeights[rowIndex] ?? 28) * scale)}px` }}
                  >
                    {rowCells.map((cell) => (
                      <td
                        key={cell.address}
                        rowSpan={cell.rowSpan}
                        colSpan={cell.columnSpan}
                        title={cell.value || cell.address}
                        className="overflow-hidden px-1 py-1"
                        style={getSpreadsheetPreviewCellStyle(cell.style, scale)}
                      >
                        <div className={cell.style.whiteSpace === 'pre-line' ? 'break-words whitespace-pre-line' : 'truncate'}>
                          {cell.value}
                        </div>
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <span>Уменьшенная копия сформированного Excel-листа.</span>
        <span>
          Показано стыков: {previewedRows} из {totalRows}
          {preview.truncated ? ' · область листа сокращена' : ''}
        </span>
      </div>
    </>
  )
}

function getSpreadsheetPreviewCellStyle(
  style: DocumentTemplateWorkbookPreview['cells'][number]['style'],
  scale: number,
): CSSProperties {
  return {
    ...style,
    fontSize: `${Math.min(Math.max((style.fontSize ?? 11) * scale, 8), 24)}px`,
    lineHeight: 1.25,
    minWidth: 0,
    borderRight: style.borderRight ?? '1px solid #eef2f7',
    borderBottom: style.borderBottom ?? '1px solid #eef2f7',
    backgroundColor: style.backgroundColor ?? '#ffffff',
    verticalAlign: style.verticalAlign ?? 'middle',
  }
}

function DocumentPreviewLoading() {
  return (
    <div className="space-y-2 bg-slate-100/80 p-3" aria-label="Формируется предпросмотр документа">
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="h-8 animate-pulse rounded border border-slate-200 bg-white"
          style={{ width: `${94 - index * 3}%` }}
        />
      ))}
    </div>
  )
}

function DocumentPreviewEmpty() {
  return (
    <div className="px-3 py-10 text-center text-sm text-slate-500">
      За выбранный период сваренных стыков не найдено.
    </div>
  )
}

function BasePreviewTable({ rows, totalRows }: { rows: WeldRow[]; totalRows: number }) {
  return (
    <table className="w-full table-fixed border-collapse text-xs sm:text-sm">
      <thead className="bg-slate-100 text-slate-600">
        <tr>
          <th className="w-[22%] px-2 py-2 text-left font-semibold">Линия</th>
          <th className="w-[12%] px-2 py-2 text-left font-semibold">Стык</th>
          <th className="w-[18%] px-2 py-2 text-left font-semibold">Дата сварки</th>
          <th className="w-[18%] px-2 py-2 text-left font-semibold">Способ</th>
          <th className="w-[12%] px-2 py-2 text-left font-semibold">D1/D2</th>
          <th className="w-[18%] px-2 py-2 text-left font-semibold">Факт. клейма</th>
        </tr>
      </thead>
      <tbody>
        {rows.length > 0 ? (
          rows.map((row) => (
            <tr key={row.id} className="border-t border-slate-100">
              <td className="truncate px-2 py-2 text-slate-700" title={getCellValue(row, 'line')}>{getCellValue(row, 'line')}</td>
              <td className="truncate px-2 py-2 font-semibold text-slate-900">{getCellValue(row, 'joint')}</td>
              <td className="truncate px-2 py-2 text-slate-700">{formatDate(row.weldDate) || '-'}</td>
              <td className="truncate px-2 py-2 text-slate-700" title={getCellValue(row, 'weldingMethod')}>{getCellValue(row, 'weldingMethod')}</td>
              <td className="truncate px-2 py-2 text-slate-700">
                {getCellValue(row, 'd1')} / {getCellValue(row, 'd2')}
              </td>
              <td className="truncate px-2 py-2 text-slate-700">
                {[row.stamp1KFact, row.stamp1ZFact, row.stamp1OFact, row.stamp2KFact, row.stamp2ZFact, row.stamp2OFact]
                  .map((value) => String(value ?? '').trim())
                  .filter(Boolean)
                  .join(', ') || '-'}
              </td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
              За выбранный период сваренных стыков не найдено.
            </td>
          </tr>
        )}
        {rows.length > 0 && totalRows > rows.length ? (
          <tr className="border-t border-slate-100 bg-slate-50">
            <td colSpan={6} className="px-3 py-2 text-xs text-slate-500">
              В предпросмотре показаны первые {rows.length} строк. В документ попадут все {totalRows}.
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  )
}

function CompactMetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-xl font-semibold leading-none text-slate-900">{value}</div>
    </div>
  )
}
