import {
  ClientSideRowModelModule, ClientSideRowModelApiModule, ColumnApiModule, RowApiModule,
  CellApiModule, ScrollApiModule, RenderApiModule, EventApiModule, ColumnAutoSizeModule,
  CustomFilterModule, RowSelectionModule, CellStyleModule, RowStyleModule, TooltipModule,
  LocaleModule, themeQuartz, themeAlpine, themeBalham,
  type ICellRendererParams, type RowClassParams, type SelectionColumnDef,
} from 'ag-grid-community'
import { CellSelectionModule, ClipboardModule, ColumnMenuModule, RowGroupingModule } from 'ag-grid-enterprise'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getWeldColumnWidth } from '@/lib/weld-column-widths'

// Explicit feature boundary: server paging/filtering and the native weld editor
// stay outside AG Grid. Module dependencies are included by AG Grid itself.
export const MODULES = [
  ClientSideRowModelModule, ClientSideRowModelApiModule, ColumnApiModule, RowApiModule,
  CellApiModule, ScrollApiModule, RenderApiModule, EventApiModule, ColumnAutoSizeModule,
  CustomFilterModule, RowSelectionModule, CellStyleModule, RowStyleModule, TooltipModule,
  LocaleModule, CellSelectionModule, ClipboardModule, ColumnMenuModule, RowGroupingModule,
]
export const GROUP_ROW_PARAMS = { suppressCount: false, innerRenderer: ({ node }: ICellRendererParams<WeldRow>) => String(node.key || '(Пусто)') }
export const groupRowClass = ({ node }: RowClassParams<WeldRow>) => node.group ? `journal-group-tone-${node.level % 4}` : undefined
export const SELECTION_COLUMN: SelectionColumnDef = { pinned: 'left', lockPinned: true, width: 46, minWidth: 46, maxWidth: 46, resizable: false, suppressMovable: true, headerTooltip: 'Выбрать загруженные строки' }
export const LOCALE = {
  groupBy: 'Сгруппировать загруженные по «${variable}»', ungroupBy: 'Убрать группировку по «${variable}»', ungroupAll: 'Убрать группировку',
  ariaRowGroup: 'Группа загруженных стыков', ariaRowGroupExpanded: 'Развёрнуто', ariaRowGroupCollapsed: 'Свёрнуто',
  selectAll: 'Выбрать все', selectAllSearchResults: 'Выбрать найденные', searchOoo: 'Поиск…', blanks: '(Пусто)',
  noRowsToShow: 'Нет стыков', loadingOoo: 'Загрузка…', pinColumn: 'Закрепить столбец', pinLeft: 'Слева', pinRight: 'Справа', noPin: 'Не закреплять',
  autosizeThisColumn: 'Ширина по содержимому', autosizeAllColumns: 'Подобрать ширину всех',
  sortAscending: 'По возрастанию', sortDescending: 'По убыванию', sortUnSort: 'Сбросить сортировку', resetColumns: 'Сбросить столбцы',
  columnFilter: 'Фильтр столбца', columnChooser: 'Выбрать столбцы', chooseColumns: 'Выбрать столбцы', copy: 'Копировать', copyWithHeaders: 'Копировать с заголовками',
  ariaLabelColumnMenu: 'Меню столбца', ariaLabelColumnFilter: 'Фильтр столбца', ariaLabelContextMenu: 'Действия со стыком',
  ariaRowToggleSelection: 'Пробел — выбрать или снять выбор стыка', ariaRowSelectionDisabled: 'Выбор стыка пока недоступен',
  ariaFilterMenuOpen: 'Открыть фильтр', ariaColumn: 'Столбец', ariaColumnGroup: 'Раздел',
  ariaRowSelectAll: 'Пробел — выбрать загруженные стыки', ariaRowSelect: 'Выбрать стык', ariaRowDeselect: 'Снять выбор стыка', ariaHeaderSelection: 'Выбрать загруженные стыки',
  ariaSortableColumn: 'Enter — изменить сортировку', ariaColumnMenu: 'ПКМ — меню столбца', ariaFilterColumn: 'Ctrl + Enter — открыть фильтр',
  ariaChecked: 'выбран', ariaUnchecked: 'не выбран', ariaIndeterminate: 'частично выбран',
}
// Leave room for AG Grid's filter/menu controls in addition to the field label.
export const journalColumnWidth = (field: string) => Math.max(112, getWeldColumnWidth(field) + 32)
const BASE_THEME = themeQuartz.withParams({
  accentColor: '#0284c7', backgroundColor: '#ffffff', foregroundColor: '#334155',
  borderColor: '#e2e8f0', headerBackgroundColor: '#f7f9fc', headerTextColor: '#475569',
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 13,
  headerFontSize: 12, headerFontWeight: 600, wrapperBorderRadius: 0,
  headerColumnResizeHandleColor: '#cbd5e1', headerColumnResizeHandleHeight: '40%',
  selectedRowBackgroundColor: '#e0f2fe', rangeSelectionBorderColor: '#0284c7',
  rowBorder: { width: 1, color: '#edf1f5' }, cellHorizontalPadding: 10,
})

export const THEMES = {
  quartz: BASE_THEME,
  alpine: themeAlpine.withParams({ accentColor: '#16816a', backgroundColor: '#fff', foregroundColor: '#334155', headerBackgroundColor: '#eef4f1', headerTextColor: '#35534c', borderColor: '#d6e2dc', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 13, headerFontSize: 12, wrapperBorderRadius: 0, cellHorizontalPadding: 10, rowBorder: { width: 1, color: '#e8eeeb' } }),
  balham: themeBalham.withParams({ accentColor: '#52657b', backgroundColor: '#fff', foregroundColor: '#334155', headerBackgroundColor: '#e9edf2', headerTextColor: '#364152', borderColor: '#d4dbe4', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 13, headerFontSize: 12, wrapperBorderRadius: 0, cellHorizontalPadding: 10, rowBorder: { width: 1, color: '#e5e9ef' } }),
}
// Plain fields keep F2, double-click editing and context actions on the grid.
// Links, badges and joint cards retain the shared business renderer. The explicit
// allowlist ensures new workflows do not accidentally lose an interactive cell.
export const PLAIN_FIELDS = new Set<string>([
  'projectTitle', 'subtitleCode', 'line', 'groupName', 'category', 'weldControlPercent',
  'isometry', 'sheet', 'revisionNumber', 'spool', 'spoolId', 'officiality', 'revisionActuality',
  'element1', 'element2', 'material1', 'material2', 'materialId1', 'materialId2',
  'weldingMethod', 'connectionType', 'materialGroup', 'd1', 'd2', 't1', 't2', 'wdi', 'weldDate', 'responsible',
  'orderCode1', 'orderCode2', 'materialUniqueNumber1', 'materialUniqueNumber2',
  'materialFullName1', 'materialFullName2', 'materialNormativeDocument1', 'materialNormativeDocument2',
  'materialCertificateNumber1', 'materialCertificateNumber2', 'elementLength1', 'elementLength2',
])
