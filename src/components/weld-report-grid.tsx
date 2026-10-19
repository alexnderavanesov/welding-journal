import { positionGridPopup } from './grid-popup-position'
import { useGridResultMotion } from './use-grid-result-motion'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { type RowHeightParams, type IRowNode, type ColDef, type ColGroupDef, type GridApi, type RowSelectionOptions, type CellPosition, type GetColumnMenuItemsParams, type MenuItemDef, type DefaultMenuItem } from 'ag-grid-community'
import { AgGridProvider, AgGridReact } from 'ag-grid-react'
import { ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, Copy } from 'lucide-react'
import type { WeldTableProps } from './weld-table'
import { getWeldTableBodyCellTooltip } from './weld-table-body-cell'
import { ContextActionMenu } from './context-action-menu'
import { JournalGridToolbar } from './welding-journal-grid-toolbar'
import { JournalColumnHeading } from './welding-journal-column-heading'
import { JournalGroupingControls, type JournalGrouping } from './welding-journal-grouping-controls'
import { JournalGridContext, JournalFilterContext, JournalExtrasContext, useJournalCellContext } from './welding-journal-grid-context'
import { MODULES, THEMES, LOCALE, SELECTION_COLUMN, groupRowClass, PLAIN_FIELDS, journalColumnWidth } from './welding-journal-grid-config'
import { JournalGroupAnchor, JournalGroupCell, aggregateJournalGroup } from './welding-journal-group-summary'
import { createWeldGroupSummarizer } from '@/lib/weld-group-summary'
import { JournalPlainCell, JournalCell, JournalActions, JournalReportActions, JournalExtraCell } from './welding-journal-grid-cells'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'
import { JOURNAL_SERVER_FILTER } from './welding-journal-grid-filter'
import { useWeldReportViewState } from '@/lib/use-weld-report-view-state'
import { useWeldTableEditability } from '@/lib/use-weld-table-editability'
import { getAvailableWeldTableSections } from '@/lib/weld-table-sections'
import { FIELD_BY_KEY, isVirtualWeldField, type WeldFieldKey } from '@/lib/weld-fields'
import { getCellKey, getDuplicateKey, getDuplicateKeys } from '@/lib/weld-table-utils'
import { DEFAULT_PAGE_SIZE_OPTIONS } from '@/lib/use-pagination'
import { useJournalGridFocus } from '@/lib/use-journal-grid-focus'
import { useJournalPageScroll } from '@/lib/use-journal-page-scroll'
import { REPORT_LEFT_ALIGNED_FIELDS } from '@/lib/report-column-alignment'
import { useJournalRangeSummary } from '@/lib/use-journal-range-summary'
import { restoreJournalGridSelection } from '@/lib/journal-grid-selection'
import { JOURNAL_GROUP_LABEL_COLUMN as GROUP_LABEL_COLUMN, formatJournalNumber, journalClipboardValue, journalColumnLayout, mergeJournalSelection, readJournalGridStorage, writeJournalGridStorage, type JournalGridStorage } from '@/lib/welding-journal-grid-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getWeldReportExportFields, type WeldReportExportFieldsRef } from '@/lib/weld-report-export-fields'
import { useWeldTableContextMenu } from '@/lib/use-weld-table-context-menu'
import { isModalDialogOpen } from '@/lib/modal-layer'
import { WELD_GRID_PROFILES, type AgGridWeldReport } from '@/lib/weld-report-grid-profile'
import './welding-journal-grid.css'

const EMPTY_FIELDS = new Set<WeldFieldKey>()
const EMPTY_SECTIONS = new Set<string>()
const EMPTY_IDS = new Set<number>()
const NOOP = () => undefined
const ALLOW = () => true
const SERVER_ORDER = () => 0
const CELL_SELECTION = { suppressMultiRanges: false }
type WeldReportGridProps = WeldTableProps & {
  report: AgGridWeldReport
  renderSummary?: (beforeSearch?: ReactNode) => ReactNode
  reportExportFieldsRef?: WeldReportExportFieldsRef
}

export function WeldReportGrid(props: WeldReportGridProps) {
  return <AgGridProvider modules={MODULES} licenseKey={import.meta.env.VITE_AG_GRID_LICENSE_KEY || undefined}>
    <ReportGrid key={props.report} {...props} />
  </AgGridProvider>
}

function ReportGrid(props: WeldReportGridProps) {
  const { report } = props
  const profile = WELD_GRID_PROFILES[report]
  const { rows, columnFilters, rowsReady = true, selectedRowIds = EMPTY_IDS, sort = null } = props
  const [api, setApi] = useState<GridApi<WeldRow> | null>(null)
  const { reportExportFieldsRef } = props
  useEffect(() => {
    if (!api || !reportExportFieldsRef) return
    reportExportFieldsRef.current = requestedReport => requestedReport !== report || api.isDestroyed() ? null
      : getWeldReportExportFields(api.getAllDisplayedColumns().map(column => column.getColId()))
    return () => { reportExportFieldsRef.current = null }
  }, [api, reportExportFieldsRef, report])
  const [settings, setSettings] = useState<JournalGridStorage>(() => readJournalGridStorage(profile.storageKey))
  const settingsRef = useRef(settings)
  const restoringSelection = useRef(false)
  const restoringLayout = useRef(false)
  const initialLayout = useRef<JournalGridStorage['columns']>([])
  const frame = useRef<HTMLDivElement>(null)
  const resultMotion = useGridResultMotion(frame, { opacity: .94, duration: 120 })
  const resultScope = JSON.stringify([props.queryIdentity, columnFilters, sort])
  const revealedScope = useRef(resultScope)
  useEffect(() => {
    if (!rowsReady) { resultMotion.cancel(); return }
    if (revealedScope.current === resultScope) return
    revealedScope.current = resultScope
    resultMotion.reveal()
  }, [resultScope, rowsReady, resultMotion])
  const focus = useJournalGridFocus(api, frame)
  useJournalPageScroll(frame)
  const [openColumnsRequest, setOpenColumnsRequest] = useState(0)
  const [groupings, setGroupings] = useState<JournalGrouping[]>([])
  const [groupAnchor, setGroupAnchor] = useState('line')
  const updateGroupAnchor = useCallback((grid: GridApi<WeldRow>) => {
    const fields = grid.getAllDisplayedColumns().filter(column => FIELD_BY_KEY.has(column.getColId() as WeldFieldKey))
    const fallback = !fields.length && grid.getRowGroupColumns().length > 0
    // A saved view may hide every data column. Groups must still be named and expandable.
    if (grid.getColumn(GROUP_LABEL_COLUMN)?.isVisible() !== fallback) grid.setColumnsVisible([GROUP_LABEL_COLUMN], fallback)
    setGroupAnchor(fields.find(column => column.getColId() === 'line')?.getColId() ?? fields[0]?.getColId() ?? GROUP_LABEL_COLUMN)
  }, [])
  const summarizeGroup = useMemo(() => createWeldGroupSummarizer(rows, undefined, { heatTreatment: report === 'heatTreatment' }), [rows, report])
  const getGroupRowAgg = useCallback((params: Parameters<typeof aggregateJournalGroup>[0]) => aggregateJournalGroup(params, summarizeGroup), [summarizeGroup])
  const { summary: rangeSummary, update: updateRangeSummary } = useJournalRangeSummary(api)
  const lastVerticalScrollTop = useRef(0)
  const loadMoreAfterScroll = useRef(false)
  const popupColumn = useRef<string | null>(null)
  const updateSettings = useCallback((next: JournalGridStorage) => {
    settingsRef.current = next
    setSettings(next)
    writeJournalGridStorage(next, profile.storageKey)
  }, [profile.storageKey])
  const sections = useMemo(() => getAvailableWeldTableSections({
    hiddenFieldKeys: props.hiddenFieldKeys ?? EMPTY_FIELDS, mergePstoSections: props.mergePstoSections ?? false, sectionLayout: props.sectionLayout,
  }), [props.hiddenFieldKeys, props.mergePstoSections, props.sectionLayout])
  // Hiding columns is a personal preference here; other reports keep their rules.
  const alwaysVisible = EMPTY_FIELDS
  const extraSectionSignature = JSON.stringify([...new Set((props.extraColumns ?? []).filter(column => column.collapsible).map(column => column.section))])
  const extraSections = useMemo<string[]>(() => JSON.parse(extraSectionSignature), [extraSectionSignature])
  const viewSections = useMemo(() => [...sections, ...extraSections.map(section => ({ section, fields: [] }))], [sections, extraSections])
  const reportView = useWeldReportViewState({
    storageKey: report, sections: viewSections, alwaysVisibleFieldKeys: alwaysVisible,
    defaultCollapsedSections: props.defaultCollapsedSections ?? EMPTY_SECTIONS,
    columnFilters, sort, onColumnFiltersChange: props.onColumnFiltersChange, onSortChange: props.onSortChange ?? NOOP,
  })
  const { canEditField, canEditCell } = useWeldTableEditability({
    onEdit: props.onEdit ? NOOP : undefined, readOnly: props.readOnly ?? false,
    editableFieldKeys: props.editableFieldKeys ?? EMPTY_FIELDS, blockedFieldKeys: props.blockedFieldKeys ?? EMPTY_FIELDS,
    isCellEditable: props.isCellEditable ?? ALLOW,
  })
  const actionRows = useMemo(() => {
    const map = new Map((props.actionRows ?? props.duplicateRows ?? rows).map(row => [row.id, row]))
    for (const row of rows) map.set(row.id, { ...map.get(row.id), ...row })
    return map
  }, [props.actionRows, props.duplicateRows, rows])
  const getActionRow = useCallback((row: WeldRow) => actionRows.get(row.id) ?? row, [actionRows])
  const contextRows = useMemo(() => [...actionRows.values()], [actionRows])
  const rowMenu = useWeldTableContextMenu({
    rowsReady, queryIdentity: props.queryIdentity ?? '', selectedIds: selectedRowIds, rows: contextRows,
    loadRowsByIds: props.loadContextMenuRows, onError: props.onContextMenuError,
    getItems: (row, selected, fieldKey) => [...(props.getContextMenuItems?.(row, selected, fieldKey) ?? []),
      { type: 'separator', id: 'grid-copy-separator' }, {
        id: 'grid-copy', label: 'Копировать выделенные ячейки', icon: Copy,
        onSelect: () => api?.copySelectedRangeToClipboard(),
      }],
  })
  const duplicates = useMemo(() => props.duplicateKeyOverrides ?? getDuplicateKeys(props.duplicateRows ?? rows), [props.duplicateKeyOverrides, props.duplicateRows, rows])
  const openMenu = useStableEventCallback((source: WeldRow, position: { x: number; y: number; anchorElement?: Element }, fieldKey?: WeldFieldKey) => {
    if (!rowsReady) return
    focus.remember()
    rowMenu.openRow(getActionRow(source), position, fieldKey)
  })

  const openGroupMenu = (node: IRowNode<WeldRow>, anchor: HTMLElement, position: { x: number; y: number }) => {
    if (!rowsReady || !api || api.isDestroyed()) return
    const focusGroup = (group: IRowNode<WeldRow>) => {
      const column = api.getColumn(groupAnchor)
      if (column && group.rowIndex != null) api.setFocusedCell(group.rowIndex, column)
      focus.remember()
    }
    const setExpanded = (expanded: boolean, all = false) => {
      if (api.isDestroyed()) return
      let target = node
      // Collapsing every level hides a nested menu anchor; return focus to its root group.
      if (all && !expanded) while (target.parent && target.parent.level >= 0) target = target.parent
      if (all) {
        if (expanded) api.expandAll()
        else api.collapseAll()
      } else node.setExpanded(expanded, undefined, true)
      focusGroup(target)
    }
    focusGroup(node)
    rowMenu.openCustom({ ...position, anchorElement: anchor, heading: `Группа: ${node.key || '(Пусто)'}`,
      description: 'Группировки загруженных строк', items: [
        { id: 'group-collapse', label: 'Свернуть', icon: ChevronUp, disabled: !node.expanded, onSelect: () => setExpanded(false) },
        { id: 'group-expand', label: 'Развернуть', icon: ChevronDown, disabled: Boolean(node.expanded), onSelect: () => setExpanded(true) },
        { type: 'separator', id: 'group-all-separator' },
        { id: 'group-collapse-all', label: 'Свернуть все', icon: ChevronsUp, onSelect: () => setExpanded(false, true) },
        { id: 'group-expand-all', label: 'Развернуть все', icon: ChevronsDown, onSelect: () => setExpanded(true, true) },
      ],
    })
  }

  const captureLayout = useCallback(() => {
    if (!api || api.isDestroyed() || restoringLayout.current) return
    const columns = journalColumnLayout(api.getColumnState())
    if (JSON.stringify(columns) !== JSON.stringify(settingsRef.current.columns)) updateSettings({ ...settingsRef.current, columns })
  }, [api, updateSettings])
  const applyLayout = useCallback((columns: JournalGridStorage['columns']) => {
    if (!api || api.isDestroyed()) return
    restoringLayout.current = true
    try { api.applyColumnState({ state: columns, applyOrder: true }) }
    finally { restoringLayout.current = false }
  }, [api])
  useEffect(() => { applyLayout(settingsRef.current.columns) }, [applyLayout])
  const view = {
    ...reportView,
    saveView: (name: string) => {
      if (!reportView.saveView(name)) return false
      const layout = { columns: journalColumnLayout(api?.getColumnState() ?? []), appearance: settingsRef.current.appearance }
      updateSettings({ ...settingsRef.current, ...layout, views: { ...settingsRef.current.views, [name.trim().toLocaleLowerCase('ru')]: layout } })
      return true
    },
    applySavedView: (saved: Parameters<typeof reportView.applySavedView>[0]) => {
      reportView.applySavedView(saved)
      const layout = settingsRef.current.views[saved.name.toLocaleLowerCase('ru')]
      if (layout) { updateSettings({ ...settingsRef.current, ...layout }); applyLayout(layout.columns) }
    },
    deleteSavedView: (id: string) => {
      const name = reportView.savedViews.find(view => view.id === id)?.name.toLocaleLowerCase('ru')
      const views = { ...settingsRef.current.views }
      if (name) delete views[name]
      updateSettings({ ...settingsRef.current, views })
      reportView.deleteSavedView(id)
    },
  }
  const runtime = useRef({ props, getActionRow, canEditCell, canEditField })
  runtime.current = { props, getActionRow, canEditCell, canEditField }
  const extraSignature = JSON.stringify((props.extraColumns ?? []).map(({ renderCell: _render, ...definition }) => definition))
  const rowActionsLabel = props.rowActions?.headerLabel
  const hasRowActions = Boolean(props.rowActions)
  const columns = useMemo<Array<ColDef<WeldRow> | ColGroupDef<WeldRow>>>(() => {
    const groups: Array<ColDef<WeldRow> | ColGroupDef<WeldRow>> = [{
      colId: GROUP_LABEL_COLUMN, headerName: 'Группа', initialWidth: 250, hide: true,
      pinned: 'left', lockPosition: 'left', lockVisible: true, suppressColumnsToolPanel: true,
      sortable: false, filter: false, suppressHeaderMenuButton: true,
      cellRendererSelector: ({ node }) => node.group ? { component: JournalGroupCell } : undefined,
    }]
    const extras = props.extraColumns ?? []
    const addExtras = (items: typeof extras) => items.forEach(extra => groups.push({
      groupId: `extra-${extra.key}`, headerName: extra.section,
      children: [{ colId: extra.key, headerName: extra.label, initialWidth: extra.width, sortable: false, filter: false,
        cellRenderer: JournalExtraCell }],
    }))
    for (const section of sections) {
      addExtras(extras.filter(extra => extra.insertBeforeSection === section.section))
      groups.push({ groupId: section.section, headerName: section.section, children: section.fields.map(field => ({
        colId: field.key, headerName: field.label, headerTooltip: field.label, initialWidth: journalColumnWidth(field.key),
        initialPinned: field.key === 'line' || field.key === 'joint' ? 'left' : field.key === 'finalStatus' ? 'right' : undefined,
        sortable: !isVirtualWeldField(field), comparator: SERVER_ORDER,
        enableRowGroup: !isVirtualWeldField(field),
        filter: JOURNAL_SERVER_FILTER,
        valueGetter: ({ data }) => data ? (runtime.current.props.getDisplayValue ? runtime.current.props.getDisplayValue(data, field.key) : data[field.key]) : '',
        valueFormatter: ({ data, value }) => data ? journalClipboardValue(data, field.key, value) : String(value ?? ''),
        cellRendererSelector: ({ node }) => ({ component: node.group ? JournalGroupCell : PLAIN_FIELDS.has(field.key) ? JournalPlainCell : JournalCell }),
        cellClass: REPORT_LEFT_ALIGNED_FIELDS.has(field.key) ? 'journal-cell-text-left' : undefined,
        tooltipValueGetter: ({ data, value }) => {
          const { props, getActionRow, canEditCell, canEditField } = runtime.current
          return data ? getWeldTableBodyCellTooltip({
          row: getActionRow(data), fieldKey: field.key, displayValue: value,
          isEditableCell: canEditCell(data, field.key), isBlockedEditableCell: canEditField(field.key) && !canEditCell(data, field.key),
          canOpenDocument: Boolean(props.onOpenDocument), canOpenLnkRequest: Boolean(props.onOpenLnkRequest),
          canOpenLnkResult: Boolean(props.onOpenLnkResult), canOpenJoint: Boolean(props.onOpenJoint), canOpenJointOverview: Boolean(props.onOpenJointOverview),
          canOpenWeldEditor: Boolean(props.controlBasisEditorEnabled && props.onEdit),
        }) ?? String(value ?? '') : ''
        },
        cellClassRules: { 'journal-cell-highlight': ({ data }) => Boolean(data && runtime.current.props.highlightedCellKeys?.has(getCellKey(data.id, field.key))) },
      })) })
      addExtras(extras.filter(extra => extra.insertAfterSection === section.section))
    }
    addExtras(extras.filter(extra => !sections.some(section => section.section === (extra.insertBeforeSection ?? extra.insertAfterSection))))
    if (props.rowActions) groups.push({ colId: '__actions', headerName: props.rowActions.headerLabel ?? 'Действия', initialWidth: 108, minWidth: 108,
      sortable: false, filter: false, resizable: false, suppressHeaderMenuButton: true, cellRenderer: JournalReportActions })
    else if (!props.readOnly) groups.push({ colId: '__actions', headerName: 'Действия', initialWidth: 108, minWidth: 108,
      sortable: false, filter: false, resizable: false, suppressHeaderMenuButton: true, cellRenderer: JournalActions })
    return groups
  // Runtime callbacks live in refs/context: rebuilding columns on a page response
  // closes AG Grid's open filter and loses its focus/scroll.
  }, [sections, extraSignature, props.readOnly, hasRowActions, rowActionsLabel])
  useEffect(() => {
    if (!api || api.isDestroyed()) return
    const state = sections.flatMap(section => section.fields.map(field => ({
      colId: field.key, hide: reportView.hiddenFieldKeys.has(field.key) || (reportView.collapsedSections.has(section.section) && !alwaysVisible.has(field.key)),
    })))
    for (const extra of props.extraColumns ?? []) state.push({ colId: extra.key as WeldFieldKey, hide: Boolean(extra.collapsible && reportView.collapsedSections.has(extra.section)) })
    api.applyColumnState({ state })
  }, [api, sections, reportView.hiddenFieldKeys, reportView.collapsedSections, extraSignature, alwaysVisible])
  const defaultColDef = useMemo<ColDef<WeldRow>>(() => ({
    resizable: true, minWidth: 80, maxWidth: 1200, editable: false, cellDataType: false,
    suppressMovable: false, lockPinned: true, wrapHeaderText: true, suppressHeaderMenuButton: true,
    headerComponentParams: { innerHeaderComponent: JournalColumnHeading },
    suppressKeyboardEvent: ({ event }) => event.key === 'Escape',
  }), [])
  useEffect(() => {
    if (!api || api.isDestroyed()) return
    const available = new Set(sections.flatMap(section => section.fields.map(field => field.key)))
    api.setFilterModel(Object.fromEntries(Object.entries(columnFilters).filter(([key]) => available.has(key as WeldFieldKey)).map(([key, value]) => [key, { value }])))
  }, [api, columnFilters, sections])
  useEffect(() => {
    if (!api || api.isDestroyed()) return
    api.applyColumnState({ state: sort ? [{ colId: sort.fieldKey, sort: sort.direction }] : [], defaultState: { sort: null } })
  }, [api, sort])
  const restoreSelection = useCallback(() => {
    if (!api || api.isDestroyed()) return
    restoringSelection.current = true
    try { restoreJournalGridSelection(api, selectedRowIds) }
    finally { restoringSelection.current = false }
  }, [api, selectedRowIds])
  useEffect(restoreSelection, [restoreSelection, rows, rowsReady])

  const appearance = settings.appearance
  const groupRowHeight = useCallback(({ node }: RowHeightParams<WeldRow>) => node.group
    ? (appearance.density === 'compact' ? 32 : appearance.density === 'spacious' ? 44 : 38)
    : undefined, [appearance.density])
  useEffect(() => { if (api && !api.isDestroyed()) api.resetRowHeights() }, [api, groupRowHeight, appearance.wrapText])
  const rowSelection = useMemo<RowSelectionOptions<WeldRow> | undefined>(() => props.selectable ? {
    mode: 'multiRow', enableClickSelection: false, selectAll: 'filtered',
    groupSelects: 'filteredDescendants', checkboxLocation: 'selectionColumn',
    // AG derives group selectability from eligible leaves, including mixed groups.
    isRowSelectable: node => rowsReady && Boolean(node.data) && (props.isRowSelectable?.(getActionRow(node.data!)) ?? true),
  } : undefined, [props.selectable, rowsReady, props.isRowSelectable, getActionRow])
  const rowClassRules = useMemo(() => ({
    'journal-row-task': ({ data }: { data: WeldRow | undefined }) => Boolean(data && (props.dispatcherTaskRowIds?.has(data.id) || duplicates.has(getDuplicateKey(data) ?? ''))),
    'journal-row-highlight': ({ data }: { data: WeldRow | undefined }) => Boolean(data && props.highlightedRowIds?.has(data.id)),
  }), [props.dispatcherTaskRowIds, props.highlightedRowIds, duplicates])
  const resetLayout = () => {
    reportView.showAllFields()
    for (const section of reportView.collapsedSections) reportView.toggleSection(section)
    applyLayout(initialLayout.current)
    captureLayout()
  }
  const getColumnMenuItems = ({ column, columnGroup }: GetColumnMenuItemsParams<WeldRow>): Array<DefaultMenuItem | MenuItemDef<WeldRow>> => {
    const items: Array<DefaultMenuItem | MenuItemDef<WeldRow>> = []
    if (column?.isSortable()) items.push('sortAscending', 'sortDescending', 'sortUnSort', 'separator')
    // Explicit menu items remain available with lockPinned; that flag prevents
    // edge/group dragging from silently changing which columns are pinned.
    if (column) items.push('pinSubMenu', 'separator', 'autoSizeThis')
    items.push('autoSizeAll')
    const fieldKey = column?.getColId() as WeldFieldKey | undefined
    const extra = props.extraColumns?.find(extra => extra.key === fieldKey && extra.collapsible)
    const groupId = columnGroup?.getGroupId()
    const sectionName = sections.find(section => section.section === groupId)?.section
      ?? props.extraColumns?.find(extra => `extra-${extra.key}` === groupId && extra.collapsible)?.section
    if (fieldKey && (FIELD_BY_KEY.has(fieldKey) || extra)) items.push('separator', {
      name: 'Скрыть столбец', icon: '<span class="ag-icon ag-icon-eye-slash" aria-hidden="true"></span>',
      action: () => extra ? reportView.toggleSection(extra.section) : reportView.toggleField(fieldKey),
    })
    if (sectionName) items.push('separator', {
      name: 'Скрыть раздел', icon: '<span class="ag-icon ag-icon-eye-slash" aria-hidden="true"></span>',
      action: () => reportView.toggleSection(sectionName),
    })
    if (column?.getColDef().enableRowGroup) items.push('separator', column.isRowGroupActive() ? 'rowUnGroup' : 'rowGroup')
    else if (column?.getColDef().showRowGroup) items.push('separator', 'rowUnGroup')
    items.push('separator', { name: 'Выбрать столбцы', icon: '<span class="ag-icon ag-icon-columns" aria-hidden="true"></span>', action: () => setOpenColumnsRequest(value => value + 1) },
      { name: 'Сбросить столбцы', action: resetLayout, icon: '<span class="ag-icon ag-icon-cancel" aria-hidden="true"></span>' })
    return items
  }
  const findTabCell = (previous: CellPosition | null, backwards: boolean): CellPosition | false => {
    if (!api || !rowsReady) return false
    const visible = api.getAllDisplayedColumns()
    const count = api.getDisplayedRowCount()
    const direction = backwards ? -1 : 1
    const start = previous ? previous.rowIndex * visible.length + visible.indexOf(previous.column) : backwards ? count * visible.length : -1
    for (let index = start + direction; index >= 0 && index < count * visible.length; index += direction) {
      const rowIndex = Math.floor(index / visible.length), column = visible[index % visible.length]
      const node = api.getDisplayedRowAtIndex(rowIndex)
      if (!node?.data) continue
      const id = column.getColId()
      const row = getActionRow(node.data)
      const selectable = id.startsWith('ag-Grid-SelectionColumn') && props.selectable && (props.isRowSelectable?.(row) ?? true)
      const action = id === '__actions' || props.extraColumns?.some(extra => extra.key === id)
      if (selectable || action || (FIELD_BY_KEY.has(id as WeldFieldKey) && canEditCell(row, id as WeldFieldKey))) return { rowIndex, column, rowPinned: null }
    }
    return false
  }
  const pagination = props.manualPagination
  const loadMore = () => { if (rowsReady && pagination?.hasMore && !pagination.rowsLoading) pagination.onLoadMore() }
  // Range statistics update while dragging; don't re-render every visible cell for each total.
  const context = useJournalCellContext(props, getActionRow, canEditCell, openMenu)
  const filterContext = useMemo(() => ({ report, columnFilters, onColumnFiltersChange: props.onColumnFiltersChange }), [report, columnFilters, props.onColumnFiltersChange])
  const extrasContext = useMemo(() => ({ table: { rowsReady, extraColumns: props.extraColumns, rowActions: props.rowActions }, getActionRow }), [rowsReady, props.extraColumns, props.rowActions, getActionRow])
  return <JournalGridContext.Provider value={context}><JournalFilterContext.Provider value={filterContext}><JournalExtrasContext.Provider value={extrasContext}><JournalGroupAnchor.Provider value={groupAnchor}>
    <section data-weld-report-grid={report} data-welding-journal-grid={report === 'weldingJournal' ? '' : undefined} data-psto-grid={report === 'heatTreatment' ? '' : undefined} className="min-w-0 w-full" onContextMenuCapture={event => event.preventDefault()}>
      {props.reportTaskPanels}
      <JournalGridToolbar settingsLabel={profile.settingsLabel} summary={props.renderSummary?.(<JournalGroupingControls groups={groupings} onChange={ids => api?.setRowGroupColumns(ids)} />)} sections={sections} extraSections={extraSections} alwaysVisible={alwaysVisible} view={view}
        openColumnsRequest={openColumnsRequest} appearance={appearance}
        onAppearanceChange={appearance => updateSettings({ ...settingsRef.current, appearance })}
        onResetLayout={resetLayout}
        hasFilters={Object.values(columnFilters).some(Boolean)} onClearFilters={() => props.onColumnFiltersChange({})} />
      <div ref={frame} className={`journal-grid-frame grid-result-motion journal-theme-${appearance.theme} journal-density-${appearance.density} ${appearance.taskFill ? 'journal-task-fill' : ''} ${appearance.wrapText ? 'journal-wrap-text' : 'journal-no-wrap'} ${appearance.verticalLines ? 'journal-vertical-lines' : ''} ${appearance.stripes ? 'journal-stripes' : ''}`} aria-label={profile.title} aria-busy={!rowsReady} onContextMenu={event => {
          event.preventDefault()
          const groupRow = event.target instanceof Element ? event.target.closest<HTMLElement>('.ag-row-group') : null
          if (groupRow) {
            const node = api?.getDisplayedRowAtIndex(Number(groupRow.getAttribute('row-index')))
            if (node?.group) openGroupMenu(node, groupRow, { x: event.clientX, y: event.clientY })
            return
          }
          const cell = event.target instanceof Element ? event.target.closest('.ag-cell') : null
          const rowId = cell?.closest('[row-id]')?.getAttribute('row-id')
          const node = rowId ? api?.getRowNode(rowId) : null
          if (!node?.data || node.rowIndex == null || !cell) return
          const id = cell.getAttribute('col-id') ?? ''
          api?.setFocusedCell(node.rowIndex, id)
          openMenu(node.data, { x: event.clientX, y: event.clientY, anchorElement: cell }, FIELD_BY_KEY.has(id as WeldFieldKey) ? id as WeldFieldKey : undefined)
        }}
        onKeyDownCapture={event => {
          // AG closes its popup at document level without consuming Escape. Handle
          // it before that, otherwise the report clears filters in the same event.
          if (event.target instanceof Element && !event.target.closest('.ag-menu')) {
            const groupRow = event.target.closest<HTMLElement>('.ag-row-group')
            if (groupRow && ['Enter', 'F2'].includes(event.key)) {
              const groupNode = api?.getDisplayedRowAtIndex(Number(groupRow.getAttribute('row-index')))
              if (groupNode?.group) {
                event.preventDefault(); event.stopPropagation()
                const checkbox = event.target.closest('.ag-cell')?.querySelector<HTMLInputElement>('input[type=checkbox]')
                if (checkbox) { if (rowsReady && !checkbox.disabled) checkbox.click() }
                else {
                  const column = api?.getColumn(groupAnchor)
                  if (column && groupNode.rowIndex != null) api?.setFocusedCell(groupNode.rowIndex, column)
                  groupNode.setExpanded(!groupNode.expanded, event.nativeEvent, true)
                }
                return
              }
            }
            const headerCheckbox = event.target.closest('.ag-header-cell')?.querySelector<HTMLInputElement>('input[type=checkbox]:not(:disabled)')
            if (headerCheckbox && ['Enter', 'F2'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); if (rowsReady) headerCheckbox.click(); return }
            const cell = event.target.closest<HTMLElement>('.ag-cell')
            const rowElement = cell?.closest<HTMLElement>('[row-index]')
            const node = rowElement ? api?.getDisplayedRowAtIndex(Number(rowElement.getAttribute('row-index'))) : null
            const colId = cell?.getAttribute('col-id')
            if (cell && colId && event.key === 'Tab' && (colId === '__actions' || cell.querySelector('[data-joint-next-action-cell]'))) {
              const buttons = [...cell.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
              const current = buttons.indexOf(event.target as HTMLButtonElement)
              const next = current + (event.shiftKey ? -1 : 1)
              if (buttons.length && next >= 0 && next < buttons.length) { event.preventDefault(); event.stopPropagation(); buttons[next].focus({ preventScroll: true }); return }
            }
            if (cell && colId && node && ['Enter', 'F2'].includes(event.key)) {
              event.preventDefault(); event.stopPropagation()
              if (!rowsReady) return
              if (node.rowIndex != null) api?.setFocusedCell(node.rowIndex, colId)
              focus.remember()
              const control = (event.target.closest('button, input[type=checkbox]') ?? cell.querySelector('[data-joint-next-action-cell] button:last-of-type:not(:disabled)') ?? cell.querySelector('button:not(:disabled), input[type=checkbox]:not(:disabled)')) as HTMLElement | null
              if (control && !control.matches(':disabled')) control.click()
              else if (node.data && FIELD_BY_KEY.has(colId as WeldFieldKey) && canEditCell(getActionRow(node.data), colId as WeldFieldKey)) props.onEdit?.(getActionRow(node.data), colId as WeldFieldKey)
              else if (node.group) node.setExpanded(!node.expanded)
              return
            }
            // Nested buttons must not retain native arrow-key scrolling behavior.
            if (cell && colId && node?.rowIndex != null && event.key.startsWith('Arrow')) {
              api?.setFocusedCell(node.rowIndex, colId)
            }
          }
          if (event.key !== 'Escape' || !(event.target instanceof Element) || !event.target.closest('.ag-menu')) return
          event.preventDefault(); event.stopPropagation()
          api?.hidePopupMenu()
          api?.hideColumnFilter()
          if (popupColumn.current) api?.setFocusedHeader(popupColumn.current)
        }}>
        <AgGridReact<WeldRow>
          postProcessPopup={positionGridPopup}
          theme={THEMES[appearance.theme]} rowData={rows} columnDefs={columns} defaultColDef={defaultColDef}
          getRowId={({ data }) => String(data.id)}
          onGridReady={event => { initialLayout.current = journalColumnLayout(event.api.getColumnState()); setApi(event.api) }}
          rowHeight={appearance.density === 'compact' ? (appearance.wrapText ? 42 : 34) : appearance.density === 'spacious' ? (appearance.wrapText ? 68 : 58) : (appearance.wrapText ? 54 : 46)}
          getRowHeight={groupRowHeight}
          headerHeight={60} groupHeaderHeight={30} rowBuffer={8}
          animateRows suppressScrollOnNewData enableFilterHandlers suppressMultiSort preventDefaultOnContextMenu suppressDragLeaveHidesColumns maintainColumnOrder
          suppressCutToClipboard suppressClipboardPaste cellSelection={CELL_SELECTION}
          copyHeadersToClipboard enableBrowserTooltips
          rowSelection={rowSelection} selectionColumnDef={SELECTION_COLUMN}
          onRowDataUpdated={() => { restoreSelection(); updateRangeSummary() }}
          onCellSelectionChanged={updateRangeSummary}
          onModelUpdated={() => {
            // A delayed scroll-end from the previous layout must not load data after regrouping.
            loadMoreAfterScroll.current = false
            updateRangeSummary()
          }}
          onCellFocused={focus.remember}
          tabToNextCell={({ backwards, previousCellPosition }) => findTabCell(previousCellPosition, backwards)}
          tabToNextHeader={({ backwards }) => { const next = findTabCell(null, backwards); if (!next) return false; api?.setFocusedCell(next.rowIndex, next.column); return true }}
          tabToNextGridContainer={({ nextContainer, backwards }) => nextContainer === 'gridBody' ? findTabCell(null, backwards) : undefined}
          groupDefaultExpanded={0} groupDisplayType="custom" getGroupRowAgg={getGroupRowAgg} suppressGroupChangesColumnVisibility
          onDisplayedColumnsChanged={event => updateGroupAnchor(event.api)}
          onColumnRowGroupChanged={event => {
            setGroupings(event.api.getRowGroupColumns().map(column => ({ id: column.getColId(), label: column.getColDef().headerName ?? column.getColId() })))
            updateGroupAnchor(event.api)
            captureLayout(); updateRangeSummary()
          }}
          onSelectionChanged={event => {
            if (!rowsReady || restoringSelection.current || event.source === 'rowDataChanged' || event.source.startsWith('api')) return
            props.onSelectedRowIdsChange?.(mergeJournalSelection(selectedRowIds, rows.map(row => row.id), (event.selectedNodes ?? []).flatMap(node => node.data?.id ?? [])))
          }}
          onSortChanged={event => {
            if (!['uiColumnSorted', 'columnMenu'].includes(event.source)) return
            const sorted = event.api.getColumnState().find(column => column.sort)
            const next = sorted ? { fieldKey: sorted.colId as WeldFieldKey, direction: sorted.sort! } : null
            if (next?.fieldKey !== sort?.fieldKey || next?.direction !== sort?.direction) props.onSortChange?.(next)
          }}
          onColumnMenuVisibleChanged={event => { if (event.visible) popupColumn.current = event.column?.getColId() ?? null }}
          getColumnMenuItems={getColumnMenuItems}
          onColumnResized={event => { if (event.finished) captureLayout() }}
          onColumnMoved={event => { if (event.finished) captureLayout() }} onColumnPinned={captureLayout}
          onBodyScroll={event => {
            if (event.direction !== 'vertical') return
            loadMoreAfterScroll.current = event.top > lastVerticalScrollTop.current
            lastVerticalScrollTop.current = event.top
          }}
          onBodyScrollEnd={event => {
            if (event.direction !== 'vertical') return
            const movedDown = loadMoreAfterScroll.current
            loadMoreAfterScroll.current = false
            if (movedDown && event.api.getLastDisplayedRowIndex() >= event.api.getDisplayedRowCount() - 8) loadMore()
          }}
          onCellDoubleClicked={event => {
            const field = event.column.getColId() as WeldFieldKey
            if (rowsReady && event.data && FIELD_BY_KEY.has(field) && canEditCell(event.data, field) && !(event.event?.target as HTMLElement)?.closest('button')) props.onEdit?.(getActionRow(event.data), field)
          }}
          rowClassRules={rowClassRules} getRowClass={groupRowClass}
          loading={!rowsReady && rows.length === 0}
          overlayNoRowsTemplate='<span class="text-slate-500">Нет стыков по выбранным условиям</span>'
          localeText={LOCALE}
        />
      </div>
      <div data-journal-footer className="journal-footer rounded-b-xl border border-t-0 border-slate-200 bg-slate-50 px-3 text-xs text-slate-500">
        <span className="journal-loaded-count">{!rowsReady ? 'Обновление строк…' : `Загружено: ${rows.length}${pagination?.totalCount === undefined ? '' : ` из ${pagination.totalCount}`}`}</span>
        <div className="journal-footer-right">
        <div className="journal-range-summary" aria-label="Статистика выделения" title="Выбрано — стыков галочками; количество — непустых ячеек диапазона. Среднее и сумма — только числовые поля загруженных строк.">
          {selectedRowIds.size > 0 ? <div className="flex items-center gap-2" aria-label={report === 'heatTreatment' ? 'Действия с выбранными стыками' : undefined}>
            <span>Выбрано: {selectedRowIds.size}</span>
            {report === 'heatTreatment' && props.getContextMenuItems ? <>
              <button type="button" data-journal-selection-actions className="journal-input text-sky-700 disabled:opacity-50" disabled={!rowMenu.selectionAvailable}
                onClick={event => {
                  const anchorElement = event.currentTarget
                  const rect = anchorElement.getBoundingClientRect()
                  rowMenu.openSelection({ x: rect.left, y: rect.bottom + 4, anchorElement, closeOnScroll: false })
                }}>Действия</button>
              <button type="button" className="journal-input" onClick={() => props.onSelectedRowIdsChange?.(new Set())}>Снять выбор</button>
            </> : null}
          </div> : null}
          {rangeSummary.average !== null ? <span>Среднее: {formatJournalNumber(rangeSummary.average)}</span> : null}
          {rangeSummary.count > 0 ? <span>Количество: {rangeSummary.count}</span> : null}
          {rangeSummary.numericCount > 0 ? <span>Сумма: {formatJournalNumber(rangeSummary.sum)}</span> : null}
        </div>
        {pagination ? <div className="flex items-center gap-3">
          {pagination.hasMore ? <button type="button" className="text-sky-700 disabled:opacity-50" disabled={!rowsReady || pagination.rowsLoading} onClick={loadMore}>{pagination.rowsLoading ? 'Загрузка…' : 'Загрузить ещё'}</button> : null}
          <label>Порция <select aria-label="Размер порции строк" className="journal-input journal-page-size ml-2" value={pagination.pageSize} onChange={event => pagination.onPageSizeChange(Number(event.target.value))}>{DEFAULT_PAGE_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
        </div> : null}
        </div>
      </div>
      <ContextActionMenu menu={rowMenu.menu} panelClassName="journal-context-menu" onClose={() => {
        const anchor = rowMenu.menu?.anchorElement
        rowMenu.close()
        requestAnimationFrame(() => {
          if (anchor instanceof HTMLButtonElement && anchor.hasAttribute('data-journal-selection-actions')) {
            if (anchor.isConnected && document.activeElement === document.body && !isModalDialogOpen()) anchor.focus({ preventScroll: true })
          } else focus.restore()
        })
      }} autoFocus />
    </section>
  </JournalGroupAnchor.Provider></JournalExtrasContext.Provider></JournalFilterContext.Provider></JournalGridContext.Provider>
}
