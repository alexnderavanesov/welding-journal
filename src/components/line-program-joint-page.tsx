import { formatControlRequestRemovals, type ControlRequestRemoval } from '@/lib/control-request-removal-preview'
import { PROGRAM_BASIS_FIELDS } from '@/lib/line-program-workspace'
import { createProgramAssignmentRowsSelector } from '@/lib/line-program-assignment-refresh'
import { getControlAssignmentBasisIssues, requiresControlAssignmentBasis } from '@/lib/control-assignment-basis-validation'
import { Checkbox } from '@/components/ui/checkbox'
import type { GridApi } from 'ag-grid-community'
import { revealProgramComposition } from './line-program-reveal'
import { PROGRAM_EXPLANATION_LISTS } from '@/lib/line-program-explanation'
import { Select } from '@/components/ui/select'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'
import { PROGRAM_SLICE_LABELS as slices } from '@/lib/line-program-labels'
import { useProgramSessionState } from './line-program-grid-session'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { getProgramAssignmentError } from '@/lib/line-program-assignment-validation'
import { loadSaveCheckSettings } from '@/lib/save-check-settings'
import { getWeldFormCancellationResultHint } from '@/lib/weld-form-save-reasons'
import { useProgramContextMenu, type ProgramReportNavigation } from './line-program-context-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { calculateFinalStatus } from '@/lib/weld-status'
import { ProgramChangeSummary } from './line-program-change-summary'
import { useSecurityGuard } from '@/lib/security-context'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import { updateLineProgramSectionCaches } from '@/lib/line-program-section-cache'
import { getExpectedWeldRowVersions } from '@/lib/weld-save-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { LineProgramRecord } from '@/lib/line-program'
import { calculateLineProgram, getLineProgramOfficialStamps, isLineProgramControlRow } from '@/lib/line-program-calculation'
import { countProgramRemovalHints, getProgramRemovalHints, type ProgramRemovalHints } from '@/lib/line-program-excess'
import { createProgramRowSelector, programScopeKey } from '@/lib/line-program-selection'
import { applyProgramPatch, getProgramBatchTargets, matchesProgramScope, isProgramEditableRow, PROGRAM_ASSIGNMENT_OPTIONS, PROGRAM_METHODS, PROGRAM_EDITOR_METHODS, programAssignment, toggleProgramMethodSelection, type ProgramAssignment, type ProgramChange, type ProgramMethod, type ProgramPatch, type ProgramSelection } from '@/lib/line-program-workspace'
import { getLineProgramJointPage } from '@/server/line-program'
import { applyLineProgramControl, previewLineProgramControl, type LineProgramControlRequest } from '@/server/line-program-control'
import { LineProgramAssignmentDialog } from './line-program-assignment-dialog'
import { ProgramReadOnlyTable, ProgramAssignmentTable } from './line-program-assignment-table'
import { ProgramAssignmentGuidance } from './line-program-assignment-guidance'
import { useProgramDraft } from './line-program-drafts'
import type { ProgramScopeCommand } from './line-program-scope-menu'
import { lineProgramQueryPolicy, programPrimaryActionClass, ProgramError } from './line-program-primitives'
import { unpackProgramRows } from '@/lib/line-program-row-payload'
import { loadProgramRows, PROGRAM_ROWS_PROTOCOL } from '@/lib/line-program-row-stream'
import { getAssignmentWarning } from '@/lib/assignment-warnings'
import { loadAssignmentWarningSettings } from '@/lib/assignment-warning-settings'
import { countProgramRows } from '@/lib/line-program-row-filters'
import { ProgramQuickFilters, type ProgramQuickFilter } from './line-program-quick-filters'

const REDUCTION_SCOPE_LABEL = 'Возможно сократить'

const toggleClass = (active: boolean) => `inline-flex min-h-9 min-w-16 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${active ? 'border-sky-600 bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-600' : 'border-slate-200 bg-white text-slate-600 hover:border-sky-300'}`

export function LineJointPage({ line, workspaces, onOpenReportRows, enabled = true, assignmentRequest, onAssignmentRequestHandled }: {
  line: LineProgramRecord; workspaces: { key: string; selection: ProgramSelection; container: HTMLDivElement | null; open: boolean }[]
  onOpenReportRows?: ProgramReportNavigation; enabled?: boolean
  assignmentRequest?: ProgramScopeCommand; onAssignmentRequestHandled?: (command: ProgramScopeCommand) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirmAction()
  const [warningPending, setWarningPending] = useState(false)
  const warningLock = useRef(false)
  const warningMounted = useRef(true)
  useEffect(() => { warningMounted.current = true; return () => { warningMounted.current = false } }, [])
  const { requireEditPassword } = useSecurityGuard()
  const [selection, setSelection] = useProgramSessionState<ProgramSelection>(`editor:selection:${line.family ?? 'welds'}:${line.id}`, { slice: 'all' })
  const contextScope = useRef<ProgramSelection>({ slice: 'all' })
  const searchInput = useRef<HTMLInputElement>(null)
  const handledAssignmentRequest = useRef<ProgramScopeCommand | undefined>(undefined)
  const [editingAssignments, setEditingAssignments] = useState(false)
  const [editingStamp, setEditingStamp] = useProgramSessionState(`editor:editingStamp:${line.family ?? 'welds'}:${line.id}`, '')
  const [editingUnassigned, setEditingUnassigned] = useProgramSessionState(`editor:editingUnassigned:${line.family ?? 'welds'}:${line.id}`, false)
  const [editingReduction, setEditingReduction] = useProgramSessionState(`editor:editingReduction:${line.family ?? 'welds'}:${line.id}`, false)
  const [editingSlice, setEditingSlice] = useProgramSessionState(`editor:editingSlice:${line.family ?? 'welds'}:${line.id}`, true)
  const [focusedJoint, setFocusedJoint] = useState<number | null>(null)
  const [jointSearch, setJointSearch] = useProgramSessionState(`editor:jointSearch:${line.family ?? 'welds'}:${line.id}`, '')
  const [editingFilter, setEditingFilter] = useProgramSessionState<ProgramQuickFilter>(`editor:editingFilter:${line.family ?? 'welds'}:${line.id}`, 'all')
  const [batchError, setBatchError] = useState('')
  const [batchBasis, setBatchBasis] = useState('')
  const [selected, setSelected] = useProgramSessionState(`editor:selected:${line.family ?? 'welds'}:${line.id}`, new Set<number>())
  const [methods, setMethods] = useProgramSessionState(`editor:methods:${line.family ?? 'welds'}:${line.id}`, new Set<ProgramMethod>())
  const [assignment, setAssignment] = useProgramSessionState<ProgramAssignment>(`editor:assignment:${line.family ?? 'welds'}:${line.id}`, 'да')
  const [focusedMethod, setFocusedMethod] = useState<ProgramMethod | undefined>()
  const [review, setReview] = useState<{ requestRemovals?: ControlRequestRemoval[]; hiddenRemovalCount?: number; token: string; excess: number; changed: number; request: LineProgramControlRequest } | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [feedback, setFeedback] = useState('')
  const query = useQuery({ queryKey: ['line-program', 'rows', line.id, line.family ?? 'welds'],
    queryFn: async ({ signal }) => unpackProgramRows(await loadProgramRows(rpcSignal => getLineProgramJointPage({ signal: rpcSignal, data: { id: line.id, family: line.family, transport: PROGRAM_ROWS_PROTOCOL } }), signal)),
    enabled, ...lineProgramQueryPolicy })
  const revealToken = Math.max(0, ...workspaces.filter(workspace => workspace.open).map(workspace => workspace.selection.reveal ?? 0))
  const [readyComposition, setReadyComposition] = useState(0)
  useEffect(() => {
    if (!enabled || !revealToken || readyComposition === revealToken) return
    let active = true
    void query.refetch({ cancelRefetch: false }).then(() => { if (active) setReadyComposition(revealToken) })
    return () => { active = false }
  }, [enabled, revealToken, readyComposition, query.refetch])
  const retryComposition = useStableEventCallback(() => { void query.refetch() })
  const rows = query.data?.rows ?? []
  const rowVersions = useMemo(() => getExpectedWeldRowVersions(rows), [rows])
  const { manual, setManual, targets: draftTargets, acceptCurrentVersions } = useProgramDraft(line.id, rowVersions, line.family)
  const rowById = useMemo(() => new Map(rows.map(row => [row.id, row])), [rows])
  const warningContext = useRef({ manual, rows, enabled })
  warningContext.current = { manual, rows, enabled }
  const staleDraft = [...draftTargets.values()].some(target => String(rowById.get(target.id)?.rowVersion ?? '') !== target.version)
  const historyProtection = loadSaveCheckSettings().controlHistoryProtection
  const activePatch = () => Object.fromEntries([...methods].flatMap(method => [[method, assignment], ...(method !== 'Послойный ПВК' && requiresControlAssignmentBasis(assignment) ? [[PROGRAM_BASIS_FIELDS[method], batchBasis]] : [])])) as ProgramPatch
  const resetReview = () => { setReview(null); setAcknowledged(false); setFeedback(''); setBatchError(''); preview.reset(); save.reset() }
  const { changes, draft, errors, basisErrors } = useMemo(() => {
    const changes: ProgramChange[] = [], draft = new Map<number, WeldRow>(), errors: string[] = [], basisErrors: string[] = []
    for (const id of manual.keys()) if (!rowById.has(id)) errors.push(`Стык ID ${id} больше не входит в линию. Отмените его изменения или весь черновик.`)
    for (const row of rows) {
      const values = manual.get(row.id) ?? {}
      if (!Object.keys(values).length) continue
      try {
        const next = applyProgramPatch(row, values)
        if (PROGRAM_METHODS.some(method => programAssignment(row, method) !== programAssignment(next, method)) || Object.values(PROGRAM_BASIS_FIELDS).some(key => String(row[key] ?? '') !== String(next[key] ?? ''))) {
          changes.push({ id: row.id, values }); draft.set(row.id, next)
          basisErrors.push(...getControlAssignmentBasisIssues(next, row).map(issue => `${row.joint}: ${issue.message}`))
        }
      } catch (error) { errors.push(`${row.joint}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    return { changes, draft, errors, basisErrors }
  }, [rows, rowById, manual])
  const approvedKeys = useMemo(() => new Set(query.data?.approvedKeys), [query.data?.approvedKeys])
  const calculation = useMemo(() => calculateLineProgram(rows, line.weldControlPercent ?? 0, line.pvkControlPercent ?? 0, undefined, approvedKeys, line.family === 'supports'), [rows, line.weldControlPercent, line.pvkControlPercent, line.family, approvedKeys])
  const selectCalculationRows = useMemo(() => createProgramAssignmentRowsSelector(), [])
  const calculationRows = selectCalculationRows(rows, draft)
  const draftCalculation = useMemo(() => calculationRows === rows ? calculation : calculateLineProgram(calculationRows, line.weldControlPercent ?? 0, line.pvkControlPercent ?? 0, undefined, approvedKeys, line.family === 'supports'), [calculationRows, rows, calculation, line.weldControlPercent, line.pvkControlPercent, line.family, approvedKeys])
  const stampOptions = useMemo(() => [...new Map(rows.filter(isLineProgramControlRow).flatMap(getLineProgramOfficialStamps).map(stamp => [stamp.toLocaleLowerCase('ru'), stamp])).values()].sort((a, b) => a.localeCompare(b, 'ru')), [rows])
  const hasUnassigned = rows.some(row => matchesProgramScope(row, { unassigned: true }))
  const savedHints = useMemo(() => getProgramRemovalHints(line.id, rows, calculation, new Set(query.data?.approvedKeys)), [line.id, rows, calculation, query.data?.approvedKeys])
  const selectRows = useMemo(() => createProgramRowSelector(rows, calculation, line.id, new Set(query.data?.approvedKeys), savedHints, { percent: line.weldControlPercent ?? 0, pvkPercent: line.pvkControlPercent ?? 0, support: line.family === 'supports' }), [rows, calculation, line.id, line.weldControlPercent, line.pvkControlPercent, line.family, query.data?.approvedKeys, savedHints])
  const draftHints = useMemo(() => calculationRows === rows ? savedHints : getProgramRemovalHints(line.id, calculationRows, draftCalculation, new Set(query.data?.approvedKeys)), [line.id, calculationRows, rows, draftCalculation, savedHints, query.data?.approvedKeys])
  const preview = useMutation({ mutationFn: async () => {
    if (staleDraft) throw new Error('Данные стыков изменились после начала редактирования. Сначала сравните и примите обновлённые данные.')
    if (!await requireEditPassword('проверка назначений контроля')) return null
    const changedIds = new Set(changes.map(change => change.id))
    const request: LineProgramControlRequest = { lineId: line.id, lineVersion: line.version, changes, targets: [...draftTargets.values()].filter(target => changedIds.has(target.id)) }
    return { ...await previewLineProgramControl({ data: request }), request }
  }, onSuccess: result => { if (result) { setReview(result); setAcknowledged(false) } } })
  const save = useMutation({ mutationFn: async () => {
    if (!review || !await requireEditPassword('сохранение назначений контроля')) return null
    const consequences = [formatControlRequestRemovals(review.requestRemovals ?? [], review.hiddenRemovalCount), ...cancellationHints].filter(Boolean).join('\n')
    if (consequences && !await confirm({ title: 'Сохранить изменения назначений?', description: consequences, confirmLabel: 'Подтвердить и сохранить', cancelLabel: 'Вернуться', tone: 'warning' })) return null
    return applyLineProgramControl({ data: { ...review.request, previewToken: review.token, confirmedExcess: acknowledged } })
  }, onError: () => setReview(null), onSuccess: async result => {
    if (!result) return
    setSelected(new Set()); setManual(new Map()); setReview(null); setFocusedMethod(undefined); setFeedback(`Назначения сохранены · стыков: ${result.changed}`)
    scheduleWeldDataRefresh(queryClient, { upsertRows: result.rows }, { lineProgramListsHandled: !!result.lineSummary })
    if (result.lineSummary) {
      await updateLineProgramSectionCaches(queryClient, result.lineSummary)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['line-program', 'calculation', line.id] }),
        queryClient.invalidateQueries({ queryKey: ['line-program', 'rows', line.id] }),
        queryClient.invalidateQueries({ queryKey: ['line-program', 'explanation', line.id], refetchType: 'active' }),
      ])
    }
  } })
  const busy = preview.isPending || save.isPending || warningPending
  const canSelect = useCallback((row: WeldRow) => isProgramEditableRow(row), [])
  const select = useCallback((id: number, checked: boolean) => { setSelected(previous => { const next = new Set(previous); checked ? next.add(id) : next.delete(id); return next }) }, [setSelected])
  const mergedValues = useCallback((row: WeldRow, patch: ProgramPatch) => {
    const values = { ...manual.get(row.id), ...patch }
    for (const method of PROGRAM_METHODS) if (values[method] === programAssignment(row, method)) delete values[method]
    for (const key of Object.values(PROGRAM_BASIS_FIELDS)) if (values[key] !== undefined && values[key]!.trim() === String(row[key] ?? '').trim()) delete values[key]
    return values
  }, [manual])
  const getError = useCallback((row: WeldRow, method: ProgramMethod, value: ProgramAssignment) => getProgramAssignmentError(row, mergedValues(row, { [method]: value }), historyProtection), [mergedValues, historyProtection])
  const applyChanges = async (targets: WeldRow[], patch: ProgramPatch) => {
    if (busy || warningLock.current) return
    let updates = targets.map(row => ({ row, values: mergedValues(row, patch) }))
    const problems = updates.map(({ row, values }) => { const error = getProgramAssignmentError(row, values, historyProtection); return error ? `${row.joint}: ${error}` : '' }).filter(Boolean)
    resetReview()
    if (problems.length) { setBatchError(problems.join(' ')); return }
    const settings = loadAssignmentWarningSettings()
    const warnings = targets.flatMap(row => (['РК', 'УЗК'] as const).flatMap(method => {
      if (patch[method] === undefined) return []
      const field = method === 'РК' ? 'hasRk' : 'hasUzk'
      const current = { ...row, [field]: manual.get(row.id)?.[method] ?? row[field] }
      const warning = getAssignmentWarning(current, field, patch[method], settings)
      return warning ? [{ row, method, warning }] : []
    }))
    if (warnings.length) {
      warningLock.current = true; setWarningPending(true)
      try {
        const confirmed = await confirm({ title: 'Подтвердить назначение контроля', tone: 'warning',
          description: <div className="space-y-3">{(['rk', 'uzk'] as const).map(key => {
            const matches = warnings.filter(item => item.warning.key === key)
            return matches.length ? <div key={key}><p className="whitespace-pre-wrap">{matches[0].warning.text}</p><p className="mt-1 text-sm">Стыков: {matches.length}. {matches.slice(0, 5).map(item => `${item.row.joint}: ${item.warning.detail}`).join('; ')}{matches.length > 5 ? '; …' : ''}</p></div> : null
          })}</div>, confirmLabel: 'Да, назначить', cancelLabel: 'Нет, оставить пусто' })
        if (!warningMounted.current) return
        if (!warningContext.current.enabled || warningContext.current.rows !== rows || warningContext.current.manual !== manual) {
          setBatchError('Данные или черновик изменились во время подтверждения. Повторите назначение.'); return
        }
        if (!confirmed) {
          updates = targets.map(row => {
            const rejected = { ...patch }
            for (const item of warnings) if (item.row.id === row.id) {
              rejected[item.method] = ''
              const basis = PROGRAM_BASIS_FIELDS[item.method]
              rejected[basis] = manual.get(row.id)?.[basis] ?? String(row[basis] ?? '')
            }
            return { row, values: mergedValues(row, rejected) }
          })
          const blocked = updates.map(({ row, values }) => { const error = getProgramAssignmentError(row, values, historyProtection); return error ? `${row.joint}: ${error}` : '' }).filter(Boolean)
          if (blocked.length) { setBatchError(`Назначение не изменено: ${blocked.join(' ')}`); return }
        }
      } finally { warningLock.current = false; if (warningMounted.current) setWarningPending(false) }
    }
    setManual(previous => { const next = new Map(previous); for (const { row, values } of updates) Object.keys(values).length ? next.set(row.id, values) : next.delete(row.id); return next })
  }
  const openAssignments = useStableEventCallback((scope: ProgramSelection, id?: number, method?: ProgramMethod) => {
    if (busy) return
    // Keep useful selections on return, but never carry hidden joints from another scope.
    const scopedIds = new Set(selectRows(scope).map(row => row.id))
    setSelected(previous => new Set([...previous].filter(id => scopedIds.has(id))))
    setSelection(scope)
    setJointSearch(scope.search ?? '')
    setFocusedJoint(id ?? null)
    setFocusedMethod(method)
    setEditingStamp(stampOptions.find(stamp => stamp.toLocaleLowerCase('ru') === scope.stamp?.toLocaleLowerCase('ru')) ?? scope.stamp ?? '')
    setEditingUnassigned(!!scope.unassigned)
    setEditingReduction(false)
    setEditingSlice(true)
    setEditingFilter(scope.status ?? (scope.slice === 'missing' ? 'missing' : 'all'))
    setEditingAssignments(true)
  })
  useEffect(() => {
    if (!assignmentRequest || handledAssignmentRequest.current === assignmentRequest) return
    if (!enabled) { onAssignmentRequestHandled?.(assignmentRequest); return }
    if (!query.data || busy) return
    handledAssignmentRequest.current = assignmentRequest
    openAssignments(assignmentRequest.selection, assignmentRequest.jointId)
    onAssignmentRequestHandled?.(assignmentRequest)
  }, [assignmentRequest, enabled, query.data, busy, onAssignmentRequestHandled])
  // Scroll to the requested joint without changing the table order or any draft values.
  const editingScope = { stamp: editingStamp || undefined, unassigned: editingUnassigned, slice: 'all' as const }
  const allEditingScopeRows = selectRows(editingScope)
  const editingScopeRows = useMemo(() => editingReduction ? allEditingScopeRows.filter(row => draftHints.has(row.id)) : allEditingScopeRows, [allEditingScopeRows, editingReduction, draftHints])
  const editingCounts = useMemo(() => countProgramRows(editingScopeRows), [editingScopeRows])
  const scopedEditingRows = selectRows({ ...(editingSlice ? selection : editingScope), search: undefined,
    slice: editingFilter === 'missing' ? 'missing' : editingSlice ? selection.slice : 'all',
    status: editingFilter !== 'all' && editingFilter !== 'missing' ? editingFilter : undefined })
  const needle = jointSearch.trim().toLocaleLowerCase('ru')
  const editingRows = useMemo(() => scopedEditingRows.filter(row => {
    if (editingReduction && !draftHints.has(row.id)) return false
    if (!needle) return true
    const value = draft.get(row.id) ?? row
    return [row.joint, row.connectionType, ...getLineProgramOfficialStamps(row), calculateFinalStatus(value), value.vikResult, value.rkResult, value.uzkResult, value.pvkResult,
      ...PROGRAM_METHODS.map(method => `${method} ${programAssignment(value, method)}`)].map(text => String(text ?? '')).join(' ').toLocaleLowerCase('ru').includes(needle)
  }), [scopedEditingRows, needle, draft, editingReduction, draftHints])
  const [gridFilteredIds, setGridFilteredIds] = useState<Set<number> | null>(null)
  const filteredEditingRows = gridFilteredIds ? editingRows.filter(row => gridFilteredIds.has(row.id)) : editingRows
  const visibleReduction = editingAssignments ? countProgramRemovalHints(draftHints, filteredEditingRows.map(row => row.id)) : 0
  const focusedRow = focusedJoint ? rows.find(row => row.id === focusedJoint) : null
  const navigate: ProgramReportNavigation | undefined = onOpenReportRows ? async (ids, report, message) => {
    if (busy) return
    // The page-level navigation guard also sees drafts of currently hidden lines.
    onOpenReportRows(ids, report, message)
  } : undefined
  const context = useProgramContextMenu(id => {
    // An already open editor keeps its current scope and row order.
    if (editingAssignments) { setFocusedJoint(id); setFocusedMethod(undefined) }
    else openAssignments(contextScope.current, id)
  }, navigate, busy)
  const openWorkspaceContext = useStableEventCallback((scope: ProgramSelection, event: React.MouseEvent | React.KeyboardEvent, row: WeldRow) => { contextScope.current = scope; context.open(event, row) })
  const cancellationHints = [...draft].flatMap(([id, next]) => {
    const row = rowById.get(id)!, hint = getWeldFormCancellationResultHint(next, row)
    return hint ? [`${row.joint}: ${hint}`] : []
  })
  const batchTargets = getProgramBatchTargets(rows.filter(row => selected.has(row.id) && isProgramEditableRow(row)), activePatch())
  const skipped = selected.size - batchTargets.length
  const hiddenSelected = selected.size - filteredEditingRows.filter(row => selected.has(row.id)).length
  const overLimit = changes.length > 1000
  const resetButton = <button type="button" disabled={busy || !selected.size} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 disabled:opacity-40" onClick={() => setSelected(new Set())}>Сбросить выбор</button>
  return <>{workspaces.map(workspace => workspace.container ? <ProgramWorkspaceView key={workspace.key} line={line} selection={{ ...workspace.selection, reveal: workspace.open && workspace.selection.reveal === revealToken ? workspace.selection.reveal : undefined }} rows={selectRows(workspace.selection)} removalHints={savedHints} container={workspace.container} error={query.error} pending={query.isPending || !!workspace.selection.explanationList && (readyComposition !== revealToken || query.isFetching)} onRetry={retryComposition} feedback={feedback && !editingAssignments ? feedback : ''} onAssignments={openAssignments} onContextMenu={openWorkspaceContext} /> : null)}
    {editingAssignments && enabled ? <LineProgramAssignmentDialog line={line.line} context={<>{line.line} → {editingUnassigned ? 'Клеймо не назначено' : editingStamp ? <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">Клеймо {editingStamp}</span> : 'Все стыки линии'} · стыков: {editingRows.length}{focusedRow ? <span className="ml-2 font-semibold text-sky-800">→ Стык {String(focusedRow.joint)}</span> : null}<span className="mt-1 block text-xs text-slate-500">{editingReduction ? REDUCTION_SCOPE_LABEL : editingSlice ? selection.explanationList ? PROGRAM_EXPLANATION_LISTS[selection.explanationList] : slices[selection.slice] : 'Все стыки'}</span></>} busy={busy} onClose={() => setEditingAssignments(false)}
      searchControl={<div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" /><Input ref={searchInput} className="h-8 bg-white pl-8 pr-8 text-xs" aria-label="Поиск стыков в назначениях" placeholder="Поиск стыков…" aria-description="Стык, клеймо, состояние или назначение" value={jointSearch} onChange={event => { setJointSearch(event.target.value); setFocusedJoint(null) }} />{jointSearch ? <button type="button" aria-label="Очистить поиск стыков" className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500" onClick={() => { setJointSearch(''); searchInput.current?.focus() }}><X aria-hidden="true" className="h-3.5 w-3.5" /></button> : null}</div>}
      scopeControl={<Select aria-label="Стыки в окне назначений" value={editingReduction ? 'reduction:' : editingSlice && (selection.slice !== 'all' || !!selection.explanationList) ? '__selection' : editingUnassigned ? 'unassigned:' : editingStamp ? `stamp:${editingStamp}` : ''} disabled={busy} className="w-auto h-8 max-w-64 rounded-md border border-slate-200 bg-white pl-3 pr-8 text-xs text-slate-700" onChange={event => { setEditingReduction(event.target.value === 'reduction:'); setEditingUnassigned(event.target.value === 'unassigned:'); setEditingStamp(event.target.value.startsWith('stamp:') ? event.target.value.slice(6) : ''); setEditingSlice(false); setEditingFilter('all'); setFocusedJoint(null); setSelected(new Set()) }}>
        {editingSlice && (selection.slice !== 'all' || !!selection.explanationList) ? <option value="__selection">{selection.explanationList ? PROGRAM_EXPLANATION_LISTS[selection.explanationList] : slices[selection.slice]}{editingStamp ? ` · ${editingStamp}` : ''}</option> : null}
        {editingStamp && !stampOptions.includes(editingStamp) ? <option value={`stamp:${editingStamp}`}>Клеймо {editingStamp} · нет стыков</option> : null}
        <option value="">Все стыки линии</option>{draftHints.size > 0 || editingReduction ? <option value="reduction:">Возможно сократить</option> : null}{stampOptions.map(stamp => <option key={stamp} value={`stamp:${stamp}`}>Клеймо {stamp}</option>)}{hasUnassigned ? <option value="unassigned:">Клеймо не назначено</option> : null}
      </Select>}
      summary={<div><span aria-description="Черновик сохраняется при поиске, смене вкладки и страницы до ухода из раздела.">Изменений: <strong>{changes.length}</strong></span>{changes.length ? <ProgramChangeSummary changes={changes} rows={rowById} draft={draft} /> : null}</div>}
      review={review ? <div className="mb-2 space-y-1.5 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2" aria-label="Проверка изменений"><p className="text-xs text-slate-600">К сохранению: {review.changed} стыков. Фактические результаты сохраняются.</p>{review.excess && line.family === 'supports' ? <p className="text-sm text-amber-900">Обычных назначений сверх нормы: {review.excess}. Они останутся в «Лишнее»; для принятого дополнительного контроля выберите «Дополнительный».</p> : review.excess ? <label className="flex cursor-pointer items-start gap-2 text-sm text-amber-900"><Checkbox className="mt-1" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />Подтверждаю назначение сверх нормы / нескольких способов на одном стыке: {review.excess}. Это будет отмечено в сводке.</label> : <p className="text-xs text-slate-500">Новых назначений сверх нормы нет.</p>}</div> : null}
      actions={<>{manual.size > 0 ? <button type="button" disabled={busy} className="h-9 rounded px-2 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-700" onClick={async () => {
        if (!await confirm({ title: 'Отменить изменения назначений?', description: `Будет удалён только несохранённый черновик линии ${line.line}. Сохранённые назначения не изменятся.`, confirmLabel: 'Отменить изменения', cancelLabel: 'Оставить черновик', tone: 'warning' })) return
        resetReview(); setManual(new Map()); setFocusedMethod(undefined)
      }}>Отменить изменения</button> : null}{review ? <Button className="h-9" disabled={busy || overLimit || (!!review.excess && line.family !== 'supports' && !acknowledged)} onClick={() => save.mutate()}>Сохранить назначения</Button> : <Button className="h-9" disabled={busy || overLimit || !changes.length || !!errors.length || !!basisErrors.length} onClick={() => preview.mutate()}>Проверить изменения</Button>}</>}
      toolbar={<div data-testid="program-method-toolbar" className="space-y-1.5 border-b border-sky-100 bg-sky-50 px-3 py-1.5">
      <ProgramQuickFilters value={editingFilter} counts={editingCounts} disabled={busy} onChange={value => { setEditingFilter(value); setEditingSlice(false); setFocusedJoint(null) }} />
      <ProgramAssignmentGuidance groups={draftCalculation} rows={calculationRows} line={line} stamp={editingStamp || undefined} unassigned={editingUnassigned} draft={draft.size > 0} />
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="space-y-1.5"><span className="block text-xs font-medium text-slate-600">Методы</span><div className="flex flex-wrap gap-2">{PROGRAM_EDITOR_METHODS.filter(method => line.family !== 'supports' || method === 'УЗК' || method === 'ПВК').map(method => <button type="button" key={method} disabled={busy} aria-pressed={methods.has(method)} className={toggleClass(methods.has(method))} onClick={() => { if (method === 'Послойный ПВК' && !methods.has(method)) setAssignment('да'); setMethods(previous => toggleProgramMethodSelection(previous, method)) }}>{method}</button>)}</div></div>
        <div className="space-y-1.5 sm:border-l sm:border-sky-200 sm:pl-6"><span className="block text-xs font-medium text-slate-600">Действие</span><AssignmentActions value={assignment} onChange={setAssignment} busy={busy} layered={methods.has('Послойный ПВК')} /></div>
        {requiresControlAssignmentBasis(assignment) ? <label className="min-w-56 flex-1 text-xs font-medium text-slate-600">Основание к назначению *<Input aria-label="Основание для выбранных назначений" className="mt-1 h-9 bg-white" value={batchBasis} disabled={busy} onChange={event => setBatchBasis(event.target.value)} placeholder="Техрешение, документ или причина" /></label> : null}
        <div data-testid="program-batch-actions" className="ml-auto flex items-center gap-2">{resetButton}<Button className={programPrimaryActionClass} disabled={busy || !methods.size || !batchTargets.length || requiresControlAssignmentBasis(assignment) && !batchBasis.trim()} onClick={() => applyChanges(batchTargets, activePatch())}>Применить к выбранным ({batchTargets.length})</Button></div>
      </div>
      {methods.has('Послойный ПВК') && skipped > 0 ? <p role="status" className="text-xs text-amber-800">Послойный контроль: У-стыков — {batchTargets.length}. Пропущено С-стыков: {skipped}; их назначения не изменятся.</p> : null}
      {hiddenSelected > 0 ? <p role="status" className="text-xs text-amber-800">Выбрано вне текущего отбора: {hiddenSelected}. Массовое действие затронет и эти стыки; «Сбросить выбор» снимает все отметки.</p> : null}
      <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500"><p>Выберите стыки и действие или измените ячейку. ПКМ — документы.</p>{visibleReduction > 0 ? <button type="button" aria-label="Выделить кандидатов на снятие" title={`Назначений-кандидатов в текущем списке: ${visibleReduction} (жёлтый пунктир). Нажатие только выделит стыки, не снимая назначения.`} disabled={busy} className="inline-flex min-h-6 items-center rounded border border-dashed border-amber-400 bg-white px-1.5 text-amber-800 hover:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-40" onClick={() => setSelected(new Set(filteredEditingRows.filter(row => draftHints.has(row.id)).map(row => row.id)))}>Кандидаты на снятие: {visibleReduction} · Выделить</button> : null}</div>
    </div>}>
    {batchError ? <p role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{batchError} Изменения не применены.</p> : null}
    {overLimit ? <p role="alert" className="bg-amber-50 px-4 py-2 text-sm text-amber-900">Изменено {changes.length} стыков. За одно сохранение можно изменить не более 1000. Уменьшите черновик; автоматически разбивать сохранение система не будет.</p> : null}
    {staleDraft && !query.isPending ? <div role="alert" className="bg-amber-50 px-4 py-2 text-xs text-amber-900">Сохранённые данные изменились после начала черновика. В «было» показаны актуальные значения; проверьте их перед продолжением. Удалённые или перенесённые стыки сохранить здесь нельзя.<button type="button" disabled={busy} className="ml-2 rounded border border-amber-300 px-2 py-1" onClick={async () => {
      if (!await confirm({ title: 'Применить черновик к обновлённым данным?', description: 'Ваши значения назначений будут проверены относительно текущих записей. Просмотрите состав изменений; сохранение остаётся отдельным действием.', confirmLabel: 'Принять обновлённые данные', cancelLabel: 'Вернуться', tone: 'warning' })) return
      acceptCurrentVersions(); resetReview()
    }}>Принять обновлённые данные</button></div> : null}
    {cancellationHints.length ? <div role="note" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">{cancellationHints.map((hint, index) => <p key={index}>{hint}</p>)}</div> : null}
    {[query.error, preview.error, save.error].filter(Boolean).map((error, index) => <div key={index} className="p-3"><ProgramError error={error!} /></div>)}
    {preview.error || save.error ? <button type="button" disabled={busy || query.isFetching} className="mx-3 mb-3 rounded border border-sky-200 px-3 py-2 text-xs text-sky-700" onClick={async () => { setReview(null); await Promise.all([query.refetch(), queryClient.invalidateQueries({ queryKey: ['line-program', 'calculation', line.id] })]); preview.reset(); save.reset() }}>Обновить данные, сохранив черновик</button> : null}
    {errors.length ? <p role="alert" className="border-b bg-amber-50 p-3 text-sm text-amber-800">{errors.join(' ')}</p> : null}

    {feedback ? <p role="status" className="p-3 text-sm text-emerald-700">{feedback}</p> : null}
    {query.isPending ? <p role="status" className="p-6 text-sm text-slate-500">Загружаем стыки линии…</p> : <ProgramAssignmentTable onBasisChange={(row, key, value) => applyChanges([row], { [key]: value })} onFilterRows={visible => setGridFilteredIds(previous => previous && previous.size === visible.length && visible.every(row => previous.has(row.id)) ? previous : new Set(visible.map(row => row.id)))} sessionKey={`assignments:${line.family ?? 'welds'}:${line.id}`} removalHints={draftHints} rows={editingRows} selected={selected} draft={draft} busy={busy} canSelect={canSelect} onSelect={select} onSelectAll={(checked, visible) => setSelected(previous => { const next = new Set(previous); visible.filter(canSelect).forEach(row => checked ? next.add(row.id) : next.delete(row.id)); return next })} onChange={(row, method, value) => applyChanges([row], { [method]: value })} getError={getError} focusedJoint={focusedJoint} focusedMethod={focusedMethod} onContextMenu={(event, row) => { contextScope.current = editingSlice ? selection : { stamp: editingStamp || undefined, unassigned: editingUnassigned, slice: 'all' }; context.open(event, row) }} />}
    </LineProgramAssignmentDialog> : null}
    {context.menu}
  </>
}

const actionColors: Record<ProgramAssignment, string> = {
  'да': '!border-emerald-400 !bg-emerald-50 !text-emerald-800 ring-emerald-400',
  'дополнительный': '!border-amber-400 !bg-amber-50 !text-amber-800 ring-amber-400',
  'отменен': '!border-rose-400 !bg-rose-50 !text-rose-800 ring-rose-400',
  '': '!border-slate-400 !bg-slate-100 !text-slate-700 ring-slate-400',
}

function AssignmentActions({ value, onChange, busy, layered }: { value: ProgramAssignment; onChange: (value: ProgramAssignment) => void; busy: boolean; layered: boolean }) {
  return <div role="radiogroup" aria-label="Действие с назначениями" className="flex flex-wrap gap-2">{PROGRAM_ASSIGNMENT_OPTIONS.map(([option, label]) => <button key={option} type="button" role="radio" aria-checked={value === option} tabIndex={value === option ? 0 : -1} disabled={busy || (layered && option !== 'да')} title={layered && option !== 'да' ? 'Для послойного контроля доступно только «Да».' : undefined} className={`${value === option ? `${toggleClass(false)} ${actionColors[option]} ring-1 ring-inset` : toggleClass(false)} disabled:cursor-not-allowed disabled:opacity-40`} onClick={() => onChange(option)} onKeyDown={event => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const buttons = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const index = buttons.indexOf(event.currentTarget), step = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1
    const next = buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + step + buttons.length) % buttons.length]
    next?.focus(); next?.click()
  }}>{option === '' ? 'Пусто' : label}</button>)}</div>
}

const ProgramWorkspaceView = memo(function ProgramWorkspaceView({ line, selection, rows, removalHints, container, error, pending, feedback, onAssignments, onContextMenu, onRetry }: {
  line: LineProgramRecord; selection: ProgramSelection; rows: WeldRow[]; removalHints: ProgramRemovalHints; container: HTMLDivElement
  error: Error | null; pending: boolean; feedback: string; onRetry: () => void
  onAssignments: (scope: ProgramSelection, id?: number, method?: ProgramMethod) => void
  onContextMenu: (scope: ProgramSelection, event: React.MouseEvent | React.KeyboardEvent, row: WeldRow) => void
}) {
  const [api, setApi] = useState<GridApi<WeldRow> | null>(null)
  const [revealMessage, setRevealMessage] = useState('')
  const section = useRef<HTMLElement>(null)
  const lastReveal = useRef<number>(undefined)
  useEffect(() => {
    if (!selection.reveal || selection.reveal === lastReveal.current || pending || error) return
    let active = true
    let frame = 0
    let stableFrames = 0
    const cleanup = () => {
      active = false; cancelAnimationFrame(frame)
      for (const name of ['pointerdown', 'wheel', 'keydown']) window.removeEventListener(name, cancelReveal)
    }
    const cancelReveal = () => { lastReveal.current = selection.reveal; cleanup() }
    if (selection.focusedJoint) for (const name of ['pointerdown', 'wheel', 'keydown']) window.addEventListener(name, cancelReveal, { passive: true })
    const revealJoint = (remaining = 8) => {
      if (!active || !selection.focusedJoint || !api || api.isDestroyed()) return
      const node = api.getRowNode(String(selection.focusedJoint))
      if (node?.rowIndex == null || node.rowTop == null) return
      const grid = section.current?.querySelector<HTMLElement>('[data-program-grid="joints"]')
      const bounds = grid?.querySelector<HTMLElement>(`.ag-row[row-id="${selection.focusedJoint}"]`)?.getBoundingClientRect()
      if (bounds && bounds.top >= 80 && bounds.bottom <= window.innerHeight - 20) {
        // Wait for the nested detail/auto-height measurements to settle too.
        if (++stableFrames >= 3) { cleanup(); return }
      } else if (grid?.dataset.programPageScroll === 'true') {
        stableFrames = 0
        const header = grid.querySelector<HTMLElement>('.ag-grid-pinned-top-rows')?.offsetHeight ?? 0
        // This grid's viewport follows the document, not an independent
        // scrollbar. Use the model to render a distant row, then its actual DOM
        // geometry once the nested frame has moved into place.
        const center = bounds ? bounds.top + bounds.height / 2 : grid.getBoundingClientRect().top + header + node.rowTop + (node.rowHeight ?? 44) / 2
        window.scrollTo({ top: window.scrollY + center - window.innerHeight / 2, behavior: 'instant' })
      } else api.ensureNodeVisible(node, 'middle')
      if (remaining > 1) frame = requestAnimationFrame(() => revealJoint(remaining - 1))
      else cleanup()
    }
    const focus = (remaining = 3) => { frame = requestAnimationFrame(() => {
      if (!active) return
      if (remaining > 1) { focus(remaining - 1); return }
      lastReveal.current = selection.reveal
      section.current?.scrollIntoView?.({ block: 'start' }); section.current?.focus({ preventScroll: true })
      revealJoint()
    }) }
    if (!rows.length) { setRevealMessage(selection.focusedJoint ? 'Выбранного стыка больше нет в этой линии.' : ''); focus(); return cleanup }
    if (!api || api.isDestroyed()) return cleanup
    const targetMissing = !!selection.focusedJoint && !rows.some(row => row.id === selection.focusedJoint)
    const ids = selection.focusedJoint && !targetMissing ? [String(selection.focusedJoint)] : rows.map(row => String(row.id))
    void revealProgramComposition(api, ids, () => active).then(cleared => {
      if (!active) return
      setRevealMessage(targetMissing ? 'Выбранного стыка больше нет в этой линии. Показаны доступные стыки.' : cleared.length ? `Для показа ${selection.focusedJoint ? 'стыка' : 'полного состава'} сняты мешающие фильтры: ${cleared.join(', ')}.` : '')
      focus()
    }).catch(() => { if (active) setRevealMessage('Не удалось показать стыки. Повторите переход.') })
    return cleanup
  }, [selection.reveal, selection.focusedJoint, pending, error, rows, api])
  const assignments = useStableEventCallback((id: number, method?: ProgramMethod) => onAssignments(selection, id, method))
  const contextMenu = useStableEventCallback((event: React.MouseEvent | React.KeyboardEvent, row: WeldRow) => onContextMenu(selection, event, row))
  const scopeName = selection.unassigned ? 'без клейма' : selection.stamp ? `клейма ${selection.stamp}` : 'всей линии'
  return createPortal(<section ref={section} tabIndex={-1} data-testid="program-joint-workspace" className="min-w-0 scroll-mt-20 overflow-hidden bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500" aria-label={`Стыки ${scopeName} · ${line.line}`} aria-description={`Записей в выборке: ${rows.length}. Исторические записи не увеличивают число учитываемых соединений.`}>
    {error ? <div className="p-3"><ProgramError error={error} /><button type="button" onClick={onRetry}>Повторить загрузку состава</button></div> : null}
    {selection.explanationList && !pending && !error ? <p role="status" className="px-4 py-2 text-xs text-slate-600">{PROGRAM_EXPLANATION_LISTS[selection.explanationList]} · {rows.length ? `Записей: ${rows.length}.` : 'В этой части расчёта нет стыков. Данные могли измениться; обновите расчёт.'} {revealMessage}</p> : null}
    {selection.focusedJoint && revealMessage && !pending && !error ? <p role="status" className="px-4 py-2 text-xs text-slate-600">{revealMessage}</p> : null}
    {feedback ? <p role="status" className="px-4 py-2 text-sm text-emerald-700">{feedback}</p> : null}
    {pending ? <p role="status" className="p-6 text-sm text-slate-500">Загружаем стыки линии…</p> : error && selection.explanationList ? null : <ProgramReadOnlyTable onReady={setApi} focusedJoint={selection.focusedJoint} sessionKey={`joints:${line.family ?? 'welds'}:${line.id}:${programScopeKey(selection)}`} contextLabel={`${line.line} · ${scopeName}`} removalHints={removalHints} rows={rows} onAssignment={assignments} onContextMenu={contextMenu} />}
  </section>, container)
}, (before, after) => Object.keys(before).every(key => key === 'selection'
  ? (['stamp', 'unassigned', 'kind', 'slice', 'status', 'search', 'explanationList', 'reveal', 'focusedJoint'] as const).every(field => before.selection[field] === after.selection[field])
  : Object.is(before[key as keyof typeof before], after[key as keyof typeof after])))
