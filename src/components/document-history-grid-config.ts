import {
  ColumnApiModule, RowApiModule, CellApiModule, ScrollApiModule, RenderApiModule, EventApiModule,
  ColumnAutoSizeModule, CustomFilterModule, RowSelectionModule, CellStyleModule, RowStyleModule,
  TooltipModule, LocaleModule, GridStateModule,
} from 'ag-grid-community'
import { ServerSideRowModelModule, ServerSideRowModelApiModule, ColumnMenuModule, RowGroupingModule, CellSelectionModule } from 'ag-grid-enterprise'
export { GRID_THEMES as DOCUMENT_GRID_THEMES } from './grid-themes'

// Document grids only register their own features; weld editing and dispatcher modules are not imported.
export const DOCUMENT_GRID_MODULES = [ServerSideRowModelModule, ServerSideRowModelApiModule, ColumnApiModule, RowApiModule,
  CellApiModule, ScrollApiModule, RenderApiModule, EventApiModule, ColumnAutoSizeModule, CustomFilterModule,
  RowSelectionModule, CellStyleModule, RowStyleModule, TooltipModule, LocaleModule, GridStateModule, ColumnMenuModule, RowGroupingModule, CellSelectionModule]
export const DOCUMENT_GRID_LOCALE = {
  groupBy: 'Сгруппировать по «${variable}»', ungroupBy: 'Убрать группировку по «${variable}»', ungroupAll: 'Убрать группировку',
  ariaRowGroup: 'Группа документов', ariaRowGroupExpanded: 'Развёрнуто', ariaRowGroupCollapsed: 'Свёрнуто',
  noRowsToShow: 'Документов не найдено', loadingOoo: 'Загрузка…', pinColumn: 'Закрепить столбец', pinLeft: 'Слева', pinRight: 'Справа', noPin: 'Не закреплять',
  autosizeThisColumn: 'Ширина по содержимому', autosizeAllColumns: 'Подобрать ширину всех',
  sortAscending: 'По возрастанию', sortDescending: 'По убыванию', sortUnSort: 'Сбросить сортировку', resetColumns: 'Сбросить столбцы',
  columnFilter: 'Фильтр столбца', columnChooser: 'Выбрать столбцы', chooseColumns: 'Выбрать столбцы',
  ariaLabelColumnMenu: 'Меню столбца', ariaLabelColumnFilter: 'Фильтр столбца', ariaLabelContextMenu: 'Действия с документом',
  ariaRowToggleSelection: 'Пробел — выбрать или снять выбор документа', ariaRowSelectionDisabled: 'Выбор пока недоступен',
  ariaRowSelect: 'Выбрать документ', ariaRowDeselect: 'Снять выбор документа', ariaHeaderSelection: 'Выбрать все документы',
  ariaSortableColumn: 'Enter — изменить сортировку', ariaColumnMenu: 'Меню столбца', ariaFilterColumn: 'Открыть фильтр',
  ariaChecked: 'выбран', ariaUnchecked: 'не выбран', ariaIndeterminate: 'частично выбран',
}
