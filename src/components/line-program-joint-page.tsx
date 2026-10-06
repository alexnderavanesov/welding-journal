import { PROGRAM_SLICE_LABELS as slices } from '@/lib/line-program-labels'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { getExpectedWeldRowVersions } from '@/lib/weld-save-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { LineProgramRecord } from '@/lib/line-program'
import { calculateLineProgram, getLineProgramOfficialStamps, isLineProgramControlRow } from '@/lib/line-program-calculation'
import { countProgramRemovalHints, getProgramRemovalHints, type ProgramRemovalHints } from '@/lib/line-program-excess'
import { createProgramRowSelector } from '@/lib/line-program-selection'
import { applyProgramPatch, getProgramBatchTargets, matchesProgramScope, isProgramEditableRow, PROGRAM_ASSIGNMENT_OPTIONS, PROGRAM_METHODS, PROGRAM_EDITOR_METHODS, programAssignment, toggleProgramMethodSelection, type ProgramAssignment, type ProgramChange, type ProgramMethod, type ProgramPatch, type ProgramSelection } from '@/lib/line-program-workspace'
import { getLineProgramJointPage, type getLineProgramSection } from '@/server/line-program'
import { applyLineProgramControl, previewLineProgramControl, type LineProgramControlRequest } from '@/server/line-program-control'
import { LineProgramAssignmentDialog } from './line-program-assignment-dialog'
import { ProgramReadOnlyTable, ProgramAssignmentTable } from './line-program-assignment-table'
import { ProgramAssignmentGuidance } from './line-program-assignment-guidance'
import { useProgramDraft } from './line-program-drafts'
import type { ProgramScopeCommand } from './line-program-scope-menu'
import { lineProgramQueryPolicy, programPrimaryActionClass, ProgramError } from './line-program-primitives'
import { getProgramApprovalOptions, getProgramApprovalTargets, type ProgramApprovalOption } from '@/lib/program-approval-actions'
import { changeLineProgramApprovals } from '@/server/line-program-approvals'
import { ProgramApprovalActions } from './line-program-approval-actions'
import { invalidateProgramApprovalCaches } from '@/lib/program-approval-cache'
import { unpackProgramRows } from '@/lib/line-program-row-payload'
import { countProgramRows } from '@/lib/line-program-row-filters'
import { ProgramQuickFilters, type ProgramQuickFilter } from './line-program-quick-filters'

const toggleClass = (active: boolean) => `inline-flex min-h-9 min-w-16 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${active ? 'border-sky-600 bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-600' : 'border-slate-200 bg-white text-slate-600 hover:border-sky-300'}`

export function LineJointPage({ line, workspaces, onOpenReportRows, enabled = true, assignmentRequest, onAssignmentRequestHandled }: {
  line: LineProgramRecord; workspaces: { key: string; selection: ProgramSelection; container: HTMLDivElement | null; open: boolean }[]
  onOpenReportRows?: ProgramReportNavigation; enabled?: boolean
  assignmentRequest?: ProgramScopeCommand; onAssignmentRequestHandled?: (command: ProgramScopeCommand) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirmAction()
  const { requireEditPassword } = useSecurityGuard()
  const [selection, setSelection] = useState<ProgramSelection>({ slice: 'all' })
  const contextScope = useRef<ProgramSelection>({ slice: 'all' })
  const searchInput = useRef<HTMLInputElement>(null)
  const handledAssignmentRequest = useRef<ProgramScopeCommand | undefined>(undefined)
  const [editingAssignments, setEditingAssignments] = useState(false)
  const [editingStamp, setEditingStamp] = useState('')
  const [editingUnassigned, setEditingUnassigned] = useState(false)
  const [editingSlice, setEditingSlice] = useState(true)
  const [focusedJoint, setFocusedJoint] = useState<number | null>(null)
  const [jointSearch, setJointSearch] = useState('')
  const [editingFilter, setEditingFilter] = useState<ProgramQuickFilter>('all')
  const [batchError, setBatchError] = useState('')
  const [selected, setSelected] = useState(new Set<number>())
  const [methods, setMethods] = useState(new Set<ProgramMethod>())
  const [assignment, setAssignment] = useState<ProgramAssignment>('да')
  const [focusedMethod, setFocusedMethod] = useState<ProgramMethod | undefined>()
  const [review, setReview] = useState<{ token: string; excess: number; changed: number; request: LineProgramControlRequest } | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [feedback, setFeedback] = useState('')
  const query = useQuery({ queryKey: ['line-program', 'rows', line.id], queryFn: async () => unpackProgramRows(await getLineProgramJointPage({ data: { id: line.id } })), enabled, ...lineProgramQueryPolicy })
  const rows = query.data?.rows ?? []
  const rowVersions = useMemo(() => getExpectedWeldRowVersions(rows), [rows])
  const { manual, setManual, targets: draftTargets, acceptCurrentVersions } = useProgramDraft(line.id, rowVersions)
  const rowById = useMemo(() => new Map(rows.map(row => [row.id, row])), [rows])
  const staleDraft = [...draftTargets.values()].some(target => String(rowById.get(target.id)?.rowVersion ?? '') !== target.version)
  const historyProtection = loadSaveCheckSettings().controlHistoryProtection
  const activePatch = () => Object.fromEntries([...methods].map(method => [method, assignment])) as ProgramPatch
  const resetReview = () => { setReview(null); setAcknowledged(false); setFeedback(''); setBatchError(''); preview.reset(); save.reset() }
  const { changes, draft, errors } = useMemo(() => {
    const changes: ProgramChange[] = [], draft = new Map<number, WeldRow>(), errors: string[] = []
    for (const id of manual.keys()) if (!rowById.has(id)) errors.push(`Стык ID ${id} больше не входит в линию. Отмените его изменения или весь черновик.`)
    for (const row of rows) {
      const values = manual.get(row.id) ?? {}
      if (!Object.keys(values).length) continue
      try {
        const next = applyProgramPatch(row, values)
        if (PROGRAM_METHODS.some(method => programAssignment(row, method) !== programAssignment(next, method))) {
          changes.push({ id: row.id, values }); draft.set(row.id, next)
        }
      } catch (error) { errors.push(`${row.joint}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    return { changes, draft, errors }
  }, [rows, rowById, manual])
  const approvedKeys = useMemo(() => new Set(query.data?.approvedKeys), [query.data?.approvedKeys])
  const calculation = useMemo(() => calculateLineProgram(rows, line.weldControlPercent ?? 0, line.pvkControlPercent ?? 0, undefined, approvedKeys), [rows, line.weldControlPercent, line.pvkControlPercent, approvedKeys])
  const draftRows = useMemo(() => rows.map(row => draft.get(row.id) ?? row), [rows, draft])
  const draftCalculation = useMemo(() => draft.size ? calculateLineProgram(draftRows, line.weldControlPercent ?? 0, line.pvkControlPercent ?? 0, undefined, approvedKeys) : calculation, [draftRows, draft, calculation, line.weldControlPercent, line.pvkControlPercent, approvedKeys])
  const stampOptions = useMemo(() => [...new Map(rows.filter(isLineProgramControlRow).flatMap(getLineProgramOfficialStamps).map(stamp => [stamp.toLocaleLowerCase('ru'), stamp])).values()].sort((a, b) => a.localeCompare(b, 'ru')), [rows])
  const hasUnassigned = rows.some(row => matchesProgramScope(row, { unassigned: true }))
  const savedHints = useMemo(() => getProgramRemovalHints(line.id, rows, calculation, new Set(query.data?.approvedKeys)), [line.id, rows, calculation, query.data?.approvedKeys])
  const selectRows = useMemo(() => createProgramRowSelector(rows, calculation, line.id, new Set(query.data?.approvedKeys), savedHints), [rows, calculation, line.id, query.data?.approvedKeys, savedHints])
  const draftHints = useMemo(() => draft.size ? getProgramRemovalHints(line.id, draftRows, draftCalculation, new Set(query.data?.approvedKeys)) : savedHints, [line.id, draft, draftRows, draftCalculation, savedHints, query.data?.approvedKeys])
  const preview = useMutation({ mutationFn: async () => {
    if (staleDraft) throw new Error('Данные стыков изменились после начала редактирования. Сначала сравните и примите обновлённые данные.')
    if (!await requireEditPassword('проверка назначений контроля')) return null
    const changedIds = new Set(changes.map(change => change.id))
    const request: LineProgramControlRequest = { lineId: line.id, lineVersion: line.version, changes, targets: [...draftTargets.values()].filter(target => changedIds.has(target.id)) }
    return { ...await previewLineProgramControl({ data: request }), request }
  }, onSuccess: result => { if (result) { setReview(result); setAcknowledged(false) } } })
  const save = useMutation({ mutationFn: async () => {
    if (!review || !await requireEditPassword('сохранение назначений контроля')) return null
    if (cancellationHints.length && !await confirm({ title: 'Отменить назначения?', description: cancellationHints.join('\n'), confirmLabel: 'Подтвердить отмену', cancelLabel: 'Вернуться', tone: 'warning' })) return null
    return applyLineProgramControl({ data: { ...review.request, previewToken: review.token, confirmedExcess: acknowledged } })
  }, onError: () => setReview(null), onSuccess: async result => {
    if (!result) return
    setSelected(new Set()); setManual(new Map()); setReview(null); setFocusedMethod(undefined); setFeedback(`Назначения сохранены · стыков: ${result.changed}`)
    scheduleWeldDataRefresh(queryClient, { upsertRows: result.rows }, { skipLineProgramRefetch: !!result.lineSummary })
    if (result.lineSummary) {
      queryClient.setQueryData<Awaited<ReturnType<typeof getLineProgramSection>>>(['line-program', 'section'], previous => previous ? { rows: previous.rows.map(item => item.id === line.id ? result.lineSummary! : item) } : previous)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['line-program', 'calculation', line.id] }),
        queryClient.invalidateQueries({ queryKey: ['line-program', 'rows', line.id] }),
        queryClient.invalidateQueries({ queryKey: ['line-program', 'explanation', line.id], refetchType: 'active' }),
      ])
    }
  } })
  const approvalOptions = useMemo(() => getProgramApprovalOptions(rows, line, query.data?.approvals ?? []), [rows, line, query.data?.approvals])
  const approvedRowIds = useMemo(() => new Set(approvalOptions.revoke.map(item => item.rowId)), [approvalOptions])
  const approval = useMutation({ mutationFn: async ({ action, entries }: { action: 'approve' | 'revoke'; entries: ProgramApprovalOption[] }) => {
    if (manual.size) throw new Error('Сначала сохраните или отмените черновик назначений.')
    if (!await requireEditPassword('изменение согласования контроля')) return null
    const ids = new Set(entries.map(item => item.rowId))
    if (ids.size > 1000) throw new Error('За одно действие можно согласовать не более 1000 стыков.')
    if (!await confirm({ title: action === 'approve' ? 'Согласовать контроль?' : 'Снять согласование?',
      description: `${action === 'approve' ? entries.every(entry => entry.duplicate) ? 'Подтверждается необходимость сочетания методов независимо от процента. Согласованное сочетание не будет показано как лишнее и не вызовет ДЗ-27.' : 'Подтверждается сохранение назначений сверх нормы. Обычное превышение остаётся в показателе «Лишнее»; это не согласование сочетания методов.' : 'Подтверждение будет удалено из «Принятых исключений». Предупреждения вернутся, если их причина сохраняется.'}\nСтыков: ${ids.size}. Назначения, заявки, результаты и заключения не изменятся. Защита очистки выполненного контроля сохраняется.`,
      confirmLabel: action === 'approve' ? 'Согласовать' : 'Снять согласование', cancelLabel: 'Вернуться', tone: 'warning' })) return null
    return changeLineProgramApprovals({ data: { lineId: line.id, lineVersion: line.version, action, confirmed: true, keys: entries.map(item => item.key), targets: getProgramApprovalTargets(rowVersions.filter(item => ids.has(item.id)), query.data?.approvals ?? []) } })
  }, onSuccess: async (result, { action }) => {
    if (!result) return
    resetReview(); setSelected(new Set()); setFeedback(`${action === 'approve' ? 'Контроль согласован' : 'Согласование снято'} · стыков: ${result.changed}. Назначения и документы не изменены.`)
    queryClient.setQueryData<Awaited<ReturnType<typeof getLineProgramSection>>>(['line-program', 'section'], previous => previous ? { rows: previous.rows.map(item => item.id === line.id ? result.lineSummary : item) } : previous)
    await invalidateProgramApprovalCaches(queryClient, line.id)
  } })
  const busy = preview.isPending || save.isPending || approval.isPending
  const canSelect = (row: WeldRow) => isProgramEditableRow(row) || approvedRowIds.has(row.id)
  const select = (id: number, checked: boolean) => { setSelected(previous => { const next = new Set(previous); checked ? next.add(id) : next.delete(id); return next }) }
  const mergedValues = (row: WeldRow, patch: ProgramPatch) => {
    const values = { ...manual.get(row.id), ...patch }
    for (const method of PROGRAM_METHODS) if (values[method] === programAssignment(row, method)) delete values[method]
    return values
  }
  const getError = (row: WeldRow, method: ProgramMethod, value: ProgramAssignment) => getProgramAssignmentError(row, mergedValues(row, { [method]: value }), historyProtection)
  const applyChanges = (targets: WeldRow[], patch: ProgramPatch) => {
    const updates = targets.map(row => ({ row, values: mergedValues(row, patch) }))
    const problems = updates.map(({ row, values }) => { const error = getProgramAssignmentError(row, values, historyProtection); return error ? `${row.joint}: ${error}` : '' }).filter(Boolean)
    resetReview()
    if (problems.length) { setBatchError(problems.join(' ')); return }
    setManual(previous => { const next = new Map(previous); for (const { row, values } of updates) Object.keys(values).length ? next.set(row.id, values) : next.delete(row.id); return next })
  }
  const openAssignments = (scope: ProgramSelection, id?: number, method?: ProgramMethod) => {
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
    setEditingSlice(true)
    setEditingFilter(scope.status ?? (scope.slice === 'missing' ? 'missing' : 'all'))
    setEditingAssignments(true)
  }
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
  const editingScopeRows = selectRows(editingScope)
  const editingCounts = useMemo(() => countProgramRows(editingScopeRows), [editingScopeRows])
  const scopedEditingRows = selectRows({ ...(editingSlice ? selection : editingScope), search: undefined,
    slice: editingFilter === 'missing' ? 'missing' : editingSlice ? selection.slice : 'all',
    status: editingFilter !== 'all' && editingFilter !== 'missing' ? editingFilter : undefined })
  const needle = jointSearch.trim().toLocaleLowerCase('ru')
  const editingRows = useMemo(() => !needle ? scopedEditingRows : scopedEditingRows.filter(row => {
    const value = draft.get(row.id) ?? row
    return [row.joint, row.connectionType, ...getLineProgramOfficialStamps(row), calculateFinalStatus(value), value.vikResult, value.rkResult, value.uzkResult, value.pvkResult,
      ...PROGRAM_METHODS.map(method => `${method} ${programAssignment(value, method)}`)].map(text => String(text ?? '')).join(' ').toLocaleLowerCase('ru').includes(needle)
  }), [scopedEditingRows, needle, draft])
  const visibleReduction = editingAssignments ? countProgramRemovalHints(draftHints, editingRows.map(row => row.id)) : 0
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
  const cancellationHints = [...draft].flatMap(([id, next]) => {
    const row = rowById.get(id)!, hint = getWeldFormCancellationResultHint(next, row)
    return hint ? [`${row.joint}: ${hint}`] : []
  })
  const batchTargets = getProgramBatchTargets(rows.filter(row => selected.has(row.id) && isProgramEditableRow(row)), activePatch())
  const skipped = selected.size - batchTargets.length
  const hiddenSelected = selected.size - editingRows.filter(row => selected.has(row.id)).length
  const overLimit = changes.length > 1000
  const resetButton = <button type="button" disabled={busy || !selected.size} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 disabled:opacity-40" onClick={() => setSelected(new Set())}>Сбросить выбор</button>
  return <>{workspaces.map(workspace => workspace.container ? <ProgramWorkspaceView key={workspace.key} line={line} selection={workspace.selection} rows={selectRows(workspace.selection)} removalHints={savedHints} container={workspace.container} error={query.error} pending={query.isPending} feedback={feedback && !editingAssignments ? feedback : ''} onAssignments={(id, method) => openAssignments(workspace.selection, id, method)} onContextMenu={(event, row) => { contextScope.current = workspace.selection; context.open(event, row) }} /> : null)}
    {editingAssignments && enabled ? <LineProgramAssignmentDialog line={line.line} context={<>{line.line} → {editingUnassigned ? 'Клеймо не назначено' : editingStamp ? <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">Клеймо {editingStamp}</span> : 'Все стыки линии'} · стыков: {editingRows.length}{focusedRow ? <span className="ml-2 font-semibold text-sky-800">→ Стык {String(focusedRow.joint)}</span> : null}<span className="mt-1 block text-xs text-slate-500">{editingSlice ? slices[selection.slice] : 'Все стыки'}</span></>} busy={busy} onClose={() => setEditingAssignments(false)}
      searchControl={<div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" /><Input ref={searchInput} className="h-8 bg-white pl-8 pr-8 text-xs" aria-label="Поиск стыков в назначениях" placeholder="Поиск стыков…" title="Стык, клеймо, состояние или назначение" value={jointSearch} onChange={event => { setJointSearch(event.target.value); setFocusedJoint(null) }} />{jointSearch ? <button type="button" aria-label="Очистить поиск стыков" title="Очистить поиск стыков" className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500" onClick={() => { setJointSearch(''); searchInput.current?.focus() }}><X aria-hidden="true" className="h-3.5 w-3.5" /></button> : null}</div>}
      scopeControl={<select aria-label="Стыки в окне назначений" value={editingSlice && selection.slice !== 'all' ? '__selection' : editingUnassigned ? 'unassigned:' : editingStamp ? `stamp:${editingStamp}` : ''} disabled={busy} className="h-8 max-w-64 rounded-md border border-slate-200 bg-white pl-3 pr-8 text-xs text-slate-700" onChange={event => { setEditingUnassigned(event.target.value === 'unassigned:'); setEditingStamp(event.target.value.startsWith('stamp:') ? event.target.value.slice(6) : ''); setEditingSlice(false); setEditingFilter('all'); setFocusedJoint(null); setSelected(new Set()) }}>
        {editingSlice && selection.slice !== 'all' ? <option value="__selection">{slices[selection.slice]}{editingStamp ? ` · ${editingStamp}` : ''}</option> : null}
        {editingStamp && !stampOptions.includes(editingStamp) ? <option value={`stamp:${editingStamp}`}>Клеймо {editingStamp} · нет стыков</option> : null}
        <option value="">Все стыки линии</option>{stampOptions.map(stamp => <option key={stamp} value={`stamp:${stamp}`}>Клеймо {stamp}</option>)}{hasUnassigned ? <option value="unassigned:">Клеймо не назначено</option> : null}
      </select>}
      summary={<div><span title="Черновик сохраняется при поиске, смене вкладки и страницы до ухода из раздела.">Изменений: <strong>{changes.length}</strong></span>{changes.length ? <ProgramChangeSummary changes={changes} rows={rowById} draft={draft} /> : null}</div>}
      review={review ? <div className="mb-2 space-y-1.5 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2" aria-label="Проверка изменений"><p className="text-xs text-slate-600">К сохранению: {review.changed} стыков. Фактические результаты сохраняются.</p>{review.excess ? <label className="flex cursor-pointer items-start gap-2 text-sm text-amber-900"><input type="checkbox" className="mt-1 accent-sky-600" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />Подтверждаю назначение сверх нормы / нескольких способов на одном стыке: {review.excess}. Это будет отмечено в сводке.</label> : <p className="text-xs text-slate-500">Новых назначений сверх нормы нет.</p>}</div> : null}
      actions={<>{manual.size > 0 ? <button type="button" disabled={busy} className="h-9 rounded px-2 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-700" onClick={async () => {
        if (!await confirm({ title: 'Отменить изменения назначений?', description: `Будет удалён только несохранённый черновик линии ${line.line}. Сохранённые назначения не изменятся.`, confirmLabel: 'Отменить изменения', cancelLabel: 'Оставить черновик', tone: 'warning' })) return
        resetReview(); setManual(new Map()); setFocusedMethod(undefined)
      }}>Отменить изменения</button> : null}{review ? <Button className="h-9" disabled={busy || overLimit || (!!review.excess && !acknowledged)} onClick={() => save.mutate()}>Сохранить назначения</Button> : <Button className="h-9" disabled={busy || overLimit || !changes.length || !!errors.length} onClick={() => preview.mutate()}>Проверить изменения</Button>}</>}
      toolbar={<div data-testid="program-method-toolbar" className="space-y-1.5 border-b border-sky-100 bg-sky-50 px-3 py-1.5">
      <ProgramQuickFilters value={editingFilter} counts={editingCounts} disabled={busy} onChange={value => { setEditingFilter(value); setEditingSlice(false); setFocusedJoint(null) }} />
      <ProgramAssignmentGuidance groups={draftCalculation} rows={draftRows} line={line} stamp={editingStamp || undefined} unassigned={editingUnassigned} draft={draft.size > 0} />
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="space-y-1.5"><span className="block text-xs font-medium text-slate-600">Методы</span><div className="flex flex-wrap gap-2">{PROGRAM_EDITOR_METHODS.map(method => <button type="button" key={method} disabled={busy} aria-pressed={methods.has(method)} className={toggleClass(methods.has(method))} onClick={() => { if (method === 'Послойный ПВК' && !methods.has(method)) setAssignment('да'); setMethods(previous => toggleProgramMethodSelection(previous, method)) }}>{method}</button>)}</div></div>
        <div className="space-y-1.5 sm:border-l sm:border-sky-200 sm:pl-6"><span className="block text-xs font-medium text-slate-600">Действие</span><AssignmentActions value={assignment} onChange={setAssignment} busy={busy} layered={methods.has('Послойный ПВК')} /></div>
        <div data-testid="program-batch-actions" className="ml-auto flex items-center gap-2">{resetButton}<Button className={programPrimaryActionClass} disabled={busy || !methods.size || !batchTargets.length} onClick={() => applyChanges(batchTargets, activePatch())}>Применить к выбранным ({batchTargets.length})</Button></div>
      </div>
      {methods.has('Послойный ПВК') && skipped > 0 ? <p role="status" className="text-xs text-amber-800">Послойный контроль: У-стыков — {batchTargets.length}. Пропущено С-стыков: {skipped}; их назначения не изменятся.</p> : null}
      {hiddenSelected > 0 ? <p role="status" className="text-xs text-amber-800">Выбрано вне текущего поиска: {hiddenSelected}. Массовое действие затронет и эти стыки; «Сбросить выбор» снимает все отметки.</p> : null}
      <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500"><p>Выберите стыки и действие или измените ячейку. ПКМ — документы.</p>{visibleReduction > 0 ? <button type="button" aria-label="Выделить кандидатов на снятие" title={`Назначений-кандидатов в текущем списке: ${visibleReduction} (жёлтый пунктир). Нажатие только выделит стыки, не снимая назначения.`} disabled={busy} className="inline-flex min-h-6 items-center rounded border border-dashed border-amber-400 bg-white px-1.5 text-amber-800 hover:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-40" onClick={() => setSelected(new Set(editingRows.filter(row => draftHints.has(row.id)).map(row => row.id)))}>Кандидаты на снятие: {visibleReduction} · Выделить</button> : null}<ProgramApprovalActions approve={approvalOptions.approve.filter(item => selected.has(item.rowId))} revoke={approvalOptions.revoke.filter(item => selected.has(item.rowId))} disabled={busy} draft={manual.size > 0} onAction={(action, entries) => approval.mutate({ action, entries })} /></div>
    </div>}>
    {batchError ? <p role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{batchError} Изменения не применены.</p> : null}
    {overLimit ? <p role="alert" className="bg-amber-50 px-4 py-2 text-sm text-amber-900">Изменено {changes.length} стыков. За одно сохранение можно изменить не более 1000. Уменьшите черновик; автоматически разбивать сохранение система не будет.</p> : null}
    {staleDraft && !query.isPending ? <div role="alert" className="bg-amber-50 px-4 py-2 text-xs text-amber-900">Сохранённые данные изменились после начала черновика. В «было» показаны актуальные значения; проверьте их перед продолжением. Удалённые или перенесённые стыки сохранить здесь нельзя.<button type="button" disabled={busy} className="ml-2 rounded border border-amber-300 px-2 py-1" onClick={async () => {
      if (!await confirm({ title: 'Применить черновик к обновлённым данным?', description: 'Ваши значения назначений будут проверены относительно текущих записей. Просмотрите состав изменений; сохранение остаётся отдельным действием.', confirmLabel: 'Принять обновлённые данные', cancelLabel: 'Вернуться', tone: 'warning' })) return
      acceptCurrentVersions(); resetReview()
    }}>Принять обновлённые данные</button></div> : null}
    {cancellationHints.length ? <div role="note" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">{cancellationHints.map((hint, index) => <p key={index}>{hint}</p>)}</div> : null}
    {[query.error, preview.error, save.error, approval.error].filter(Boolean).map((error, index) => <div key={index} className="p-3"><ProgramError error={error!} /></div>)}
    {preview.error || save.error || approval.error ? <button type="button" disabled={busy || query.isFetching} className="mx-3 mb-3 rounded border border-sky-200 px-3 py-2 text-xs text-sky-700" onClick={async () => { setReview(null); await Promise.all([query.refetch(), queryClient.invalidateQueries({ queryKey: ['line-program', 'calculation', line.id] })]); preview.reset(); save.reset(); approval.reset() }}>Обновить данные, сохранив черновик</button> : null}
    {errors.length ? <p role="alert" className="border-b bg-amber-50 p-3 text-sm text-amber-800">{errors.join(' ')}</p> : null}

    {feedback ? <p role="status" className="p-3 text-sm text-emerald-700">{feedback}</p> : null}
    {query.isPending ? <p role="status" className="p-6 text-sm text-slate-500">Загружаем стыки линии…</p> : <ProgramAssignmentTable approvedRowIds={approvedRowIds} removalHints={draftHints} rows={editingRows} selected={selected} draft={draft} busy={busy} canSelect={canSelect} onSelect={select} onSelectAll={checked => setSelected(previous => { const next = new Set(previous); editingRows.filter(canSelect).forEach(row => checked ? next.add(row.id) : next.delete(row.id)); return next })} onChange={(row, method, value) => applyChanges([row], { [method]: value })} getError={getError} focusedJoint={focusedJoint} focusedMethod={focusedMethod} onContextMenu={(event, row) => { contextScope.current = editingSlice ? selection : { stamp: editingStamp || undefined, unassigned: editingUnassigned, slice: 'all' }; context.open(event, row) }} />}
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
  return <div role="radiogroup" aria-label="Действие с назначениями" className="flex flex-wrap gap-2">{PROGRAM_ASSIGNMENT_OPTIONS.map(([option, label]) => <button key={option} type="button" role="radio" aria-checked={value === option} tabIndex={value === option ? 0 : -1} disabled={busy || (layered && option !== 'да')} title={layered && option !== 'да' ? 'Для послойного контроля доступно только «Да».' : label} className={`${value === option ? `${toggleClass(false)} ${actionColors[option]} ring-1 ring-inset` : toggleClass(false)} disabled:cursor-not-allowed disabled:opacity-40`} onClick={() => onChange(option)} onKeyDown={event => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const buttons = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const index = buttons.indexOf(event.currentTarget), step = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1
    const next = buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + step + buttons.length) % buttons.length]
    next?.focus(); next?.click()
  }}>{option === '' ? 'Пусто' : label}</button>)}</div>
}

function ProgramWorkspaceView({ line, selection, rows, removalHints, container, error, pending, feedback, onAssignments, onContextMenu }: {
  line: LineProgramRecord; selection: ProgramSelection; rows: WeldRow[]; removalHints: ProgramRemovalHints; container: HTMLDivElement
  error: Error | null; pending: boolean; feedback: string
  onAssignments: (id?: number, method?: ProgramMethod) => void
  onContextMenu: (event: React.MouseEvent, row: WeldRow) => void
}) {
  const scopeName = selection.unassigned ? 'без клейма' : selection.stamp ? `клейма ${selection.stamp}` : 'всей линии'
  return createPortal(<section data-testid="program-joint-workspace" className="min-w-0 overflow-hidden bg-white" aria-label={`Стыки ${scopeName} · ${line.line}`} aria-description={`Записей в выборке: ${rows.length}. Исторические записи не увеличивают число учитываемых соединений.`}>
    {error ? <div className="p-3"><ProgramError error={error} /></div> : null}
    {feedback ? <p role="status" className="px-4 py-2 text-sm text-emerald-700">{feedback}</p> : null}
    {pending ? <p role="status" className="p-6 text-sm text-slate-500">Загружаем стыки линии…</p> : <ProgramReadOnlyTable removalHints={removalHints} rows={rows} onAssignment={onAssignments} onContextMenu={onContextMenu} />}
  </section>, container)
}
