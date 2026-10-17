import { DocumentSpecialistCell, DocumentSpecialistAssignmentDialog, type SpecialistDocument } from './document-specialist-assignment'
import { specialistHistoryColumns } from '@/lib/document-history-columns'
import { getSpecialistDocumentProfile } from '@/lib/document-specialists'
import {
  type CSSProperties,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  Copy,
  ChevronDown,
  Download,
  FilePenLine,
  FileSpreadsheet,
  FileText,
  GitBranch,
  Maximize2,
  Minimize2,
  Merge,
  Archive,
  PanelLeftClose,
  PanelLeftOpen,
  Rows3,
  Search,
  SlidersHorizontal,
  Trash2,
  UsersRound,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { ContextActionMenu, type ContextActionMenuItem, type ContextActionMenuState } from '@/components/context-action-menu'
import type { DocumentOperationRequest } from '@/lib/system-document-operation'
import { DocumentsHistoryGrid } from '@/components/documents-history-grid'
import { useDocumentGridController } from '@/lib/use-document-grid-controller'
import type { DocumentHistoryGridRequest } from '@/lib/document-history-grid'
import { HistoryDocumentPreview, type HistoryDocumentPreviewRequest } from '@/components/history-document-preview'
import { ReportNotificationToast } from '@/components/report-notification-toast'
import { Button } from '@/components/ui/button'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { isModalDialogOpen } from '@/lib/modal-layer'
import { useSecurityGuard } from '@/lib/security-context'
import type { WeldRow } from '@/lib/dispatcher-types'
import type {
  DocumentNavigationRequest,
  GeneratedDocumentNavigationRequest,
} from '@/lib/document-navigation'
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
  loadGeneratedDocumentHistoryGrid,
  loadGeneratedDocumentHistoryFilterOptions,
  loadGeneratedDocumentRows,
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
  isManualGeneratedDocumentType,
  type GeneratedDocumentType,
  type ManualGeneratedDocumentType,
} from '@/lib/generated-document-types'
import {
  LAYERED_CONTROL_DOCUMENT_VIEWS,
  type LayeredControlDocumentViewId,
} from '@/lib/layered-control-documents'
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
  loadSystemDocumentHistoryGrid,
  loadSystemDocumentHistoryFilterOptions,
  loadSystemDocumentRows,
  createSystemDocumentPreviewRecord,
} from '@/lib/system-document-storage'
import {
  getSystemDocumentTargetReport,
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
import { DocumentOperationDialog } from '@/components/document-operation-dialog'
import {
  SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY,
} from '@/lib/system-document-sequence-storage'
import {
  GENERATED_DOCUMENT_HISTORY_QUERY_KEY,
  scheduleWeldDataRefresh,
  WELD_JOINTS_QUERY_KEY,
} from '@/lib/weld-query-utils'
import { getDocumentGenerationData } from '@/server/weld-read-api'
import { buildWeldColumnValueFilter, parseWeldColumnChoiceFilter } from '@/lib/weld-table-filtering'
import {
  DOCUMENT_HISTORY_COLUMNS_STORAGE_KEY,
  GENERATED_DOCUMENT_HISTORY_COLUMNS,
  LAYERED_GENERATED_DOCUMENT_HISTORY_COLUMNS,
  SYSTEM_DOCUMENT_HISTORY_COLUMNS,
  getVisibleDocumentHistoryColumns,
  parseDocumentHistoryColumnPreferences,
  type DocumentHistoryColumnDefinition,
  type DocumentHistoryColumnKey,
  type DocumentHistoryColumnPreferences,
} from '@/lib/document-history-columns'
import {
  useDocumentHistorySessionValue,
} from '@/lib/use-document-history-session-state'
import {
  getScopedSystemDocumentHistoryFilterOptions,
  getScopedSystemDocumentMethodValues,
  getScopedSystemDocumentStageValues,
  getSystemDocumentMethodCodes,
  getSystemDocumentStageClassName,
  getSystemDocumentStageLabel,
  type SystemDocumentMethodScope,
} from '@/lib/system-document-stage'
import { useDocumentEscapeKey } from '@/lib/use-document-escape-key'

type DocumentsPageProps = {
  welderStamps: WelderStampRecord[]
  initialDocumentType?: DocumentsPageType
  onDocumentTypeChange?: (documentType: DocumentsPageType) => void
  navigationRequest?: DocumentNavigationRequest | null
  onNavigationRequestHandled?: (requestId: number) => void
  onOpenDocumentRows?: (
    rowIds: number[],
    documentTitle: string,
    targetReport?: 'weldingJournal' | 'lnk' | 'heatTreatment',
  ) => void
  onOpenJointHistory?: (rowId: number) => void
}

const DOCUMENT_PREVIEW_ROW_LIMIT = 3
const DOCUMENT_PREVIEW_SCALE = 1.2
const DOCUMENT_PREVIEW_MIN_SCALE = 0.45
const DOCUMENT_PREVIEW_MAX_SCALE = 1.8
const DOCUMENT_PREVIEW_SCALE_STEP = 0.15
const DOCUMENT_PARAMETERS_COLLAPSED_STORAGE_KEY = 'welding-journal:documents:parameters-collapsed'

const DOCUMENT_TYPE_OPTIONS: Array<{
  type: ManualGeneratedDocumentType
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

type SystemDocumentViewId =
  | SystemDocumentType
  | 'tvmtRequest'
  | 'tvmtConclusion'

const SYSTEM_DOCUMENT_TYPE_OPTIONS: Array<{
  id: SystemDocumentViewId
  documentType: SystemDocumentType
  label: string
  methodScope: SystemDocumentMethodScope
}> = [
  { id: 'lnkRequest', documentType: 'lnkRequest', label: 'Заявка ЛНК', methodScope: 'lnk' },
  { id: 'lnkConclusion', documentType: 'lnkConclusion', label: 'Заключения ЛНК', methodScope: 'lnk' },
  { id: 'pstoRequest', documentType: 'pstoRequest', label: 'Заявка ПСТО', methodScope: null },
  { id: 'pstoConclusion', documentType: 'pstoConclusion', label: 'Заключение ПСТО', methodScope: null },
  { id: 'tvmtRequest', documentType: 'lnkRequest', label: 'Заявка ТВМТ', methodScope: 'tvmt' },
  { id: 'tvmtConclusion', documentType: 'lnkConclusion', label: 'Заключение ТВМТ', methodScope: 'tvmt' },
]

function DocumentTypeGroupLabel({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1 inline-flex h-9 shrink-0 items-center border-l border-[#cbdde6] pl-4 text-[11px] font-semibold uppercase text-[#60778a] first:ml-0 first:border-l-0 first:pl-0">
      {children}
    </span>
  )
}

export type DocumentsPageType = ManualGeneratedDocumentType | SystemDocumentViewId | LayeredControlDocumentViewId
type DocumentHistoryFilterKey = DocumentHistoryColumnKey

function getDocumentHistoryFiltersWithoutKey(
  filters: Record<string, string>,
  key: DocumentHistoryFilterKey,
) {
  const next = { ...filters }
  delete next[key]
  return next
}

export function getDocumentActionErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  const message = error.message.trim()
  return message && !/Failed query:/i.test(message) ? message : fallback
}

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
  documentRecord: Pick<SystemDocumentSummary, 'type' | 'title' | 'date' | 'methodCode'> & {
    documentId?: number
  },
) {
  if (documentRecord.documentId) return `document:${documentRecord.documentId}`
  return JSON.stringify([
    documentRecord.type,
    documentRecord.title.trim(),
    documentRecord.date.trim().slice(0, 10),
    documentRecord.type === 'lnkRequest' ? '' : documentRecord.methodCode?.trim() ?? '',
  ])
}

export function getDocumentNavigationViewId(
  reference: DocumentNavigationRequest,
): DocumentsPageType {
  if (reference.kind === 'generated') {
    if (isManualGeneratedDocumentType(reference.type)) return reference.type
    return LAYERED_CONTROL_DOCUMENT_VIEWS.find((view) =>
      (view.types as readonly GeneratedDocumentType[]).includes(reference.type),
    )?.id
      ?? 'weldingJournal'
  }
  return getSystemDocumentViewId(reference)
}

export function getDocumentNavigationColumnFilters(
  reference: Pick<DocumentNavigationRequest, 'title'>,
) {
  return { title: buildWeldColumnValueFilter([reference.title]) }
}

function getSystemDocumentViewId(
  reference: Pick<SystemDocumentNavigationRequest, 'type' | 'methodCode'>,
): SystemDocumentViewId {
  if (reference.methodCode === 'ТВМТ') {
    if (reference.type === 'lnkRequest') return 'tvmtRequest'
    if (reference.type === 'lnkConclusion') return 'tvmtConclusion'
  }
  return reference.type
}

function intersectChoiceFilterValues(filterValue: string | undefined, allowedValues: string[]) {
  const choiceFilter = parseWeldColumnChoiceFilter(filterValue ?? '')
  if (choiceFilter?.kind !== 'values') return allowedValues
  const requestedValues = new Set(choiceFilter.values)
  return allowedValues.filter((value) => requestedValues.has(value))
}

type LnkConclusionTemplateFilter = 'all' | LnkConclusionTemplateId

function isLnkConclusionTemplateFilter(value: unknown): value is LnkConclusionTemplateFilter {
  return value === 'all' || LNK_CONCLUSION_TEMPLATE_PROFILES.some((profile) => profile.id === value)
}

export function DocumentsPage({
  welderStamps,
  initialDocumentType,
  onDocumentTypeChange,
  navigationRequest,
  onNavigationRequestHandled,
  onOpenDocumentRows,
  onOpenJointHistory,
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
    useState<DocumentNavigationRequest | null>(navigationRequest ?? null)
  const [activeDocumentType, setActiveDocumentType] = useState<DocumentsPageType>(
    () => navigationRequest
      ? getDocumentNavigationViewId(navigationRequest)
      : initialDocumentType ?? 'weldingJournal',
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
  const [historyColumnPreferences] =
    useState<DocumentHistoryColumnPreferences>(() => {
      if (typeof window === 'undefined') return {}
      try {
        return parseDocumentHistoryColumnPreferences(
          window.localStorage.getItem(DOCUMENT_HISTORY_COLUMNS_STORAGE_KEY),
        )
      } catch {
        return {}
      }
    })
  const activeSystemDocumentOption = SYSTEM_DOCUMENT_TYPE_OPTIONS.find(
    (option) => option.id === activeDocumentType,
  )
  const activeLayeredDocumentView = LAYERED_CONTROL_DOCUMENT_VIEWS.find(
    (view) => view.id === activeDocumentType,
  )
  const isSystemDocument = Boolean(activeSystemDocumentOption)
  const isLayeredDocumentView = Boolean(activeLayeredDocumentView)
  const isManualGeneratedDocumentView = !isSystemDocument && !isLayeredDocumentView
  useDocumentEscapeKey({
    enabled: isManualGeneratedDocumentView && activeWorkspaceTab === 'generation' && !isGenerating && !isPreviewFullscreen,
    hasFilters: Boolean(selectedProjects.length || selectedSubtitles.length || selectedLines.length),
    onClearFilters: () => { setSelectedProjects([]); setSelectedSubtitles([]); setSelectedLines([]) },
  })
  const availableHistoryColumns = useMemo(
    () => {
      if (activeLayeredDocumentView) return [...LAYERED_GENERATED_DOCUMENT_HISTORY_COLUMNS, ...specialistHistoryColumns()]
      if (!activeSystemDocumentOption) return [...GENERATED_DOCUMENT_HISTORY_COLUMNS]
      const showMethodColumn = activeSystemDocumentOption.documentType.startsWith('lnk')
        && activeSystemDocumentOption.methodScope !== 'tvmt'
      return [...SYSTEM_DOCUMENT_HISTORY_COLUMNS.filter(
        (column) => showMethodColumn || column.key !== 'method',
      ), ...(activeSystemDocumentOption.documentType.endsWith('Conclusion') ? specialistHistoryColumns(activeSystemDocumentOption.documentType === 'pstoConclusion') : [])]
    }, [activeLayeredDocumentView, activeSystemDocumentOption],
  )
  const visibleHistoryColumns = useMemo(
    () => getVisibleDocumentHistoryColumns({
      viewId: activeDocumentType,
      availableColumns: availableHistoryColumns,
      preferences: historyColumnPreferences,
    }),
    [activeDocumentType, availableHistoryColumns, historyColumnPreferences],
  )
  const visibleHistoryColumnKeys = useMemo(
    () => visibleHistoryColumns.map((column) => column.key),
    [visibleHistoryColumns],
  )
  const availableSystemDocumentTemplates = useSystemDocumentTemplateAvailability()
  const activeGeneratedDocumentType: ManualGeneratedDocumentType = isManualGeneratedDocumentType(activeDocumentType)
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
    enabled: isManualGeneratedDocumentView && activeWorkspaceTab === 'generation',
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const rows = generationDataQuery.data?.rows ?? []

  useEffect(() => {
    onDocumentTypeChange?.(activeDocumentType)
  }, [activeDocumentType, onDocumentTypeChange])

  useEffect(() => {
    if (!navigationRequest) return
    setActiveNavigationRequest(navigationRequest)
    setActiveDocumentType(getDocumentNavigationViewId(navigationRequest))
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
    if (!isManualGeneratedDocumentView) {
      setActiveDocumentTemplate(null)
      return () => {
        isMounted = false
      }
    }
    const syncTemplate = () => {
      loadDocumentTemplate(activeGeneratedDocumentType)
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
  }, [activeGeneratedDocumentType, isManualGeneratedDocumentView])

  useEffect(() => {
    const handleGeneratedDocumentChange = () => {
      scheduleWeldDataRefresh(queryClient)
    }

    window.addEventListener(GENERATED_DOCUMENT_STORAGE_EVENT, handleGeneratedDocumentChange)
    return () => {
      window.removeEventListener(GENERATED_DOCUMENT_STORAGE_EVENT, handleGeneratedDocumentChange)
    }
  }, [queryClient])

  const journalRows = useMemo(
    () => {
      if (!isManualGeneratedDocumentView) return []
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
      isManualGeneratedDocumentView,
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
    if (!isManualGeneratedDocumentView || !activeDocumentTemplate || previewRows.length === 0) {
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
        setTemplatePreviewError(getDocumentActionErrorMessage(
          error,
          'Не удалось сформировать предпросмотр документа.',
        ))
      })
      .finally(() => {
        if (isActive) setIsTemplatePreviewLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [activeDocumentTemplate, isManualGeneratedDocumentView, previewRows, welderStamps])

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
        text: getDocumentActionErrorMessage(
          error,
          `Не удалось сформировать ${activeDocumentProfile.label}.`,
        ),
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
    <div className="w-full min-w-0 space-y-5">
      <div data-documents-navigation className="sticky top-0 z-30 space-y-2 rounded-xl border border-[#cfdee6] bg-[#f4f8fa]/95 p-3 shadow-sm backdrop-blur-sm">
      <div className="min-w-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
            <DocumentTypeGroupLabel>Общие</DocumentTypeGroupLabel>
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
                className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'border-sky-100 bg-sky-50 text-sky-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700'
                }`}
              >
                {option.label}
              </button>
            )
            })}
            <DocumentTypeGroupLabel>ЛНК</DocumentTypeGroupLabel>
            {SYSTEM_DOCUMENT_TYPE_OPTIONS.filter((option) => option.methodScope === 'lnk').map((option) => (
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
                className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                  activeDocumentType === option.id
                    ? 'border-sky-100 bg-sky-50 text-sky-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700'
                }`}
              >
                {option.label}
              </button>
            ))}
            <DocumentTypeGroupLabel>ПСТО и ТВМТ</DocumentTypeGroupLabel>
            {SYSTEM_DOCUMENT_TYPE_OPTIONS.filter((option) => option.methodScope !== 'lnk').map((option) => (
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
                className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                  activeDocumentType === option.id
                    ? 'border-sky-100 bg-sky-50 text-sky-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700'
                }`}
              >
                {option.label}
              </button>
            ))}
            <DocumentTypeGroupLabel>Послойный контроль</DocumentTypeGroupLabel>
            {LAYERED_CONTROL_DOCUMENT_VIEWS.map((view) => (
              <button
                key={view.id}
                type="button"
                onClick={() => {
                  setActiveNavigationRequest(null)
                  setActiveDocumentType(view.id)
                  setActiveWorkspaceTab('history')
                  setTemplateDocumentPreview(null)
                  setTemplatePreviewError(null)
                }}
                className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                  activeDocumentType === view.id
                    ? 'border-sky-100 bg-sky-50 text-sky-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700'
                }`}
              >
                {view.label}
              </button>
            ))}
          </div>

        </div>
      </div>

      {isManualGeneratedDocumentView ? (
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
            className={`inline-flex h-10 min-w-36 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition ${
              activeWorkspaceTab === 'history'
                ? 'bg-sky-50 text-sky-700'
                : 'text-slate-600 hover:bg-sky-50 hover:text-sky-700'
            }`}
          >
            <FileText className="h-4 w-4" />
            История
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeWorkspaceTab === 'generation'}
            onClick={() => setActiveWorkspaceTab('generation')}
            className={`inline-flex h-10 min-w-36 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition ${
              activeWorkspaceTab === 'generation'
                ? 'bg-sky-50 text-sky-700'
                : 'text-slate-600 hover:bg-sky-50 hover:text-sky-700'
            }`}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Формирование
          </button>
        </div>
      ) : null}

      </div>

      {isManualGeneratedDocumentView && activeWorkspaceTab === 'generation' ? (
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
                className="h-10 gap-2 px-4 sm:min-w-40"
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

      <ReportNotificationToast
        message={generationNotice?.text}
        tone={generationNotice?.tone}
        onDismiss={() => setGenerationNotice(null)}
      />

      {isSystemDocument || isLayeredDocumentView || activeWorkspaceTab === 'history' ? (
        isSystemDocument ? (
          <SystemDocumentsPanel
            key={activeDocumentType}
            documentLabel={activeSystemDocumentOption!.label}
            documentType={activeSystemDocumentOption!.documentType}
            methodScope={activeSystemDocumentOption!.methodScope}
            navigationRequest={
              activeNavigationRequest?.kind === 'system'
                && activeNavigationRequest.type === activeSystemDocumentOption!.documentType
                ? activeNavigationRequest
                : null
            }
            availableTemplateIds={availableSystemDocumentTemplates}
            columns={availableHistoryColumns}
            initialVisibleColumnKeys={visibleHistoryColumnKeys}
            welderStamps={welderStamps}
            onOpenRows={async (documentRecord) => {
              const documentRows = await loadSystemDocumentRows(documentRecord)
              if (documentRows.length === 0) throw new Error('В документе больше нет стыков.')
              onOpenDocumentRows?.(
                documentRows.map((row) => row.id),
                documentRecord.title,
                getSystemDocumentTargetReport(documentRecord),
              )
            }}
            onOpenJointHistory={async (documentRecord) => {
              const documentRows = await loadSystemDocumentRows(documentRecord)
              if (documentRows.length !== 1) throw new Error('Картина стыка доступна для документа с одним стыком.')
              onOpenJointHistory?.(documentRows[0].id)
            }}
            onRenamed={async (savedRows) => {
              scheduleWeldDataRefresh(
                queryClient,
                savedRows ? { upsertRows: savedRows } : undefined,
              )
              // The shared refresh already invalidates active document history.
              await queryClient.invalidateQueries({ queryKey: SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY })
            }}
          />
        ) : activeLayeredDocumentView ? (
          <GeneratedDocumentsPanel
            key={activeLayeredDocumentView.id}
            documentType={activeLayeredDocumentView.types[0]}
            documentTypes={activeLayeredDocumentView.types}
            documentLabel={activeLayeredDocumentView.label}
            documentFieldLabel={activeLayeredDocumentView.label}
            columns={availableHistoryColumns}
            initialVisibleColumnKeys={visibleHistoryColumnKeys}
            navigationRequest={
              activeNavigationRequest?.kind === 'generated'
                && (activeLayeredDocumentView.types as readonly GeneratedDocumentType[])
                  .includes(activeNavigationRequest.type)
                ? activeNavigationRequest
                : null
            }
            allowDelete={false}
            singleDate
            onOpenRows={async (documentRecord) => {
              const documentRows = await loadGeneratedDocumentRows(documentRecord.id)
              if (documentRows.length === 0) throw new Error('В документе больше нет стыков.')
              onOpenDocumentRows?.(
                documentRows.map((row) => row.id),
                documentRecord.title,
                'lnk',
              )
            }}
            onOpenJointHistory={async (documentRecord) => {
              const documentRows = await loadGeneratedDocumentRows(documentRecord.id)
              if (documentRows.length !== 1) throw new Error('Картина стыка доступна для документа с одним стыком.')
              onOpenJointHistory?.(documentRows[0].id)
            }}
            createDocumentBlob={async (documentRecord) => {
              const documentRows = await loadGeneratedDocumentRows(documentRecord.id)
              if (documentRows.length === 0) throw new Error('В документе больше нет стыков.')
              return createCurrentGeneratedDocumentBlob({
                type: documentRecord.type,
                rows: documentRows,
                welderStamps,
                documentRecord,
              })
            }}
          />
        ) : (
          <GeneratedDocumentsPanel
            key={activeGeneratedDocumentType}
            documentType={activeGeneratedDocumentType}
            documentLabel={activeDocumentProfile.label}
            documentFieldLabel={activeDocumentProfile.label}
            columns={availableHistoryColumns}
            initialVisibleColumnKeys={visibleHistoryColumnKeys}
            navigationRequest={
              activeNavigationRequest?.kind === 'generated'
                && activeNavigationRequest.type === activeGeneratedDocumentType
                ? activeNavigationRequest
                : null
            }
            onCreate={() => setActiveWorkspaceTab('generation')}
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
            onOpenJointHistory={async (documentRecord) => {
              const documentRows = await loadGeneratedDocumentRows(documentRecord.id)
              if (documentRows.length !== 1) throw new Error('Картина стыка доступна для документа с одним стыком.')
              onOpenJointHistory?.(documentRows[0].id)
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
  documentType, documentTypes, documentLabel, documentFieldLabel, columns, initialVisibleColumnKeys,
  navigationRequest, onCreate, onRepeat, allowDelete = true, singleDate = false,
  createDocumentBlob, onOpenRows, onOpenJointHistory,
}: {
  documentType: GeneratedDocumentType
  documentTypes?: readonly GeneratedDocumentType[]
  documentLabel: string
  documentFieldLabel: string
  columns: readonly DocumentHistoryColumnDefinition[]
  initialVisibleColumnKeys: readonly DocumentHistoryColumnKey[]
  navigationRequest: GeneratedDocumentNavigationRequest | null
  onCreate?: () => void
  onRepeat?: (documentRecord: StoredGeneratedDocument) => void
  allowDelete?: boolean
  singleDate?: boolean
  createDocumentBlob: (documentRecord: StoredGeneratedDocument) => Promise<Blob>
  onOpenRows: (documentRecord: StoredGeneratedDocument) => Promise<void>
  onOpenJointHistory: (documentRecord: StoredGeneratedDocument) => Promise<void>
}) {
  const { requireDeletePassword } = useSecurityGuard()
  const historyTypes = documentTypes ?? [documentType]
  const historyStorageKey = `generated:${historyTypes.join('+')}`
  const [columnFilters, setColumnFilters] = useStoredDocumentHistoryFilters(historyStorageKey,
    navigationRequest ? getDocumentNavigationColumnFilters(navigationRequest) : undefined)
  const [navigationDocumentId, setNavigationDocumentId] = useState<number | null>(navigationRequest?.documentId ?? null)
  const [contextMenu, setContextMenu] = useState<ContextActionMenuState>(null)
  const [openingRowsDocumentId, setOpeningRowsDocumentId] = useState<number | null>(null)
  const [specialistDocuments, setSpecialistDocuments] = useState<SpecialistDocument[] | null>(null)
  const [specialistRole, setSpecialistRole] = useState<'first' | 'second' | undefined>()
  const [previewRequest, setPreviewRequest] = useState<HistoryDocumentPreviewRequest | null>(null)
  const closePreview = useCallback(() => setPreviewRequest(null), [])
  const [openRowsError, setOpenRowsError] = useState<string | null>(null)
  const [isDownloadingArchive, setIsDownloadingArchive] = useState(false)
  const [totalDocuments, setTotalDocuments] = useState<number | null>(null)
  const confirmAction = useConfirmAction()
  useEffect(() => {
    if (!navigationRequest) return
    setNavigationDocumentId(navigationRequest.documentId)
    setColumnFilters(getDocumentNavigationColumnFilters(navigationRequest))
  }, [navigationRequest])
  const [gridSearch, setGridSearch] = useState('')
  const loadRows = (request: DocumentHistoryGridRequest) => loadGeneratedDocumentHistoryGrid({
    ...request, search: request.search ?? gridSearch, types: [...historyTypes], columnFilters,
    ...(navigationDocumentId === null ? {} : { documentId: navigationDocumentId }),
  })
  const { selectedDocuments, setSelectedDocuments, sourceRevision, refresh, selectionError, selectionPending } =
    useDocumentGridController(historyStorageKey, loadRows, JSON.stringify([columnFilters, navigationDocumentId, gridSearch]))
  const hasActiveFilters = hasDocumentHistoryFilters(columnFilters)
  useDocumentEscapeKey({
    selectedCount: selectedDocuments.length,
    hasFilters: hasActiveFilters || navigationDocumentId !== null,
    onClearSelection: () => setSelectedDocuments([]),
    onClearFilters: () => { setNavigationDocumentId(null); setColumnFilters({}) },
  })
  const changeColumnFilter = (key: DocumentHistoryColumnKey, value: string) => {
    setNavigationDocumentId(null)
    setColumnFilters(current => { const next = { ...current }; if (value) next[key] = value; else delete next[key]; return next })
  }
  const deleteDocumentRecord = async (documentRecord: StoredGeneratedDocument) => {
    setOpenRowsError(null)
    try {
      if (!(await requireDeletePassword(`удаление документа «${documentRecord.title}»`))) return
      const confirmed = await confirmAction({
        title: 'Удалить документ',
        itemName: documentRecord.title,
        description: `Документ «${documentLabel}» связан с ${documentRecord.rowCount} ${formatJointCount(documentRecord.rowCount)}. После удаления поле «${documentFieldLabel}» у этих стыков будет очищено.`,
        warning: 'Документ будет удален из истории сформированных документов. Это действие нельзя отменить.',
      })
      if (confirmed) await deleteGeneratedDocument(documentRecord.id, documentRecord.updatedAt)
    } catch (error) {
      setOpenRowsError(getDocumentActionErrorMessage(error, 'Не удалось удалить документ. Обновите историю и проверьте его состояние.'))
    }
  }
  const openDocumentRows = async (documentRecord: StoredGeneratedDocument) => {
    setOpeningRowsDocumentId(documentRecord.id)
    setOpenRowsError(null)
    try {
      await onOpenRows(documentRecord)
    } catch (error) {
      setOpenRowsError(getDocumentActionErrorMessage(error, 'Не удалось открыть стыки документа.'))
    } finally {
      setOpeningRowsDocumentId(null)
    }
  }
  const openDocumentJointHistory = async (documentRecord: StoredGeneratedDocument) => {
    setOpeningRowsDocumentId(documentRecord.id)
    setOpenRowsError(null)
    try {
      await onOpenJointHistory(documentRecord)
    } catch (error) {
      setOpenRowsError(getDocumentActionErrorMessage(error, 'Не удалось открыть картину стыка.'))
    } finally {
      setOpeningRowsDocumentId(null)
    }
  }
  const openDocumentRecord = async (documentRecord: StoredGeneratedDocument) => {
    setPreviewRequest({ title: documentRecord.title, fileName: documentRecord.fileName, createBlob: () => createDocumentBlob(documentRecord) })
  }
  const downloadDocumentRecord = async (documentRecord: StoredGeneratedDocument) => {
    setOpenRowsError(null)
    try {
      await downloadGeneratedDocument(documentRecord, () => createDocumentBlob(documentRecord))
    } catch (error) {
      setOpenRowsError(getDocumentActionErrorMessage(error, 'Не удалось скачать документ. Повторите скачивание.'))
    }
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
      setOpenRowsError(getDocumentActionErrorMessage(error, 'Не удалось скачать архив документов.'))
    } finally {
      setIsDownloadingArchive(false)
    }
  }

  const getCellValue = (key: DocumentHistoryColumnKey, record: StoredGeneratedDocument): string | number => {
    switch (key) {
      case 'title': return record.title
      case 'stage': return record.stage ?? '-'
      case 'project': return record.projects.join(', ') || '-'
      case 'subtitle': return record.subtitleCodes.join(', ') || '-'
      case 'line': return record.lines.join(', ') || '-'
      case 'period': return singleDate ? formatDate(record.periodFrom ?? record.periodTo) : `${formatDate(record.periodFrom)} - ${formatDate(record.periodTo)}`
      case 'rowCount': return record.rowCount
      case 'wdi': return formatWdi(record.wdiTotal)
      case 'updatedAt': return formatGeneratedDocumentDate(record.updatedAt)
      case 'specialistFirst': case 'specialistSecond': return record.specialists?.[key === 'specialistFirst' ? 'first' : 'second']?.name || 'Не назначен'
      default: return ''
    }
  }
  const renderCell = (key: DocumentHistoryColumnKey, documentRecord: StoredGeneratedDocument) => {
    switch (key) {
      case 'title': return <DocumentTitleButton title={documentRecord.title} onClick={() => void openDocumentRecord(documentRecord)} />
      case 'stage': return <span className="inline-flex rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800">{documentRecord.stage ?? '-'}</span>
      case 'project': return <DocumentDimensionCell values={documentRecord.projects} />
      case 'subtitle': return <DocumentDimensionCell values={documentRecord.subtitleCodes} />
      case 'line': return <DocumentDimensionCell values={documentRecord.lines} />
      case 'period': return <span className="text-xs text-slate-600">{singleDate ? formatDate(documentRecord.periodFrom ?? documentRecord.periodTo) : `${formatDate(documentRecord.periodFrom)} - ${formatDate(documentRecord.periodTo)}`}</span>
      case 'rowCount': return <span className="font-semibold tabular-nums">{documentRecord.rowCount}</span>
      case 'wdi': return <span className="font-semibold tabular-nums">{formatWdi(documentRecord.wdiTotal)}</span>
      case 'updatedAt': return <span className="text-xs text-slate-500">{formatGeneratedDocumentDate(documentRecord.updatedAt)}</span>
      case 'specialistFirst': case 'specialistSecond': return <DocumentSpecialistCell document={documentRecord} role={key === 'specialistFirst' ? 'first' : 'second'} onEdit={(document, role) => { setSpecialistRole(role); setSpecialistDocuments([document]) }} />
      default: return null
    }
  }
  const renderActions = (documentRecord: StoredGeneratedDocument) => <div data-document-row-actions className="flex items-center justify-end gap-1">
    <DocumentHistoryActionButton title="Показать стыки документа в сварочном журнале" tone="emerald" disabled={openingRowsDocumentId === documentRecord.id} onClick={() => void openDocumentRows(documentRecord)}><Rows3 className="h-4 w-4" /></DocumentHistoryActionButton>
    {documentRecord.rowCount === 1 ? <DocumentHistoryActionButton title="Открыть картину стыка" tone="sky" disabled={openingRowsDocumentId === documentRecord.id} onClick={() => void openDocumentJointHistory(documentRecord)}><GitBranch className="h-4 w-4" /></DocumentHistoryActionButton> : null}
    {onRepeat ? <DocumentHistoryActionButton title="Повторить с параметрами" tone="violet" onClick={() => onRepeat(documentRecord)}><SlidersHorizontal className="h-4 w-4" /></DocumentHistoryActionButton> : null}
    <DocumentHistoryActionButton title="Скачать Excel" onClick={() => void downloadDocumentRecord(documentRecord)}><Download className="h-4 w-4" /></DocumentHistoryActionButton>
    {allowDelete ? <DocumentHistoryActionButton title="Удалить документ" tone="rose" onClick={() => void deleteDocumentRecord(documentRecord)}><Trash2 className="h-4 w-4" /></DocumentHistoryActionButton> : null}
  </div>
  return <section className="min-w-0 rounded-md border border-[#cbdde6] bg-white">
    {openRowsError || selectionError ? <DocumentHistoryError message={openRowsError || selectionError!} onRetry={() => { setOpenRowsError(null); refresh() }} /> : null}
    <DocumentsHistoryGrid viewId={historyStorageKey} columns={columns} initialVisibleColumnKeys={initialVisibleColumnKeys}
      renderCell={renderCell} renderActions={renderActions} getCellValue={getCellValue} loadRows={loadRows}
      sourceRevision={`${sourceRevision}:${navigationDocumentId ?? ''}`}
      filterSourceRevision={`${sourceRevision}:${navigationDocumentId ?? ''}`}
      highlightedDocumentId={navigationDocumentId}
      loadFilterOptions={(fieldKey, search, gridSearch) => loadGeneratedDocumentHistoryFilterOptions({ types: [...historyTypes], ...(navigationDocumentId === null ? {} : { documentId: navigationDocumentId }), fieldKey, search, gridSearch, columnFilters: getDocumentHistoryFiltersWithoutKey(columnFilters, fieldKey) })}
      columnFilters={columnFilters} onColumnFilterChange={changeColumnFilter}
      selectedDocuments={selectedDocuments} onSelectionChange={setSelectedDocuments} selectionDisabled={selectionPending || Boolean(selectionError)}
      onSelectionPendingChange={pending => { if (pending) setContextMenu(null) }} onTotalChange={setTotalDocuments} onSearchChange={setGridSearch}
      toolbarActions={<>
        {getSpecialistDocumentProfile(documentType) ? <Button variant="outline" size="sm" disabled={!selectedDocuments.length} onClick={() => { setSpecialistRole(undefined); setSpecialistDocuments(selectedDocuments) }}><UsersRound className="mr-1 h-4 w-4" />Назначить специалистов ({selectedDocuments.length})</Button> : null}
        <Button variant="outline" size="sm" disabled={!selectedDocuments.length || isDownloadingArchive} onClick={() => void downloadSelectedArchive()}><Archive className="mr-1 h-4 w-4" />{isDownloadingArchive ? 'Готовим архив…' : `Архив (${selectedDocuments.length})`}</Button>
      </>}
      onRowContextMenu={(documentRecord, event) => {
                  const bulkItems = selectedDocuments.some(selected => selected.id === documentRecord.id) && selectedDocuments.length > 1
                    ? [
                        { id: 'download-selected-archive', label: `Скачать выбранные архивом (${selectedDocuments.length})`, icon: Archive, onSelect: () => downloadSelectedArchive() },
                        { type: 'separator' as const, id: 'bulk-separator' },
                      ]
                    : []
                  setContextMenu({
                    x: event.x,
                    y: event.y, anchorElement: event.anchorElement,
                    items: [
                      ...bulkItems,
                      { id: 'show-document-rows', label: 'Показать стыки в журнале', icon: Rows3, onSelect: () => openDocumentRows(documentRecord) },
                      ...(documentRecord.rowCount === 1 ? [{
                        id: 'open-joint-history',
                        label: 'Картина стыка',
                        description: 'Хронология, документы, СП/ДЗ и следующий шаг.',
                        icon: GitBranch,
                        onSelect: () => openDocumentJointHistory(documentRecord),
                      }] : []),
                      ...(onRepeat ? [{ id: 'repeat-document', label: 'Повторить с параметрами', icon: SlidersHorizontal, onSelect: () => onRepeat(documentRecord) }] : []),
                      { type: 'separator', id: 'open-separator' },
                      { id: 'copy-cells', label: 'Копировать ячейки', icon: Copy, description: 'Ctrl+C · выбранные ячейки загруженных документов', onSelect: event.copyCells },
                      { id: 'open-document', label: 'Предпросмотр', icon: FileText, onSelect: () => openDocumentRecord(documentRecord) },
                      { id: 'download-document', label: 'Скачать Excel', icon: Download, onSelect: () => downloadDocumentRecord(documentRecord) },
                      ...(allowDelete ? [
                        { type: 'separator' as const, id: 'delete-separator' },
                        { id: 'delete-document', label: 'Удалить', icon: Trash2, danger: true, onSelect: () => deleteDocumentRecord(documentRecord) },
                      ] : []),
                    ],
                  })
      }} />
    {totalDocuments === 0 && !hasActiveFilters && onCreate ? <div className="p-3 text-center"><Button variant="outline" size="sm" onClick={onCreate}><FileSpreadsheet className="mr-2 h-4 w-4" />Перейти к формированию</Button></div> : null}
    {previewRequest ? <HistoryDocumentPreview request={previewRequest} onClose={closePreview} /> : null}
    <ContextActionMenu menu={contextMenu} panelClassName="journal-context-menu" autoFocus onClose={() => setContextMenu(null)} />
    {specialistDocuments ? <DocumentSpecialistAssignmentDialog documents={specialistDocuments} onlyRole={specialistRole} onClose={() => { setSpecialistDocuments(null); setSpecialistRole(undefined) }} /> : null}
  </section>
}

function SystemDocumentsPanel({
  documentLabel,
  documentType,
  methodScope,
  navigationRequest,
  availableTemplateIds,
  columns,
  initialVisibleColumnKeys,
  welderStamps,
  onOpenRows,
  onOpenJointHistory,
  onRenamed,
}: {
  documentLabel: string
  documentType: SystemDocumentType
  methodScope: SystemDocumentMethodScope
  navigationRequest: SystemDocumentNavigationRequest | null
  availableTemplateIds: ReadonlySet<SystemDocumentTemplateId>
  columns: readonly DocumentHistoryColumnDefinition[]
  initialVisibleColumnKeys: readonly DocumentHistoryColumnKey[]
  welderStamps: WelderStampRecord[]
  onOpenRows: (documentRecord: SystemDocumentSummary) => Promise<void>
  onOpenJointHistory: (documentRecord: SystemDocumentSummary) => Promise<void>
  onRenamed: (savedRows?: WeldRow[]) => Promise<void>
}) {
  const { requireEditPassword } = useSecurityGuard()
  const historyStorageKey = `system:${documentType}:${methodScope}`
  const [columnFilters, setColumnFilters] = useStoredDocumentHistoryFilters(
    historyStorageKey,
    navigationRequest ? getDocumentNavigationColumnFilters(navigationRequest) : undefined,
  )
  const [actionError, setActionError] = useState<string | null>(null)
  const [previewRequest, setPreviewRequest] = useState<HistoryDocumentPreviewRequest | null>(null)
  const closePreview = useCallback(() => setPreviewRequest(null), [])
  const [documentOperation, setDocumentOperation] = useState<{ action: DocumentOperationRequest['action']; documents: SystemDocumentSummary[] } | null>(null)
  const [specialistRole, setSpecialistRole] = useState<'first' | 'second' | undefined>()
  const [specialistDocuments, setSpecialistDocuments] = useState<SpecialistDocument[] | null>(null)
  const [isDownloadingArchive, setIsDownloadingArchive] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextActionMenuState>(null)
  const [navigationTarget, setNavigationTarget] = useState(() => navigationRequest
    ? {
        documentId: navigationRequest.documentId ?? null,
        identity: getSystemDocumentNavigationIdentity(navigationRequest),
      }
    : null)
  const [lnkConclusionTemplateFilter, setLnkConclusionTemplateFilter] =
    useDocumentHistorySessionValue(
      `${historyStorageKey}:conclusion-template`,
      'all' as LnkConclusionTemplateFilter,
      isLnkConclusionTemplateFilter,
    )

  useEffect(() => {
    if (!navigationRequest) return
    setNavigationTarget({
      documentId: navigationRequest.documentId ?? null,
      identity: getSystemDocumentNavigationIdentity(navigationRequest),
    })
    setColumnFilters(getDocumentNavigationColumnFilters(navigationRequest))
    if (navigationRequest.type === 'lnkConclusion') {
      setLnkConclusionTemplateFilter(
        getLnkConclusionTemplateProfile(navigationRequest.methodCode).id,
      )
    }
  }, [navigationRequest])
  const effectiveColumnFilters = useMemo(
    () => {
      const filters = { ...columnFilters }
      const stageValues = getScopedSystemDocumentStageValues(methodScope)
      if (stageValues.length > 0) {
        const selectedStageValues = intersectChoiceFilterValues(columnFilters.stage, stageValues)
        filters.stage = buildWeldColumnValueFilter(
          selectedStageValues.length > 0 ? selectedStageValues : ['__no_matching_document_stage__'],
        )
      }
      const methodValues = getScopedSystemDocumentMethodValues(methodScope)
      if (methodValues.length > 0) {
        filters.method = buildWeldColumnValueFilter(methodValues)
      }
      if (documentType === 'lnkConclusion' && methodScope === 'lnk' && lnkConclusionTemplateFilter !== 'all') {
        const profile = LNK_CONCLUSION_TEMPLATE_PROFILES.find((candidate) => candidate.id === lnkConclusionTemplateFilter)
        if (profile) filters.method = buildWeldColumnValueFilter(getLnkConclusionTemplateMethodCodes(profile.id))
      }
      return filters
    },
    [columnFilters, documentType, lnkConclusionTemplateFilter, methodScope],
  )

  const [gridSearch, setGridSearch] = useState('')
  const loadRows = (request: DocumentHistoryGridRequest) => loadSystemDocumentHistoryGrid({
    ...request, search: request.search ?? gridSearch, type: documentType, columnFilters: effectiveColumnFilters,
    ...(navigationTarget?.documentId ? { documentId: navigationTarget.documentId } : {}),
  })
  const { selectedDocuments, setSelectedDocuments, sourceRevision, refresh, selectionError, selectionPending } =
    useDocumentGridController(historyStorageKey, loadRows, JSON.stringify([effectiveColumnFilters, navigationTarget?.documentId, gridSearch]))
  const downloadableSelectedDocuments = selectedDocuments.filter(document => availableTemplateIds.has(getSystemDocumentTemplateId(document)))
  const methodOptionsQuery = useQuery({
    queryKey: [...GENERATED_DOCUMENT_HISTORY_QUERY_KEY, 'grid-method-counts', historyStorageKey, effectiveColumnFilters, navigationTarget?.documentId, gridSearch],
    queryFn: () => loadSystemDocumentHistoryFilterOptions({ type: documentType, fieldKey: 'method', columnFilters: getDocumentHistoryFiltersWithoutKey(effectiveColumnFilters, 'method'), gridSearch, ...(navigationTarget?.documentId ? { documentId: navigationTarget.documentId } : {}) }),
    enabled: documentType === 'lnkConclusion' && methodScope === 'lnk', staleTime: 30_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const filterOptions = { method: methodOptionsQuery.data?.options ?? [] }
  const hasActiveFilters = hasDocumentHistoryFilters(columnFilters)
  const hasActiveHistoryScope = hasActiveFilters || (documentType === 'lnkConclusion' && lnkConclusionTemplateFilter !== 'all')
  useDocumentEscapeKey({ selectedCount: selectedDocuments.length, hasFilters: hasActiveHistoryScope || navigationTarget !== null,
    onClearSelection: () => setSelectedDocuments([]),
    onClearFilters: () => { setNavigationTarget(null); setColumnFilters({}); setLnkConclusionTemplateFilter('all') },
  })
  const hasTemplateForDocument = (document: SystemDocumentSummary) => availableTemplateIds.has(getSystemDocumentTemplateId(document))
  const changeColumnFilter = (key: DocumentHistoryColumnKey, value: string) => {
    setNavigationTarget(null)
    setColumnFilters(current => { const next = { ...current }; if (value) next[key] = value; else delete next[key]; return next })
    if (documentType === 'lnkConclusion' && key === 'method') setLnkConclusionTemplateFilter('all')
  }
  const runAction = async (action: () => Promise<unknown> | void) => {
    setActionError(null)
    try {
      await action()
    } catch (actionFailure) {
      setActionError(getDocumentActionErrorMessage(
        actionFailure,
        'Не удалось выполнить действие с документом.',
      ))
    }
  }

  const openDocumentOperation = async (action: DocumentOperationRequest['action'], documents: SystemDocumentSummary[]) => {
    if (!documents.length || action === 'merge' && documents.length < 2 || !(await requireEditPassword(action === 'split' ? 'изменение разделения выбранных документов' : action === 'merge' ? 'объединение выбранных документов' : 'переименование выбранных документов'))) return
    setDocumentOperation({ action, documents: [...documents] })
  }

  const documentOperationItems = (selection: SystemDocumentSummary[], suffix = ''): ContextActionMenuItem[] => [
    { id: 'merge-documents', label: `Объединить${suffix}`, icon: Merge, disabled: selection.length < 2,
      description: selection.length < 2 ? 'Отметьте минимум два документа. Несовместимые документы объединить нельзя.' : 'Все выбранные документы → один. Сначала проверка совместимости, состава и имени.', onSelect: () => openDocumentOperation('merge', selection) },
    { id: 'split-documents', label: `Изменить разделение${suffix}`, icon: Rows3, disabled: !selection.length,
      description: !selection.length ? 'Отметьте документы галочками в списке.' : 'Распределить позиции по проектам, шифрам, линиям или стыкам.', onSelect: () => openDocumentOperation('split', selection) },
    { id: 'rename-document', label: `Переименовать${suffix}`, icon: FilePenLine, disabled: !selection.length,
      description: !selection.length ? 'Отметьте документы галочками в списке.' : 'Изменить названия, сохранив состав каждого документа.', onSelect: () => openDocumentOperation('rename', selection) },
  ]

  const openDocumentRecord = (documentRecord: SystemDocumentSummary) => {
    setPreviewRequest({
      ...createSystemDocumentPreviewRecord(documentRecord),
      createBlob: () => createCurrentSystemDocumentBlob({ reference: documentRecord, summary: documentRecord, welderStamps }),
    })
  }
  const downloadDocumentRecord = (documentRecord: SystemDocumentSummary) => runAction(() =>
    downloadSystemDocument({ reference: documentRecord, summary: documentRecord, welderStamps }),
  )
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

  const getCellValue = (key: DocumentHistoryColumnKey, record: SystemDocumentSummary): string | number => {
    switch (key) {
      case 'title': return record.title
      case 'method': return getSystemDocumentMethodCodes(record).join(', ') || '-'
      case 'stage': return getSystemDocumentStageLabel(record)
      case 'project': return record.projects.join(', ') || '-'
      case 'subtitle': return record.subtitleCodes.join(', ') || '-'
      case 'line': return record.lines.join(', ') || '-'
      case 'rowCount': return record.rowCount
      case 'date': return formatDate(record.date) || '-'
      case 'specialistFirst': case 'specialistSecond': return record.specialists?.[key === 'specialistFirst' ? 'first' : 'second']?.name || 'Не назначен'
      default: return ''
    }
  }
  const renderCell = (key: DocumentHistoryColumnKey, documentRecord: SystemDocumentSummary) => {
    switch (key) {
      case 'title': return <DocumentTitleButton title={documentRecord.title} disabled={!hasTemplateForDocument(documentRecord)} onClick={() => openDocumentRecord(documentRecord)} />
      case 'method': return <DocumentDimensionCell values={getSystemDocumentMethodCodes(documentRecord)} />
      case 'stage': return <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${getSystemDocumentStageClassName(documentRecord)}`}>{getSystemDocumentStageLabel(documentRecord)}</span>
      case 'project': return <DocumentDimensionCell values={documentRecord.projects} />
      case 'subtitle': return <DocumentDimensionCell values={documentRecord.subtitleCodes} />
      case 'line': return <DocumentDimensionCell values={documentRecord.lines} />
      case 'rowCount': return <span className="font-semibold tabular-nums">{documentRecord.rowCount}</span>
      case 'date': return <span className="text-xs text-slate-600">{formatDate(documentRecord.date) || '-'}</span>
      case 'specialistFirst': case 'specialistSecond': return <DocumentSpecialistCell document={documentRecord} role={key === 'specialistFirst' ? 'first' : 'second'} onEdit={(document, role) => { setSpecialistRole(role); setSpecialistDocuments([document]) }} />
      default: return null
    }
  }
  const renderActions = (documentRecord: SystemDocumentSummary) => <div data-document-row-actions className="flex items-center justify-end gap-1">
    <DocumentHistoryActionButton title={`Показать стыки документа в отчете ${getSystemDocumentTargetReport(documentRecord) === 'lnk' ? 'ЛНК' : 'ПСТО'}`} tone="emerald" onClick={() => void runAction(() => onOpenRows(documentRecord))}><Rows3 className="h-4 w-4" /></DocumentHistoryActionButton>
    {documentRecord.rowCount === 1 ? <DocumentHistoryActionButton title="Открыть картину стыка" tone="sky" onClick={() => void runAction(() => onOpenJointHistory(documentRecord))}><GitBranch className="h-4 w-4" /></DocumentHistoryActionButton> : null}
    <DocumentHistoryActionButton title={hasTemplateForDocument(documentRecord) ? 'Скачать актуальный Excel' : 'Для этого вида документа шаблон еще не загружен'} disabled={!hasTemplateForDocument(documentRecord)} onClick={() => void downloadDocumentRecord(documentRecord)}><Download className="h-4 w-4" /></DocumentHistoryActionButton>
  </div>
  return <section className="min-w-0 rounded-md border border-[#cbdde6] bg-white">
      {documentType === 'lnkConclusion' && methodScope === 'lnk' ? (
        <div
          className="flex flex-wrap gap-2 border-b border-[#d8e5eb] bg-white px-4 py-3"
          role="tablist"
          aria-label="Вид заключения ЛНК"
        >
          <button
            type="button"
            role="tab"
            aria-selected={lnkConclusionTemplateFilter === 'all'}
            onClick={() => {
              setNavigationTarget(null)
              setLnkConclusionTemplateFilter('all')
            }}
            className={`h-8 rounded-md border px-3 text-xs font-semibold transition-colors ${
              lnkConclusionTemplateFilter === 'all'
                ? 'border-sky-100 bg-sky-50 text-sky-700'
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
                  setNavigationTarget(null)
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
                    ? 'border-sky-100 bg-sky-50 text-sky-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-800'
                }`}
              >
                {profile.label}
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                  isActive ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {documentCount}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}

    {actionError || selectionError ? <DocumentHistoryError message={actionError || selectionError!} onRetry={() => { setActionError(null); refresh() }} /> : null}
    <DocumentsHistoryGrid viewId={historyStorageKey} columns={columns} initialVisibleColumnKeys={initialVisibleColumnKeys}
      renderCell={renderCell} renderActions={renderActions} getCellValue={getCellValue} loadRows={loadRows}
      sourceRevision={`${sourceRevision}:${JSON.stringify(effectiveColumnFilters)}:${navigationTarget?.documentId ?? ''}`}
      filterSourceRevision={`${sourceRevision}:${lnkConclusionTemplateFilter}:${navigationTarget?.documentId ?? ''}`}
      highlightedDocumentId={navigationTarget?.documentId ? `system-document:${navigationTarget.documentId}` : null}
      highlightRow={document => navigationTarget !== null && getSystemDocumentNavigationIdentity(document) === navigationTarget.identity}
      loadFilterOptions={async (fieldKey, search, registrySearch) => {
        const result = await loadSystemDocumentHistoryFilterOptions({ type: documentType, ...(navigationTarget?.documentId ? { documentId: navigationTarget.documentId } : {}), fieldKey, search, gridSearch: registrySearch, columnFilters: getDocumentHistoryFiltersWithoutKey(effectiveColumnFilters, fieldKey) })
        return { ...result, options: getScopedSystemDocumentHistoryFilterOptions({ [fieldKey]: result.options }, methodScope)[fieldKey] ?? [] }
      }}
      columnFilters={columnFilters} onColumnFilterChange={changeColumnFilter}
      selectedDocuments={selectedDocuments} onSelectionChange={setSelectedDocuments} selectionDisabled={selectionPending || Boolean(selectionError)}
      onSelectionPendingChange={pending => { if (pending) setContextMenu(null) }} onSearchChange={setGridSearch}
      toolbarActions={
              <button type="button" aria-label={`Действия с документами, выбрано: ${selectedDocuments.length}`} aria-haspopup="menu" aria-expanded={contextMenu?.heading === 'Действия с документами'}
                className="journal-button"
                onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setContextMenu({ x: rect.right - Math.min(320, window.innerWidth - 16), y: rect.bottom + 4, anchorElement: event.currentTarget,
                  heading: 'Действия с документами', description: selectedDocuments.length ? `Выбрано: ${selectedDocuments.length} · только отмеченные документы` : 'Сначала отметьте нужные документы в списке.',
                  items: [...(documentType.endsWith('Conclusion') ? [{ id: 'assign-specialists', label: 'Назначить специалистов', icon: UsersRound, description: 'Назначить, заменить или очистить роли в отмеченных документах.', disabled: !selectedDocuments.length, onSelect: () => { setSpecialistRole(undefined); setSpecialistDocuments(selectedDocuments) } }] : []), ...documentOperationItems(selectedDocuments), { type: 'separator', id: 'archive-separator' },
                    { id: 'download-selected-archive', label: isDownloadingArchive ? 'Готовим архив…' : 'Скачать выбранные архивом', icon: Archive, disabled: !downloadableSelectedDocuments.length || isDownloadingArchive,
                      description: `Доступен Excel: ${downloadableSelectedDocuments.length} из ${selectedDocuments.length}. Для скачивания нужен шаблон.`, onSelect: () => downloadSelectedArchive() }],
                }) }}>
                Действия{selectedDocuments.length > 0 ? <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] tabular-nums">{selectedDocuments.length}</span> : null}<ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
      }
      onRowContextMenu={(documentRecord, event) => {
        const templateAvailable = hasTemplateForDocument(documentRecord)
        const isSelected = selectedDocuments.some(document => document.id === documentRecord.id)
        const isBulkSelectionContext = isSelected && selectedDocuments.length > 1
                    const bulkItems = isBulkSelectionContext
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
                      x: event.x,
                      y: event.y, anchorElement: event.anchorElement,
                      items: [
                        ...bulkItems,
                        { id: 'show-document-rows', label: 'Показать стыки в отчете', icon: Rows3, onSelect: () => runAction(() => onOpenRows(documentRecord)) },
                        ...(documentRecord.rowCount === 1 ? [{
                          id: 'open-joint-history',
                          label: 'Картина стыка',
                          description: 'Хронология, документы, СП/ДЗ и следующий шаг.',
                          icon: GitBranch,
                          onSelect: () => runAction(() => onOpenJointHistory(documentRecord)),
                        }] : []),
                        ...documentOperationItems(isSelected ? selectedDocuments : [documentRecord], isSelected ? ` (${selectedDocuments.length})` : ''),
                        { type: 'separator', id: 'open-separator' },
                      { id: 'copy-cells', label: 'Копировать ячейки', icon: Copy, description: 'Ctrl+C · выбранные ячейки загруженных документов', onSelect: event.copyCells },
                        { id: 'open-document', label: 'Предпросмотр', icon: FileText, disabled: !templateAvailable, onSelect: () => openDocumentRecord(documentRecord) },
                        { id: 'download-document', label: 'Скачать Excel', icon: Download, disabled: !templateAvailable, onSelect: () => downloadDocumentRecord(documentRecord) },
                      ],
                    })
      }} />
    <ContextActionMenu menu={contextMenu} panelClassName="journal-context-menu" autoFocus onClose={() => setContextMenu(null)} />
    {specialistDocuments ? <DocumentSpecialistAssignmentDialog documents={specialistDocuments} onlyRole={specialistRole} onClose={() => { setSpecialistDocuments(null); setSpecialistRole(undefined) }} /> : null}
    {documentOperation ? <DocumentOperationDialog documents={documentOperation.documents} action={documentOperation.action} onClose={() => setDocumentOperation(null)} onApplied={() => onRenamed()} /> : null}
    {previewRequest ? <HistoryDocumentPreview request={previewRequest} onClose={closePreview} /> : null}
  </section>
}

function DocumentTitleButton({ title, disabled = false, onClick }: { title: string; disabled?: boolean; onClick: () => void }) {
  return <button type="button" data-document-title-button className="group flex w-full min-w-0 items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60" disabled={disabled} onClick={onClick} title={disabled ? 'Для этого вида документа шаблон еще не загружен' : 'Предпросмотр актуального документа'}>
    <FileSpreadsheet className="h-4 w-4 shrink-0 text-sky-700" /><span className="document-grid-title min-w-0 text-[13px] font-medium text-slate-800 group-hover:text-sky-800">{title}</span>
  </button>
}

function DocumentHistoryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><span>{message}</span><button type="button" className="rounded border border-rose-200 bg-white px-2 py-1" onClick={onRetry}>Обновить историю</button></div>
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
    <span className="truncate text-xs text-slate-600" title={text}>
      {text}
    </span>
  )
}

function DocumentHistoryActionButton({
  title,
  tone = 'neutral',
  disabled = false,
  onClick,
  children,
}: {
  title: string
  tone?: 'neutral' | 'emerald' | 'sky' | 'violet' | 'amber' | 'rose'
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const toneClass = {
    neutral: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    sky: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100',
    violet: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100',
    amber: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
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
    <details className="group rounded-md border border-slate-200 bg-slate-50" onKeyDown={event => {
      if (event.key !== 'Escape' || !event.currentTarget.open || isModalDialogOpen()) return
      event.preventDefault(); event.stopPropagation()
      event.currentTarget.open = false
      event.currentTarget.querySelector('summary')?.focus()
    }}>
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

function useStoredDocumentHistoryFilters(
  storageKey: string,
  initialFilters?: Record<string, string>,
) {
  const fullStorageKey = `welding-journal:documents:filters:${storageKey}`
  const [state, setState] = useState<{ key: string; filters: Record<string, string> }>(() => ({
    key: fullStorageKey,
    filters: initialFilters ?? readStoredDocumentHistoryFilters(fullStorageKey),
  }))
  const filters = state.key === fullStorageKey
    ? state.filters
    : readStoredDocumentHistoryFilters(fullStorageKey)

  useEffect(() => {
    setState((current) => current.key === fullStorageKey
      ? current
      : { key: fullStorageKey, filters: readStoredDocumentHistoryFilters(fullStorageKey) })
  }, [fullStorageKey])

  useEffect(() => {
    if (state.key !== fullStorageKey || typeof window === 'undefined') return
    window.localStorage.setItem(fullStorageKey, JSON.stringify(state.filters))
  }, [fullStorageKey, state])

  const setFilters = (next: SetStateAction<Record<string, string>>) => {
    setState((current) => {
      const currentFilters = current.key === fullStorageKey
        ? current.filters
        : readStoredDocumentHistoryFilters(fullStorageKey)
      return {
        key: fullStorageKey,
        filters: typeof next === 'function' ? next(currentFilters) : next,
      }
    })
  }

  return [filters, setFilters] as const
}

function readStoredDocumentHistoryFilters(storageKey: string) {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}') as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        const normalized = String(value ?? '').trim()
        return normalized ? [[key, normalized]] : []
      }),
    )
  } catch {
    return {}
  }
}
