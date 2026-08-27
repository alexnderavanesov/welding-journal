import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  FilePenLine,
  FileSpreadsheet,
  FileText,
  ListFilter,
  Maximize2,
  Minimize2,
  Minus,
  Archive,
  PanelLeftClose,
  PanelLeftOpen,
  Rows3,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { ContextActionMenu, type ContextActionMenuState } from '@/components/context-action-menu'
import { PaginationBar } from '@/components/pagination-bar'
import { Button } from '@/components/ui/button'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { useSecurityGuard } from '@/lib/security-context'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  createWeldingJournalDocumentPreview,
  getWeldingJournalTemplateOptions,
  loadDocumentTemplate,
  type DocumentTemplateWorkbookPreview,
  type StoredDocumentTemplate,
} from '@/lib/document-template-storage'
import {
  deleteGeneratedDocument,
  downloadGeneratedDocumentArchive,
  downloadGeneratedDocument,
  loadGeneratedDocumentHistory,
  loadGeneratedDocumentRows,
  openGeneratedDocument,
  type StoredGeneratedDocument,
} from '@/lib/generated-document-storage'
import {
  DOCUMENT_TEMPLATE_STORAGE_EVENT,
  GENERATED_DOCUMENT_STORAGE_EVENT,
} from '@/lib/document-storage-events'
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
  createCurrentSystemDocumentBlob,
  downloadSystemDocument,
  loadSystemDocumentHistory,
  loadSystemDocumentRows,
  openSystemDocument,
  renameSystemDocumentToCurrentName,
} from '@/lib/system-document-storage'
import {
  SYSTEM_DOCUMENT_TYPES,
  getSystemDocumentProfile,
  getSystemDocumentTargetReport,
  isSystemDocumentType,
  type SystemDocumentNavigationRequest,
  type SystemDocumentSummary,
  type SystemDocumentType,
} from '@/lib/system-document-types'
import {
  LNK_CONCLUSION_TEMPLATE_PROFILES,
  getLnkConclusionTemplateMethodCodes,
  getLnkConclusionTemplateProfile,
  getSystemDocumentTemplateId,
  type LnkConclusionTemplateId,
  type SystemDocumentTemplateId,
} from '@/lib/system-document-template-types'
import { useSystemDocumentTemplateAvailability } from '@/lib/use-system-document-template-availability'
import {
  SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY,
} from '@/lib/system-document-sequence-storage'
import {
  GENERATED_DOCUMENT_HISTORY_QUERY_KEY,
  invalidateWeldJoints,
  WELD_JOINTS_QUERY_KEY,
} from '@/lib/weld-query-utils'
import { getDocumentGenerationData } from '@/server/welds'
import { buildWeldColumnValueFilter, parseWeldColumnChoiceFilter } from '@/lib/weld-table-filtering'
import { ALL_PAGE_SIZE } from '@/lib/use-pagination'

type DocumentsPageProps = {
  welderStamps: WelderStampRecord[]
  navigationRequest?: SystemDocumentNavigationRequest | null
  onNavigationRequestHandled?: (requestId: number) => void
  onOpenDocumentRows?: (
    rowIds: number[],
    documentTitle: string,
    targetReport?: 'weldingJournal' | 'lnk' | 'heatTreatment',
  ) => void
}

const DOCUMENT_PREVIEW_ROW_LIMIT = 3
const DOCUMENT_PREVIEW_SCALE = 1.2
const DOCUMENT_PREVIEW_MIN_SCALE = 0.45
const DOCUMENT_PREVIEW_MAX_SCALE = 1.8
const DOCUMENT_PREVIEW_SCALE_STEP = 0.15
const DOCUMENT_PARAMETERS_COLLAPSED_STORAGE_KEY = 'welding-journal:documents:parameters-collapsed'
const DOCUMENT_HISTORY_DEFAULT_PAGE_SIZE = 100

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

const SYSTEM_DOCUMENT_TYPE_OPTIONS = SYSTEM_DOCUMENT_TYPES.map((type) => ({
  id: type,
  label: type === 'lnkConclusion' ? 'Заключения ЛНК' : getSystemDocumentProfile(type).label,
}))

type DocumentsPageType = GeneratedDocumentType | SystemDocumentType
type DocumentHistoryFilterKey =
  | 'title'
  | 'project'
  | 'subtitle'
  | 'line'
  | 'period'
  | 'updatedAt'
  | 'method'
  | 'date'
  | 'rowCount'
  | 'wdi'

type DocumentHistoryColumnOption = {
  value: string
  label: string
  count: number
}

const GENERATED_DOCUMENT_FILTERS: Array<{ key: DocumentHistoryFilterKey; label: string; className?: string }> = [
  { key: 'title', label: 'Документ' },
  { key: 'project', label: 'Проект', className: 'hidden min-[1800px]:flex' },
  { key: 'subtitle', label: 'Шифр', className: 'hidden min-[1800px]:flex' },
  { key: 'line', label: 'Линия', className: 'hidden min-[1800px]:flex' },
  { key: 'period', label: 'Период', className: 'hidden min-[1440px]:flex' },
  { key: 'rowCount', label: 'Стыков', className: 'justify-end' },
  { key: 'wdi', label: 'WDI', className: 'hidden justify-end min-[1440px]:flex' },
  { key: 'updatedAt', label: 'Обновлен', className: 'hidden min-[1440px]:flex' },
]

const SYSTEM_DOCUMENT_FILTERS: Array<{ key: DocumentHistoryFilterKey; label: string; className?: string }> = [
  { key: 'title', label: 'Документ' },
  { key: 'method', label: 'Вид НК', className: 'hidden xl:flex' },
  { key: 'project', label: 'Проект', className: 'hidden min-[1800px]:flex' },
  { key: 'subtitle', label: 'Шифр', className: 'hidden min-[1800px]:flex' },
  { key: 'line', label: 'Линия', className: 'hidden min-[1800px]:flex' },
  { key: 'rowCount', label: 'Стыков', className: 'justify-end' },
  { key: 'date', label: 'Дата', className: 'hidden xl:flex' },
]

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

function getDocumentHistoryFilterCount(value: string | undefined) {
  const choiceFilter = parseWeldColumnChoiceFilter(value ?? '')
  if (choiceFilter?.kind === 'values') return choiceFilter.values.length
  return value?.trim() ? 1 : 0
}

function getDocumentHistoryFilterSummary(value: string | undefined) {
  const filterValue = String(value ?? '').trim()
  const choiceFilter = parseWeldColumnChoiceFilter(filterValue)
  if (choiceFilter?.kind === 'values') {
    if (choiceFilter.values.length === 1) return choiceFilter.values[0] || '(пусто)'
    return `${choiceFilter.values.length} выбрано`
  }
  return filterValue
}

function hasDocumentHistoryFilters(filters: Record<string, string>) {
  return Object.values(filters).some((value) => value.trim())
}

function makeDocumentsArchiveFileName(documentLabel: string) {
  const date = new Date().toISOString().slice(0, 10)
  return `${sanitizeArchiveName(documentLabel)}-${date}.zip`
}

function sanitizeArchiveName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'Документы'
}

function getSystemDocumentNavigationIdentity(
  documentRecord: Pick<SystemDocumentSummary, 'type' | 'title' | 'date' | 'methodCode'>,
) {
  return JSON.stringify([
    documentRecord.type,
    documentRecord.title.trim(),
    documentRecord.date.trim().slice(0, 10),
    documentRecord.methodCode?.trim() ?? '',
  ])
}

export function DocumentsPage({
  welderStamps,
  navigationRequest,
  onNavigationRequestHandled,
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
  const [activeNavigationRequest, setActiveNavigationRequest] =
    useState<SystemDocumentNavigationRequest | null>(navigationRequest ?? null)
  const [activeDocumentType, setActiveDocumentType] = useState<DocumentsPageType>(
    () => navigationRequest?.type ?? 'weldingJournal',
  )
  const [activeDocumentTemplate, setActiveDocumentTemplate] = useState<StoredDocumentTemplate | null>(null)
  const [templateDocumentPreview, setTemplateDocumentPreview] = useState<DocumentTemplateWorkbookPreview | null>(null)
  const [templatePreviewError, setTemplatePreviewError] = useState<string | null>(null)
  const [isTemplatePreviewLoading, setIsTemplatePreviewLoading] = useState(false)
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
  const availableSystemDocumentTemplates = useSystemDocumentTemplateAvailability()
  const activeGeneratedDocumentType: GeneratedDocumentType = isGeneratedDocumentType(activeDocumentType)
    ? activeDocumentType
    : 'weldingJournal'
  const generatedDocumentsTotalQuery = useQuery({
    queryKey: [
      ...GENERATED_DOCUMENT_HISTORY_QUERY_KEY,
      activeGeneratedDocumentType,
      'paged',
      DOCUMENT_HISTORY_DEFAULT_PAGE_SIZE,
      {},
    ],
    queryFn: () => loadGeneratedDocumentHistory({
      type: activeGeneratedDocumentType,
      limit: DOCUMENT_HISTORY_DEFAULT_PAGE_SIZE,
      columnFilters: {},
    }),
    enabled: !isSystemDocument,
    staleTime: 30_000,
  })
  const generatedDocumentsTotal = generatedDocumentsTotalQuery.data?.total ?? 0
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
    if (!navigationRequest) return
    setActiveNavigationRequest(navigationRequest)
    setActiveDocumentType(navigationRequest.type)
    setActiveWorkspaceTab('history')
    setTemplateDocumentPreview(null)
    setTemplatePreviewError(null)
    onNavigationRequestHandled?.(navigationRequest.requestId)
  }, [navigationRequest, onNavigationRequestHandled])

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
    if (isSystemDocument) {
      setActiveDocumentTemplate(null)
      return () => {
        isMounted = false
      }
    }
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
  }, [activeDocumentType, isSystemDocument])

  useEffect(() => {
    const handleGeneratedDocumentChange = () => {
      void queryClient.invalidateQueries({ queryKey: GENERATED_DOCUMENT_HISTORY_QUERY_KEY })
      void queryClient.invalidateQueries({
        queryKey: [...WELD_JOINTS_QUERY_KEY, 'document-generation'],
      })
    }

    window.addEventListener(GENERATED_DOCUMENT_STORAGE_EVENT, handleGeneratedDocumentChange)
    return () => {
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
                  setActiveNavigationRequest(null)
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
                setActiveNavigationRequest(null)
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

      {!isSystemDocument ? (
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
              {generatedDocumentsTotal}
            </span>
          </button>
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
        </div>
      ) : null}

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
                <CompactMetricCard label="WDI" value={formatWdi(wdiTotal)} />
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

      {isSystemDocument || activeWorkspaceTab === 'history' ? (
        isSystemDocument ? (
          <SystemDocumentsPanel
            key={activeDocumentType}
            documentLabel={getSystemDocumentProfile(activeDocumentType).label}
            documentType={activeDocumentType}
            navigationRequest={
              activeNavigationRequest?.type === activeDocumentType
                ? activeNavigationRequest
                : null
            }
            availableTemplateIds={availableSystemDocumentTemplates}
            welderStamps={welderStamps}
            onOpenRows={async (documentRecord) => {
              const documentRows = await loadSystemDocumentRows(documentRecord)
              if (documentRows.length === 0) throw new Error('В документе больше нет стыков.')
              onOpenDocumentRows?.(
                documentRows.map((row) => row.id),
                documentRecord.title,
                getSystemDocumentTargetReport(documentRecord.type),
              )
            }}
            onRenamed={async () => {
              if (!isSystemDocumentType(activeDocumentType)) return
              await Promise.all([
                invalidateWeldJoints(queryClient),
                queryClient.invalidateQueries({
                  queryKey: [...GENERATED_DOCUMENT_HISTORY_QUERY_KEY, 'system-document-history'],
                }),
                queryClient.invalidateQueries({
                  queryKey: SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY,
                }),
              ])
            }}
          />
        ) : (
          <GeneratedDocumentsPanel
            documentType={activeGeneratedDocumentType}
            initialTotal={generatedDocumentsTotal}
            documentLabel={activeDocumentProfile.label}
            documentFieldLabel={activeDocumentProfile.label}
            onRepeat={(documentRecord) => {
              setPeriodFrom(documentRecord.periodFrom || initialRange.from)
              setPeriodTo(documentRecord.periodTo || initialRange.to)
              setSelectedProjects(documentRecord.projects)
              setSelectedSubtitles(documentRecord.subtitleCodes)
              setSelectedLines(documentRecord.lines)
              setManualFileName(documentRecord.title)
              setActiveWorkspaceTab('generation')
              setIsParametersCollapsed(false)
            }}
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
  documentType,
  initialTotal,
  documentLabel,
  documentFieldLabel,
  onRepeat,
  createDocumentBlob,
  onOpenRows,
}: {
  documentType: GeneratedDocumentType
  initialTotal: number
  documentLabel: string
  documentFieldLabel: string
  onRepeat: (documentRecord: StoredGeneratedDocument) => void
  createDocumentBlob: (documentRecord: StoredGeneratedDocument) => Promise<Blob>
  onOpenRows: (documentRecord: StoredGeneratedDocument) => Promise<void>
}) {
  const { requireDeletePassword } = useSecurityGuard()
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [pageSize, setPageSize] = useState(DOCUMENT_HISTORY_DEFAULT_PAGE_SIZE)
  const [visibleLimit, setVisibleLimit] = useState(DOCUMENT_HISTORY_DEFAULT_PAGE_SIZE)
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<number>>(new Set())
  const [contextMenu, setContextMenu] = useState<ContextActionMenuState>(null)
  const [openingRowsDocumentId, setOpeningRowsDocumentId] = useState<number | null>(null)
  const [openRowsError, setOpenRowsError] = useState<string | null>(null)
  const [isDownloadingArchive, setIsDownloadingArchive] = useState(false)
  const confirmAction = useConfirmAction()
  const historyQuery = useQuery({
    queryKey: [...GENERATED_DOCUMENT_HISTORY_QUERY_KEY, documentType, 'paged', visibleLimit, columnFilters],
    queryFn: () => loadGeneratedDocumentHistory({
      type: documentType,
      limit: visibleLimit,
      columnFilters,
    }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
  const documents = historyQuery.data?.documents ?? []
  const totalDocuments = historyQuery.data?.total ?? initialTotal
  const filterOptions = historyQuery.data?.filterOptions ?? {}
  const hasMoreDocuments = documents.length < totalDocuments
  const pageDocumentIds = useMemo(
    () => new Set(documents.map((documentRecord) => documentRecord.id)),
    [documents],
  )
  const selectedDocuments = useMemo(
    () => documents.filter((documentRecord) => selectedDocumentIds.has(documentRecord.id)),
    [documents, selectedDocumentIds],
  )
  const selectedPageCount = documents.filter((documentRecord) =>
    selectedDocumentIds.has(documentRecord.id),
  ).length
  const allPageSelected = documents.length > 0 && selectedPageCount === documents.length
  const hasActiveFilters = hasDocumentHistoryFilters(columnFilters)
  const historyError =
    historyQuery.error instanceof Error
      ? historyQuery.error.message
      : historyQuery.error
        ? 'Не удалось загрузить историю документов.'
        : null

  useEffect(() => {
    setSelectedDocumentIds((current) => {
      const availableIds = new Set(documents.map((documentRecord) => documentRecord.id))
      const next = new Set([...current].filter((id) => availableIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [documents])

  const changeColumnFilter = (key: DocumentHistoryFilterKey, value: string) => {
    const nextFilters = { ...columnFilters }
    if (value) nextFilters[key] = value
    else delete nextFilters[key]
    setColumnFilters(nextFilters)
    setVisibleLimit(pageSize === ALL_PAGE_SIZE ? Math.max(totalDocuments, 1) : pageSize)
  }

  const changePageSize = (nextPageSize: number) => {
    setPageSize(nextPageSize)
    setVisibleLimit(nextPageSize === ALL_PAGE_SIZE ? Math.max(totalDocuments, 1) : nextPageSize)
  }

  const loadMoreDocuments = () => {
    const increment = pageSize === ALL_PAGE_SIZE ? Math.max(totalDocuments, 1) : pageSize
    setVisibleLimit((current) => Math.min(totalDocuments || current + increment, current + increment))
  }

  const toggleDocumentSelection = (documentId: number) => {
    setSelectedDocumentIds((current) => {
      const next = new Set(current)
      if (next.has(documentId)) next.delete(documentId)
      else next.add(documentId)
      return next
    })
  }

  const togglePageSelection = () => {
    setSelectedDocumentIds((current) => {
      const next = new Set(current)
      if (allPageSelected) {
        for (const id of pageDocumentIds) next.delete(id)
      } else {
        for (const id of pageDocumentIds) next.add(id)
      }
      return next
    })
  }

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
  const downloadSelectedArchive = async () => {
    if (selectedDocuments.length === 0 || isDownloadingArchive) return
    setIsDownloadingArchive(true)
    setOpenRowsError(null)
    try {
      await downloadGeneratedDocumentArchive(
        selectedDocuments.map((documentRecord) => ({
          record: documentRecord,
          createDocumentBlob: () => createDocumentBlob(documentRecord),
        })),
        makeDocumentsArchiveFileName(documentLabel),
      )
    } catch (error) {
      setOpenRowsError(error instanceof Error ? error.message : 'Не удалось скачать архив документов.')
    } finally {
      setIsDownloadingArchive(false)
    }
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-[#cbdde6] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {hasActiveFilters ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-[#d8e5eb] bg-[#f6fafc] px-4 py-2.5">
          <button
            type="button"
            onClick={() => {
              setColumnFilters({})
              setVisibleLimit(pageSize === ALL_PAGE_SIZE ? Math.max(totalDocuments, 1) : pageSize)
            }}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#cbdde6] bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <X className="h-3.5 w-3.5" />
            Сбросить фильтры
          </button>
        </div>
      ) : null}

      {historyError ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          <span>Не удалось загрузить историю документов: {historyError}</span>
          <button type="button" className="rounded-md border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold" onClick={() => void historyQuery.refetch()}>Повторить</button>
        </div>
      ) : null}
      {openRowsError ? <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{openRowsError}</div> : null}

      {historyQuery.isLoading ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">Загружаем актуальную историю...</div>
      ) : totalDocuments === 0 && !historyError && !hasActiveFilters ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">Пока нет сохраненных документов.</div>
      ) : totalDocuments === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">По выбранным условиям документы не найдены.</div>
      ) : (
        <div className="min-w-0">
          <div className="grid grid-cols-[34px_minmax(240px,1fr)_96px_168px] items-center gap-x-4 gap-y-2 border-b border-[#cfdee6] bg-[#eaf2f6] px-4 py-2 text-[11px] font-semibold uppercase text-[#60778a] min-[1440px]:grid-cols-[34px_minmax(300px,1.5fr)_minmax(160px,0.75fr)_96px_76px_130px_168px] min-[1800px]:grid-cols-[34px_minmax(340px,1.55fr)_minmax(130px,0.52fr)_minmax(120px,0.5fr)_minmax(150px,0.58fr)_minmax(170px,0.7fr)_96px_76px_130px_168px]">
            <DocumentHistorySelectAllButton
              checked={allPageSelected}
              partial={selectedPageCount > 0 && !allPageSelected}
              disabled={documents.length === 0}
              onClick={togglePageSelection}
            />
            {GENERATED_DOCUMENT_FILTERS.map((filter) => (
              <DocumentHistoryColumnFilter
                key={filter.key}
                label={filter.label}
                value={columnFilters[filter.key] ?? ''}
                options={filterOptions[filter.key] ?? []}
                className={filter.className}
                alignRight={filter.className?.includes('justify-end')}
                dateGrouped={filter.key === 'period' || filter.key === 'updatedAt'}
                onChange={(value) => changeColumnFilter(filter.key, value)}
              />
            ))}
            <div className="flex justify-end">
              {selectedDocuments.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 gap-1.5 px-2 text-[11px] normal-case"
                  disabled={isDownloadingArchive}
                  onClick={() => void downloadSelectedArchive()}
                >
                  <Archive className="h-3.5 w-3.5" />
                  {isDownloadingArchive ? 'Готовим' : `Архив (${selectedDocuments.length})`}
                </Button>
              ) : <span>Действия</span>}
            </div>
          </div>
          <div className="divide-y divide-[#dce7ed]">
            {documents.map((documentRecord, documentIndex) => {
              const isSelected = selectedDocumentIds.has(documentRecord.id)
              return (
              <div
                key={documentRecord.id}
                className={`grid min-w-0 grid-cols-[34px_minmax(240px,1fr)_96px_168px] items-center gap-x-4 gap-y-2 px-4 py-2.5 transition-colors hover:bg-[#e2f2f6] min-[1440px]:grid-cols-[34px_minmax(300px,1.5fr)_minmax(160px,0.75fr)_96px_76px_130px_168px] min-[1800px]:grid-cols-[34px_minmax(340px,1.55fr)_minmax(130px,0.52fr)_minmax(120px,0.5fr)_minmax(150px,0.58fr)_minmax(170px,0.7fr)_96px_76px_130px_168px] ${
                  isSelected
                    ? 'bg-sky-50 ring-1 ring-inset ring-sky-200'
                    : documentIndex % 2 === 0 ? 'bg-white' : 'bg-[#f4f8fa]'
                }`}
                onContextMenu={(event) => {
                  event.preventDefault()
                  const bulkItems = selectedDocumentIds.has(documentRecord.id) && selectedDocuments.length > 1
                    ? [
                        { id: 'download-selected-archive', label: `Скачать выбранные архивом (${selectedDocuments.length})`, icon: Archive, onSelect: () => downloadSelectedArchive() },
                        { type: 'separator' as const, id: 'bulk-separator' },
                      ]
                    : []
                  setContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    items: [
                      ...bulkItems,
                      { id: 'show-document-rows', label: 'Показать стыки в журнале', icon: Rows3, onSelect: () => openDocumentRows(documentRecord) },
                      { id: 'repeat-document', label: 'Повторить с параметрами', icon: SlidersHorizontal, onSelect: () => onRepeat(documentRecord) },
                      { type: 'separator', id: 'open-separator' },
                      { id: 'open-document', label: 'Открыть Excel', icon: ExternalLink, onSelect: () => openDocumentRecord(documentRecord) },
                      { id: 'download-document', label: 'Скачать Excel', icon: Download, onSelect: () => downloadDocumentRecord(documentRecord) },
                      { type: 'separator', id: 'delete-separator' },
                      { id: 'delete-document', label: 'Удалить', icon: Trash2, danger: true, onSelect: () => deleteDocumentRecord(documentRecord) },
                    ],
                  })
                }}
              >
                <DocumentHistoryRowCheckbox
                  checked={isSelected}
                  label={`Выбрать документ «${documentRecord.title}»`}
                  onChange={() => toggleDocumentSelection(documentRecord.id)}
                />
                <button
                  type="button"
                  className="group min-w-0 text-left"
                  onClick={() => void openDocumentRecord(documentRecord)}
                  title="Сформировать актуальную версию и открыть Excel"
                >
                  <span className="flex min-w-0 items-start gap-2.5">
                    <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#c9dce5] bg-[#f4fafc] text-[#14779a] transition-colors group-hover:border-[#9fc4d2] group-hover:bg-[#e9f5f8]">
                      <FileSpreadsheet className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[13px] font-medium leading-5 text-slate-800 transition-colors group-hover:text-[#0b526c]">
                        {documentRecord.title}
                      </span>
                      <span className="mt-0.5 block text-xs leading-4 text-slate-500 min-[1440px]:hidden">
                        {documentLabel} · {formatDate(documentRecord.periodFrom)} - {formatDate(documentRecord.periodTo)} · {formatWdi(documentRecord.wdiTotal)} WDI
                      </span>
                      <span className="mt-0.5 hidden break-words text-xs leading-4 text-slate-500 min-[1440px]:block min-[1800px]:hidden" title={formatDocumentDimensions(documentRecord)}>
                        {formatDocumentDimensions(documentRecord)}
                      </span>
                    </span>
                  </span>
                </button>
                <DocumentDimensionCell values={documentRecord.projects} />
                <DocumentDimensionCell values={documentRecord.subtitleCodes} />
                <DocumentDimensionCell values={documentRecord.lines} />
                <span className="hidden text-xs text-slate-600 min-[1440px]:block">
                  {formatDate(documentRecord.periodFrom)} - {formatDate(documentRecord.periodTo)}
                </span>
                <span className="text-right text-sm font-semibold tabular-nums text-slate-800">{documentRecord.rowCount}</span>
                <span className="hidden text-right text-sm font-semibold tabular-nums text-slate-700 min-[1440px]:block">{formatWdi(documentRecord.wdiTotal)}</span>
                <span className="hidden text-xs leading-4 text-slate-500 min-[1440px]:block">{formatGeneratedDocumentDate(documentRecord.updatedAt)}</span>
                <div className="flex items-center justify-end gap-1">
                  <DocumentHistoryActionButton
                    title="Показать стыки документа в сварочном журнале"
                    tone="emerald"
                    disabled={openingRowsDocumentId === documentRecord.id}
                    onClick={() => void openDocumentRows(documentRecord)}
                  ><Rows3 className="h-4 w-4" /></DocumentHistoryActionButton>
                  <DocumentHistoryActionButton title="Повторить с параметрами" tone="violet" onClick={() => onRepeat(documentRecord)}>
                    <SlidersHorizontal className="h-4 w-4" />
                  </DocumentHistoryActionButton>
                  <DocumentHistoryActionButton title="Открыть Excel" tone="sky" onClick={() => void openDocumentRecord(documentRecord)}>
                    <ExternalLink className="h-4 w-4" />
                  </DocumentHistoryActionButton>
                  <DocumentHistoryActionButton title="Скачать Excel" onClick={() => void downloadDocumentRecord(documentRecord)}>
                    <Download className="h-4 w-4" />
                  </DocumentHistoryActionButton>
                  <DocumentHistoryActionButton title="Удалить документ" tone="rose" onClick={() => void deleteDocumentRecord(documentRecord)}>
                    <Trash2 className="h-4 w-4" />
                  </DocumentHistoryActionButton>
                </div>
              </div>
              )
            })}
          </div>
        </div>
      )}
      <div className="border-t border-[#dbe6ec] bg-[#f4f8fa] px-4 py-2">
        <PaginationBar
          totalCount={totalDocuments}
          firstItemNumber={documents.length === 0 ? 0 : 1}
          lastItemNumber={documents.length}
          pageSize={pageSize}
          hasMore={hasMoreDocuments}
          label="документов"
          onLoadMore={loadMoreDocuments}
          onPageSizeChange={changePageSize}
        />
        <div className="mt-2 text-xs text-slate-500">
          Найдено: {totalDocuments} из {hasActiveFilters ? initialTotal : totalDocuments}
          {selectedDocuments.length > 0 ? ` · выбрано: ${selectedDocuments.length}` : ''}
        </div>
      </div>
      <ContextActionMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </section>
  )
}

function SystemDocumentsPanel({
  documentLabel,
  documentType,
  navigationRequest,
  availableTemplateIds,
  welderStamps,
  onOpenRows,
  onRenamed,
}: {
  documentLabel: string
  documentType: SystemDocumentType
  navigationRequest: SystemDocumentNavigationRequest | null
  availableTemplateIds: ReadonlySet<SystemDocumentTemplateId>
  welderStamps: WelderStampRecord[]
  onOpenRows: (documentRecord: SystemDocumentSummary) => Promise<void>
  onRenamed: () => Promise<void>
}) {
  const { requireEditPassword } = useSecurityGuard()
  const confirmAction = useConfirmAction()
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [pageSize, setPageSize] = useState(DOCUMENT_HISTORY_DEFAULT_PAGE_SIZE)
  const [visibleLimit, setVisibleLimit] = useState(DOCUMENT_HISTORY_DEFAULT_PAGE_SIZE)
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null)
  const [isDownloadingArchive, setIsDownloadingArchive] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextActionMenuState>(null)
  const [lnkConclusionTemplateFilter, setLnkConclusionTemplateFilter] =
    useState<'all' | LnkConclusionTemplateId>('all')
  const navigationDocumentIdentity = navigationRequest
    ? getSystemDocumentNavigationIdentity(navigationRequest)
    : null

  useEffect(() => {
    if (!navigationRequest) return
    setColumnFilters({ title: buildWeldColumnValueFilter([navigationRequest.title]) })
    if (navigationRequest.type === 'lnkConclusion') {
      setLnkConclusionTemplateFilter(
        getLnkConclusionTemplateProfile(navigationRequest.methodCode).id,
      )
    }
  }, [navigationRequest])

  const effectiveColumnFilters = useMemo(
    () => {
      if (documentType !== 'lnkConclusion' || lnkConclusionTemplateFilter === 'all') return columnFilters
      const profile = LNK_CONCLUSION_TEMPLATE_PROFILES.find((candidate) => candidate.id === lnkConclusionTemplateFilter)
      if (!profile) return columnFilters
      const methodCodes = getLnkConclusionTemplateMethodCodes(profile.id)
      return {
        ...columnFilters,
        method: buildWeldColumnValueFilter(methodCodes),
      }
    },
    [columnFilters, documentType, lnkConclusionTemplateFilter],
  )
  const historyQuery = useQuery({
    queryKey: [...GENERATED_DOCUMENT_HISTORY_QUERY_KEY, 'system-document-history', documentType, visibleLimit, effectiveColumnFilters],
    queryFn: () => loadSystemDocumentHistory({
      type: documentType,
      limit: visibleLimit,
      columnFilters: effectiveColumnFilters,
    }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
  const documents = historyQuery.data?.documents ?? []
  const totalDocuments = historyQuery.data?.total ?? 0
  const filterOptions = historyQuery.data?.filterOptions ?? {}
  const visibleDocuments = useMemo(
    () => {
      if (!navigationDocumentIdentity) return documents
      return [...documents].sort((left, right) => {
        const leftMatch = getSystemDocumentNavigationIdentity(left) === navigationDocumentIdentity ? 1 : 0
        const rightMatch = getSystemDocumentNavigationIdentity(right) === navigationDocumentIdentity ? 1 : 0
        return rightMatch - leftMatch
      })
    },
    [documents, navigationDocumentIdentity],
  )
  const hasMoreDocuments = documents.length < totalDocuments
  const pageDocumentIds = useMemo(
    () => new Set(visibleDocuments.map((documentRecord) => documentRecord.id)),
    [visibleDocuments],
  )
  const selectedDocuments = useMemo(
    () => visibleDocuments.filter((documentRecord) => selectedDocumentIds.has(documentRecord.id)),
    [visibleDocuments, selectedDocumentIds],
  )
  const downloadableSelectedDocuments = selectedDocuments.filter((documentRecord) =>
    availableTemplateIds.has(getSystemDocumentTemplateId(documentRecord)),
  )
  const selectedPageCount = visibleDocuments.filter((documentRecord) =>
    selectedDocumentIds.has(documentRecord.id),
  ).length
  const allPageSelected = visibleDocuments.length > 0 && selectedPageCount === visibleDocuments.length
  const hasActiveFilters = hasDocumentHistoryFilters(columnFilters)
  const hasActiveHistoryScope = hasActiveFilters || (
    documentType === 'lnkConclusion' && lnkConclusionTemplateFilter !== 'all'
  )
  const showMethodColumn = documentType.startsWith('lnk')
  const historyFilters = showMethodColumn
    ? SYSTEM_DOCUMENT_FILTERS
    : SYSTEM_DOCUMENT_FILTERS.filter((filter) => filter.key !== 'method')
  const historyGridClassName = showMethodColumn
    ? 'grid-cols-[34px_minmax(240px,1fr)_96px_150px] xl:grid-cols-[34px_minmax(300px,1.45fr)_88px_96px_128px_150px] min-[1800px]:grid-cols-[34px_minmax(340px,1.55fr)_88px_minmax(130px,0.55fr)_minmax(120px,0.52fr)_minmax(150px,0.58fr)_96px_128px_150px]'
    : 'grid-cols-[34px_minmax(240px,1fr)_96px_150px] xl:grid-cols-[34px_minmax(300px,1.45fr)_96px_128px_150px] min-[1800px]:grid-cols-[34px_minmax(340px,1.55fr)_minmax(130px,0.55fr)_minmax(120px,0.52fr)_minmax(150px,0.58fr)_96px_128px_150px]'
  const historyError =
    historyQuery.error instanceof Error
      ? historyQuery.error.message
      : historyQuery.error
        ? 'Не удалось загрузить системные документы.'
        : null
  const hasTemplateForDocument = (documentRecord: SystemDocumentSummary) =>
    availableTemplateIds.has(getSystemDocumentTemplateId(documentRecord))

  const changeColumnFilter = (key: DocumentHistoryFilterKey, value: string) => {
    const nextFilters = { ...columnFilters }
    if (value) nextFilters[key] = value
    else delete nextFilters[key]
    setColumnFilters(nextFilters)
    if (documentType === 'lnkConclusion' && key === 'method') {
      setLnkConclusionTemplateFilter('all')
    }
    setVisibleLimit(pageSize === ALL_PAGE_SIZE ? Math.max(totalDocuments, 1) : pageSize)
  }

  const changePageSize = (nextPageSize: number) => {
    setPageSize(nextPageSize)
    setVisibleLimit(nextPageSize === ALL_PAGE_SIZE ? Math.max(totalDocuments, 1) : nextPageSize)
  }

  const loadMoreDocuments = () => {
    const increment = pageSize === ALL_PAGE_SIZE ? Math.max(totalDocuments, 1) : pageSize
    setVisibleLimit((current) => Math.min(totalDocuments || current + increment, current + increment))
  }

  const runAction = async (action: () => Promise<unknown> | void) => {
    setActionError(null)
    setActionNotice(null)
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

  const renameDocumentRecord = async (documentRecord: SystemDocumentSummary) => {
    if (
      !(await requireEditPassword(
        `переименование документа «${documentRecord.title}» по текущему системному правилу`,
      ))
    ) {
      return
    }
    const confirmed = await confirmAction({
      title: 'Привести к системному имени',
      itemName: documentRecord.title,
      description:
        'Название будет заново собрано по текущему правилу из настроек. Дата, состав стыков, виды контроля и результаты документа не изменятся.',
      warning:
        'Если документ раньше имел системное имя, его номер сохранится. Для пользовательского имени система выделит следующий номер этого типа документа.',
      confirmLabel: 'Переименовать',
      tone: 'warning',
    })
    if (!confirmed) return

    setRenamingDocumentId(documentRecord.id)
    await runAction(async () => {
      const result = await renameSystemDocumentToCurrentName(documentRecord)
      if (result.changed) await onRenamed()
      setActionNotice(
        result.changed
          ? `Документ переименован: «${result.previousName}» → «${result.nextName}».`
          : 'Название документа уже соответствует текущему системному правилу.',
      )
    })
    setRenamingDocumentId(null)
  }

  const openDocumentRecord = (documentRecord: SystemDocumentSummary) => runAction(() =>
    openSystemDocument({ reference: documentRecord, summary: documentRecord, welderStamps }),
  )
  const downloadDocumentRecord = (documentRecord: SystemDocumentSummary) => runAction(() =>
    downloadSystemDocument({ reference: documentRecord, summary: documentRecord, welderStamps }),
  )
  const toggleDocumentSelection = (documentId: string) => {
    setSelectedDocumentIds((current) => {
      const next = new Set(current)
      if (next.has(documentId)) next.delete(documentId)
      else next.add(documentId)
      return next
    })
  }
  const togglePageSelection = () => {
    setSelectedDocumentIds((current) => {
      const next = new Set(current)
      if (allPageSelected) {
        for (const id of pageDocumentIds) next.delete(id)
      } else {
        for (const id of pageDocumentIds) next.add(id)
      }
      return next
    })
  }
  const downloadSelectedArchive = async () => {
    if (downloadableSelectedDocuments.length === 0 || isDownloadingArchive) return
    setIsDownloadingArchive(true)
    await runAction(async () => {
      await downloadGeneratedDocumentArchive(
        downloadableSelectedDocuments.map((documentRecord) => ({
          record: {
            title: documentRecord.title,
            fileName: documentRecord.fileName,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
          createDocumentBlob: () =>
            createCurrentSystemDocumentBlob({
              reference: documentRecord,
              summary: documentRecord,
              welderStamps,
            }),
        })),
        makeDocumentsArchiveFileName(documentLabel),
      )
    })
    setIsDownloadingArchive(false)
  }

  useEffect(() => {
    setSelectedDocumentIds((current) => {
      const availableIds = new Set(visibleDocuments.map((documentRecord) => documentRecord.id))
      const next = new Set([...current].filter((id) => availableIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [visibleDocuments])

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-[#cbdde6] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {hasActiveFilters ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-[#d8e5eb] bg-[#f6fafc] px-4 py-2.5">
          <button
            type="button"
            onClick={() => {
              setColumnFilters({})
              setVisibleLimit(pageSize === ALL_PAGE_SIZE ? Math.max(totalDocuments, 1) : pageSize)
            }}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#cbdde6] bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <X className="h-3.5 w-3.5" />
            Сбросить фильтры
          </button>
        </div>
      ) : null}

      {documentType === 'lnkConclusion' ? (
        <div
          className="flex flex-wrap gap-2 border-b border-[#d8e5eb] bg-white px-4 py-3"
          role="tablist"
          aria-label="Вид заключения ЛНК"
        >
          <button
            type="button"
            role="tab"
            aria-selected={lnkConclusionTemplateFilter === 'all'}
            onClick={() => setLnkConclusionTemplateFilter('all')}
            className={`h-8 rounded-md border px-3 text-xs font-semibold transition-colors ${
              lnkConclusionTemplateFilter === 'all'
                ? 'border-[#17627d] bg-[#17627d] text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-800'
            }`}
          >
            Все
          </button>
          {LNK_CONCLUSION_TEMPLATE_PROFILES.map((profile) => {
            const isActive = lnkConclusionTemplateFilter === profile.id
            const methodOptionCounts = new Map((filterOptions.method ?? []).map((option) => [option.value, option.count]))
            const documentCount = getLnkConclusionTemplateMethodCodes(profile.id).reduce(
              (sum, methodCode) => sum + (methodOptionCounts.get(methodCode) ?? 0),
              0,
            )
            return (
              <button
                key={profile.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setLnkConclusionTemplateFilter(profile.id)
                  setColumnFilters((current) => {
                    if (!current.method) return current
                    const next = { ...current }
                    delete next.method
                    return next
                  })
                }}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition-colors ${
                  isActive
                    ? 'border-[#17627d] bg-[#17627d] text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-800'
                }`}
              >
                {profile.label}
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                  isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                }`}>
                  {documentCount}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}

      {historyError || actionError ? (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {historyError ?? actionError}
        </div>
      ) : null}
      {actionNotice ? (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {actionNotice}
        </div>
      ) : null}

      {historyQuery.isLoading ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">Загружаем актуальную историю...</div>
      ) : totalDocuments === 0 && !hasActiveHistoryScope ? (
        <div className="px-4 py-10 text-center">
          <div className="text-sm font-medium text-slate-700">Документов пока нет</div>
          <div className="mt-1 text-xs text-slate-500">
            Они появятся автоматически после создания соответствующих заявок или заключений.
          </div>
        </div>
      ) : totalDocuments === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">По выбранным условиям документы не найдены.</div>
      ) : (
        <div className="min-w-0">
          <div className={`grid items-center gap-x-4 gap-y-2 border-b border-[#cfdee6] bg-[#eaf2f6] px-4 py-2 text-[11px] font-semibold uppercase text-[#60778a] ${historyGridClassName}`}>
            <DocumentHistorySelectAllButton
              checked={allPageSelected}
              partial={selectedPageCount > 0 && !allPageSelected}
              disabled={visibleDocuments.length === 0}
              onClick={togglePageSelection}
            />
            {historyFilters.map((filter) => (
              <DocumentHistoryColumnFilter
                key={filter.key}
                label={filter.label}
                value={columnFilters[filter.key] ?? ''}
                options={filterOptions[filter.key] ?? []}
                className={filter.className}
                alignRight={filter.className?.includes('justify-end')}
                dateGrouped={filter.key === 'date'}
                onChange={(value) => changeColumnFilter(filter.key, value)}
              />
            ))}
            <div className="flex justify-end">
              {selectedDocuments.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 gap-1.5 px-2 text-[11px] normal-case"
                  disabled={downloadableSelectedDocuments.length === 0 || isDownloadingArchive}
                  onClick={() => void downloadSelectedArchive()}
                >
                  <Archive className="h-3.5 w-3.5" />
                  {isDownloadingArchive
                    ? 'Готовим'
                    : `Архив (${downloadableSelectedDocuments.length}/${selectedDocuments.length})`}
                </Button>
              ) : <span>Действия</span>}
            </div>
          </div>
          <div className="divide-y divide-[#dce7ed]">
            {visibleDocuments.map((documentRecord, documentIndex) => {
              const templateAvailable = hasTemplateForDocument(documentRecord)
              const isSelected = selectedDocumentIds.has(documentRecord.id)
              return (
                <div
                  key={documentRecord.id}
                  className={`grid min-w-0 items-center gap-x-4 gap-y-2 px-4 py-2.5 transition-colors hover:bg-[#e2f2f6] ${historyGridClassName} ${
                    getSystemDocumentNavigationIdentity(documentRecord) === navigationDocumentIdentity
                      ? 'bg-sky-50 ring-1 ring-inset ring-sky-300'
                      : isSelected
                        ? 'bg-sky-50 ring-1 ring-inset ring-sky-200'
                      : documentIndex % 2 === 0
                        ? 'bg-white'
                        : 'bg-[#f4f8fa]'
                  }`}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    const bulkItems = selectedDocumentIds.has(documentRecord.id) && selectedDocuments.length > 1
                      ? [
                          {
                            id: 'download-selected-archive',
                            label: `Скачать выбранные архивом (${downloadableSelectedDocuments.length}/${selectedDocuments.length})`,
                            icon: Archive,
                            disabled: downloadableSelectedDocuments.length === 0,
                            onSelect: () => downloadSelectedArchive(),
                          },
                          { type: 'separator' as const, id: 'bulk-separator' },
                        ]
                      : []
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      items: [
                        ...bulkItems,
                        { id: 'show-document-rows', label: 'Показать стыки в отчете', icon: Rows3, onSelect: () => runAction(() => onOpenRows(documentRecord)) },
                        { id: 'rename-document', label: 'Переименовать по текущему правилу', icon: FilePenLine, disabled: renamingDocumentId === documentRecord.id, onSelect: () => renameDocumentRecord(documentRecord) },
                        { type: 'separator', id: 'open-separator' },
                        { id: 'open-document', label: 'Открыть Excel', icon: ExternalLink, disabled: !templateAvailable, onSelect: () => openDocumentRecord(documentRecord) },
                        { id: 'download-document', label: 'Скачать Excel', icon: Download, disabled: !templateAvailable, onSelect: () => downloadDocumentRecord(documentRecord) },
                      ],
                    })
                  }}
                >
                  <DocumentHistoryRowCheckbox
                    checked={isSelected}
                    label={`Выбрать документ «${documentRecord.title}»`}
                    onChange={() => toggleDocumentSelection(documentRecord.id)}
                  />
                  <button
                    type="button"
                    className="group min-w-0 text-left disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!templateAvailable}
                    onClick={() => void openDocumentRecord(documentRecord)}
                    title={templateAvailable ? 'Сформировать актуальную версию и открыть Excel' : 'Для этого вида документа шаблон еще не загружен'}
                  >
                    <span className="flex min-w-0 items-start gap-2.5">
                      <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors ${
                        templateAvailable
                          ? 'border-[#c9dce5] bg-[#f4fafc] text-[#14779a] group-hover:border-[#9fc4d2] group-hover:bg-[#e9f5f8]'
                          : 'border-slate-200 bg-slate-50 text-slate-300'
                      }`}>
                        <FileSpreadsheet className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[13px] font-medium leading-5 text-slate-800 transition-colors group-hover:text-[#0b526c]">
                          {documentRecord.title}
                        </span>
                        <span className="mt-0.5 block break-words text-xs leading-4 text-slate-500 xl:hidden">
                          {documentRecord.methodCodes.join(', ') || documentLabel} · {formatDate(documentRecord.date)}
                        </span>
                      </span>
                    </span>
                  </button>
                  {showMethodColumn ? (
                    <span className="hidden truncate text-xs font-semibold text-slate-600 xl:block" title={documentRecord.methodCodes.join(', ')}>
                      {documentRecord.methodCodes.join(', ') || '-'}
                    </span>
                  ) : null}
                  <DocumentDimensionCell values={documentRecord.projects} />
                  <DocumentDimensionCell values={documentRecord.subtitleCodes} />
                  <span className="hidden truncate text-xs text-slate-600 min-[1800px]:block" title={documentRecord.lines.join(', ')}>{documentRecord.lines.join(', ') || '-'}</span>
                  <span className="text-right text-sm font-semibold tabular-nums text-slate-800">{documentRecord.rowCount}</span>
                  <span className="hidden text-xs text-slate-600 xl:block">{formatDate(documentRecord.date) || '-'}</span>
                  <div className="flex items-center justify-end gap-1">
                    <DocumentHistoryActionButton
                      title={`Показать стыки документа в отчете ${getSystemDocumentTargetReport(documentRecord.type) === 'lnk' ? 'ЛНК' : 'ПСТО'}`}
                      tone="emerald"
                      onClick={() => void runAction(() => onOpenRows(documentRecord))}
                    ><Rows3 className="h-4 w-4" /></DocumentHistoryActionButton>
                    <DocumentHistoryActionButton
                      title="Переименовать по текущему системному правилу"
                      tone="violet"
                      disabled={renamingDocumentId === documentRecord.id}
                      onClick={() => void renameDocumentRecord(documentRecord)}
                    ><FilePenLine className="h-4 w-4" /></DocumentHistoryActionButton>
                    <DocumentHistoryActionButton
                      title={templateAvailable ? 'Открыть актуальный Excel' : 'Для этого вида документа шаблон еще не загружен'}
                      tone="sky"
                      disabled={!templateAvailable}
                      onClick={() => void openDocumentRecord(documentRecord)}
                    ><ExternalLink className="h-4 w-4" /></DocumentHistoryActionButton>
                    <DocumentHistoryActionButton
                      title={templateAvailable ? 'Скачать актуальный Excel' : 'Для этого вида документа шаблон еще не загружен'}
                      disabled={!templateAvailable}
                      onClick={() => void downloadDocumentRecord(documentRecord)}
                    ><Download className="h-4 w-4" /></DocumentHistoryActionButton>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      <div className="border-t border-[#dbe6ec] bg-[#f4f8fa] px-4 py-2">
        <PaginationBar
          totalCount={totalDocuments}
          firstItemNumber={visibleDocuments.length === 0 ? 0 : 1}
          lastItemNumber={visibleDocuments.length}
          pageSize={pageSize}
          hasMore={hasMoreDocuments}
          label="документов"
          onLoadMore={loadMoreDocuments}
          onPageSizeChange={changePageSize}
        />
        <div className="mt-2 text-xs text-slate-500">
          Найдено: {totalDocuments}
          {selectedDocuments.length > 0 ? ` · выбрано: ${selectedDocuments.length}` : ''}
        </div>
      </div>
      <ContextActionMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </section>
  )
}

function formatGeneratedDocumentDate(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
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
    <span className="hidden truncate text-xs text-slate-600 min-[1800px]:block" title={text}>
      {text}
    </span>
  )
}

function DocumentHistorySelectAllButton({
  checked,
  partial,
  disabled,
  onClick,
}: {
  checked: boolean
  partial: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={checked ? 'Снять выбор с показанных документов' : 'Выбрать показанные документы'}
      aria-label={checked ? 'Снять выбор с показанных документов' : 'Выбрать показанные документы'}
      aria-pressed={checked}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        checked || partial
          ? 'border-sky-300 bg-sky-100 text-sky-800'
          : 'border-slate-300 bg-white text-transparent hover:border-sky-300 hover:bg-sky-50 hover:text-sky-500'
      }`}
    >
      {partial ? <Minus className="h-4 w-4" /> : <Check className="h-4 w-4" />}
    </button>
  )
}

function DocumentHistoryRowCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border shadow-sm transition-colors ${
        checked
          ? 'border-sky-300 bg-sky-100 text-sky-800'
          : 'border-slate-300 bg-white text-transparent hover:border-sky-300 hover:bg-sky-50 hover:text-sky-500'
      }`}
      aria-label={label}
      aria-pressed={checked}
      title={label}
      onClick={onChange}
    >
      <Check className="h-4 w-4" />
    </button>
  )
}

function DocumentHistoryColumnFilter({
  label,
  value,
  options,
  className = '',
  alignRight = false,
  dateGrouped = false,
  onChange,
}: {
  label: string
  value: string
  options: DocumentHistoryColumnOption[]
  className?: string
  alignRight?: boolean
  dateGrouped?: boolean
  onChange: (value: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [optionSearch, setOptionSearch] = useState('')
  const choiceFilter = parseWeldColumnChoiceFilter(value)
  const selectedValues = choiceFilter?.kind === 'values' ? choiceFilter.values : []
  const hasActiveFilter = Boolean(value.trim())
  const normalizedSearch = optionSearch.trim().toLocaleLowerCase('ru-RU')
  const visibleOptions = normalizedSearch
    ? options.filter((option) => option.label.toLocaleLowerCase('ru-RU').includes(normalizedSearch))
    : options

  const toggleValue = (optionValue: string) => {
    const selectedSet = new Set(selectedValues)
    if (selectedSet.has(optionValue)) selectedSet.delete(optionValue)
    else selectedSet.add(optionValue)
    onChange(selectedSet.size > 0 ? buildWeldColumnValueFilter(Array.from(selectedSet)) : '')
  }

  useEffect(() => {
    if (!isOpen) return
    const close = () => setIsOpen(false)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  return (
    <span className={`relative flex min-w-0 ${alignRight ? 'justify-end' : ''} ${className}`}>
      <button
        type="button"
        onClick={() => {
          setIsOpen((current) => !current)
          setOptionSearch('')
        }}
        className={`inline-flex h-8 max-w-full items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold uppercase transition ${
          hasActiveFilter || isOpen
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-[#60778a] hover:bg-white/60 hover:text-slate-800'
        }`}
        title={hasActiveFilter ? `${label}: ${getDocumentHistoryFilterSummary(value)}` : `Фильтр: ${label}`}
      >
        <span className="min-w-0 truncate">{label}</span>
        <span className={`inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded border border-[#bdd4df] bg-white px-1 text-sky-700 ${
          hasActiveFilter ? '' : 'text-slate-400'
        }`}>
          <ListFilter className="h-3.5 w-3.5" />
          {hasActiveFilter ? <span>{getDocumentHistoryFilterCount(value)}</span> : null}
        </span>
      </button>

      {isOpen ? (
        <div className={`absolute top-9 z-50 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white text-left normal-case shadow-xl shadow-slate-300/40 ${
          alignRight ? 'right-0' : 'left-0'
        }`}>
          <div className="border-b border-slate-100 bg-slate-50 px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-800">{label}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {hasActiveFilter ? `Активно: ${getDocumentHistoryFilterSummary(value)}` : `Значений: ${options.length}`}
                </div>
              </div>
              <button type="button" className="text-xs text-slate-500 hover:text-slate-900" onClick={() => setIsOpen(false)}>
                Закрыть
              </button>
            </div>
          </div>
          <div className="p-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={optionSearch}
                onChange={(event) => setOptionSearch(event.target.value)}
                placeholder="Найти значение"
                className="h-8 w-full rounded-md border border-slate-200 bg-white py-1 pl-8 pr-2 text-xs text-slate-900 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                onClick={() => onChange(buildWeldColumnValueFilter(options.map((option) => option.value)))}
              >
                Выбрать все
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                onClick={() => onChange('')}
              >
                Очистить
              </button>
            </div>
          </div>
          <div className="max-h-60 overflow-auto border-t border-slate-100">
            {dateGrouped ? (
              <DocumentDateFilterOptions
                options={visibleOptions}
                selectedValues={selectedValues}
                onToggleValue={toggleValue}
                onToggleValues={(values) => {
                  const selectedSet = new Set(selectedValues)
                  const hasEveryValue = values.every((optionValue) => selectedSet.has(optionValue))
                  for (const optionValue of values) {
                    if (hasEveryValue) selectedSet.delete(optionValue)
                    else selectedSet.add(optionValue)
                  }
                  onChange(selectedSet.size > 0 ? buildWeldColumnValueFilter(Array.from(selectedSet)) : '')
                }}
              />
            ) : visibleOptions.length > 0 ? (
              visibleOptions.map((option) => {
                const checked = selectedValues.includes(option.value)
                return (
                  <button
                    key={option.value || '__empty__'}
                    type="button"
                    onClick={() => toggleValue(option.value)}
                    className={`flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-slate-50 ${
                      checked ? 'bg-sky-50/80 text-slate-900' : 'text-slate-700'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 bg-white'
                      }`}
                    >
                      {checked ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate" title={option.label}>{option.label}</span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{option.count}</span>
                  </button>
                )
              })
            ) : (
              <div className="px-3 py-6 text-center text-xs text-slate-500">Значений не найдено</div>
            )}
          </div>
        </div>
      ) : null}
    </span>
  )
}

function DocumentDateFilterOptions({
  options,
  selectedValues,
  onToggleValue,
  onToggleValues,
}: {
  options: DocumentHistoryColumnOption[]
  selectedValues: string[]
  onToggleValue: (value: string) => void
  onToggleValues: (values: string[]) => void
}) {
  const groups = getDocumentDateFilterGroups(options)
  if (groups.length === 0) {
    return <div className="px-3 py-6 text-center text-xs text-slate-500">Дат не найдено</div>
  }

  return (
    <div className="divide-y divide-slate-100">
      {groups.map((group) =>
        group.kind === 'empty' ? (
          <DocumentFilterValueRow
            key="empty"
            label={group.label}
            count={group.count}
            checked={selectedValues.includes(group.value)}
            onClick={() => onToggleValue(group.value)}
          />
        ) : (
          <div key={group.year} className="py-1">
            <button
              type="button"
              onClick={() => onToggleValues(group.values)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <DocumentGroupFilterCheck values={group.values} selectedValues={selectedValues} />
              <span className="min-w-0 flex-1">{group.year}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{group.count}</span>
            </button>
            {group.months.map((month) => (
              <div key={`${group.year}-${month.month}`} className="pb-1">
                <button
                  type="button"
                  onClick={() => onToggleValues(month.values)}
                  className="flex w-full items-center gap-2 px-6 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50"
                >
                  <DocumentGroupFilterCheck values={month.values} selectedValues={selectedValues} />
                  <span className="min-w-0 flex-1">{month.label}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{month.count}</span>
                </button>
                {month.options.map((option) => (
                  <DocumentFilterValueRow
                    key={option.value || '__empty__'}
                    label={option.label}
                    count={option.count}
                    checked={selectedValues.includes(option.value)}
                    onClick={() => onToggleValue(option.value)}
                    className="pl-9"
                  />
                ))}
              </div>
            ))}
          </div>
        ),
      )}
    </div>
  )
}

function DocumentGroupFilterCheck({
  values,
  selectedValues,
}: {
  values: string[]
  selectedValues: string[]
}) {
  const selectedSet = new Set(selectedValues)
  const checkedCount = values.filter((value) => selectedSet.has(value)).length
  const checked = values.length > 0 && checkedCount === values.length
  const partial = checkedCount > 0 && !checked
  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
        checked ? 'border-sky-500 bg-sky-500 text-white' : partial ? 'border-sky-300 bg-sky-50 text-sky-500' : 'border-slate-300 bg-white text-transparent'
      }`}
    >
      {checked ? <Check className="h-3 w-3" /> : partial ? <span className="h-0.5 w-2 rounded-full bg-current" /> : null}
    </span>
  )
}

function DocumentFilterValueRow({
  label,
  count,
  checked,
  onClick,
  className = '',
}: {
  label: string
  count: number
  checked: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-slate-50 ${
        checked ? 'bg-sky-50/80 text-slate-900' : 'text-slate-700'
      } ${className}`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          checked ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 bg-white'
        }`}
      >
        {checked ? <Check className="h-3 w-3" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{count}</span>
    </button>
  )
}

function getDocumentDateFilterGroups(options: DocumentHistoryColumnOption[]) {
  const emptyOptions = options.filter((option) => !parseDocumentFilterDateKey(option.value))
  const dateOptions = options
    .map((option) => ({ option, iso: parseDocumentFilterDateKey(option.value) }))
    .filter((item): item is { option: DocumentHistoryColumnOption; iso: string } => Boolean(item.iso))
    .sort((left, right) => right.iso.localeCompare(left.iso))

  const yearGroups = new Map<string, Map<string, DocumentHistoryColumnOption[]>>()
  for (const item of dateOptions) {
    const [year, month] = item.iso.split('-')
    if (!year || !month) continue
    if (!yearGroups.has(year)) yearGroups.set(year, new Map())
    const months = yearGroups.get(year)!
    if (!months.has(month)) months.set(month, [])
    months.get(month)!.push(item.option)
  }

  const groups: Array<
    | { kind: 'empty'; value: string; label: string; count: number }
    | {
        kind: 'year'
        year: string
        count: number
        values: string[]
        months: Array<{
          month: string
          label: string
          count: number
          values: string[]
          options: DocumentHistoryColumnOption[]
        }>
      }
  > = []

  if (emptyOptions.length > 0) {
    groups.push({
      kind: 'empty',
      value: '',
      label: '(пусто)',
      count: emptyOptions.reduce((sum, option) => sum + option.count, 0),
    })
  }

  for (const [year, months] of [...yearGroups.entries()].sort((left, right) => right[0].localeCompare(left[0]))) {
    const monthGroups = [...months.entries()]
      .sort((left, right) => right[0].localeCompare(left[0]))
      .map(([month, monthOptions]) => ({
        month,
        label: formatDocumentFilterMonth(year, month),
        count: monthOptions.reduce((sum, option) => sum + option.count, 0),
        values: monthOptions.map((option) => option.value),
        options: monthOptions,
      }))
    groups.push({
      kind: 'year',
      year,
      count: monthGroups.reduce((sum, month) => sum + month.count, 0),
      values: monthGroups.flatMap((month) => month.values),
      months: monthGroups,
    })
  }

  return groups
}

function parseDocumentFilterDateKey(value: string) {
  const match = String(value ?? '').match(/(\d{2})\.(\d{2})\.(\d{4})/)
  if (!match) return null
  return `${match[3]}-${match[2]}-${match[1]}`
}

function formatDocumentFilterMonth(year: string, month: string) {
  const parsed = new Date(Number(year), Number(month) - 1, 1)
  return parsed.toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric',
  })
}

function DocumentHistoryActionButton({
  title,
  tone = 'neutral',
  disabled = false,
  onClick,
  children,
}: {
  title: string
  tone?: 'neutral' | 'emerald' | 'sky' | 'violet' | 'rose'
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const toneClass = {
    neutral: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    sky: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100',
    violet: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100',
    rose: 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700',
  }[tone]

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300 ${toneClass}`}
    >
      {children}
    </button>
  )
}

function formatWdi(value: number | undefined) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0)
}

function formatDocumentDimensions(documentRecord: {
  projects: string[]
  subtitleCodes: string[]
  lines: string[]
}) {
  return [
    documentRecord.projects.length > 0 ? `Проект: ${documentRecord.projects.join(', ')}` : '',
    documentRecord.subtitleCodes.length > 0 ? `Шифр: ${documentRecord.subtitleCodes.join(', ')}` : '',
    documentRecord.lines.length > 0 ? `Линия: ${documentRecord.lines.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ') || 'Проект, шифр и линия не указаны'
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

function CompactMetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-xl font-semibold leading-none tabular-nums text-slate-900" title={String(value)}>{value}</div>
    </div>
  )
}
