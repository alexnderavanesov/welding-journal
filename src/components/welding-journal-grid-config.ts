import {
  ColumnApiModule, RowApiModule,
  CellApiModule, ScrollApiModule, RenderApiModule, EventApiModule, ColumnAutoSizeModule,
  CustomFilterModule, CellStyleModule, RowStyleModule,
  LocaleModule,
  type RowClassParams,
} from 'ag-grid-community'
import { CellSelectionModule, ColumnMenuModule, RowGroupingModule, ServerSideRowModelModule, ServerSideRowModelApiModule } from 'ag-grid-enterprise'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getWeldColumnWidth } from '@/lib/weld-column-widths'
export { GRID_THEMES as THEMES } from './grid-themes'

// Reports use bounded server stores and explicit selection/clipboard commands.
// Module dependencies are included by AG Grid itself.
export const MODULES = [
  ServerSideRowModelModule, ServerSideRowModelApiModule, ColumnApiModule, RowApiModule,
  CellApiModule, ScrollApiModule, RenderApiModule, EventApiModule, ColumnAutoSizeModule,
  CustomFilterModule, CellStyleModule, RowStyleModule,
  LocaleModule, CellSelectionModule, ColumnMenuModule, RowGroupingModule,
]
export const groupRowClass = ({ node }: RowClassParams<WeldRow>) => node.group ? `journal-group-tone-${node.level % 4}` : undefined
export const LOCALE = {
  groupBy: 'Сгруппировать по «${variable}»', ungroupBy: 'Убрать группировку по «${variable}»', ungroupAll: 'Убрать группировку',
  ariaRowGroup: 'Группа стыков', ariaRowGroupExpanded: 'Развёрнуто', ariaRowGroupCollapsed: 'Свёрнуто',
  selectAll: 'Выбрать все', selectAllSearchResults: 'Выбрать найденные', searchOoo: 'Поиск…', blanks: '(Пусто)',
  noRowsToShow: 'Нет стыков', loadingOoo: 'Загрузка…', loadingError: 'Не удалось загрузить строки', pinColumn: 'Закрепить столбец', pinLeft: 'Слева', pinRight: 'Справа', noPin: 'Не закреплять',
  autosizeThisColumn: 'Ширина по содержимому', autosizeAllColumns: 'Подобрать ширину всех',
  sortAscending: 'По возрастанию', sortDescending: 'По убыванию', sortUnSort: 'Сбросить сортировку', resetColumns: 'Сбросить столбцы',
  columnFilter: 'Фильтр столбца', columnChooser: 'Выбрать столбцы', chooseColumns: 'Выбрать столбцы', copy: 'Копировать', copyWithHeaders: 'Копировать с заголовками',
  ariaLabelColumnMenu: 'Меню столбца', ariaLabelColumnFilter: 'Фильтр столбца', ariaLabelContextMenu: 'Действия со стыком',
  ariaRowToggleSelection: 'Пробел — выбрать или снять выбор стыка', ariaRowSelectionDisabled: 'Выбор стыка пока недоступен',
  ariaFilterMenuOpen: 'Открыть фильтр', ariaColumn: 'Столбец', ariaColumnGroup: 'Раздел',
  ariaRowSelectAll: 'Пробел — выбрать все стыки по текущим фильтрам', ariaRowSelect: 'Выбрать стык', ariaRowDeselect: 'Снять выбор стыка', ariaHeaderSelection: 'Выбрать все стыки по текущим фильтрам',
  ariaSortableColumn: 'Enter — изменить сортировку', ariaColumnMenu: 'ПКМ — меню столбца', ariaFilterColumn: 'Ctrl + Enter — открыть фильтр',
  ariaChecked: 'выбран', ariaUnchecked: 'не выбран', ariaIndeterminate: 'частично выбран',
}
// Leave room for AG Grid's filter/menu controls in addition to the field label.
export const journalColumnWidth = (field: string) => Math.max(112, getWeldColumnWidth(field) + 32)
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
