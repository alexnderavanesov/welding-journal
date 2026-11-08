import { createContext, useContext, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { QuickFilterModule, type ColDef, type GridApi, type ICellRendererParams, type IHeaderParams } from 'ag-grid-community'
import { ReadOnlyGrid } from './read-only-grid'
import { Button } from './ui/button'
import { FieldHelp } from './field-help'
import { accountActivityLabel, accountActivityOrder, accountRoleLabel, accountStatusLabel, type AccountListUser } from '@/lib/account-user-labels'
import { formatAccountActivityTime } from '@/lib/account-activity-label'
import './account-users-grid.css'

type Row = AccountListUser & { roleLabel: string; statusLabel: string; activityLabel: string }
const GridContext = createContext<{ selfId?: string; actions: (user: AccountListUser) => ReactNode }>({ actions: () => null })
const ActivityTime = createContext(0)
const MODULES = [QuickFilterModule]
const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })
const compareText = (a: unknown, b: unknown) => collator.compare(String(a ?? ''), String(b ?? ''))
function FilterValue({ value }: { value: string }) { return <span className="account-user-filter-value" title={value}>{value}</span> }
const DEFAULT_COLUMN: ColDef<Row> = { sortable: true, minWidth: 160, flex: 1, wrapText: true, autoHeight: true,
  // Renderers also show fields outside the sorted value (title, permissions,
  // last activity, revision). Refresh them whenever the row data changes.
  equals: () => false, cellClass: 'account-user-cell', getQuickFilterText: () => '', comparator: compareText,
  // Filter options are labels; the activity column separately compares row dates.
  filterParams: { buttons: ['reset', 'apply'], closeOnApply: true, refreshValuesOnOpen: true,
    comparator: compareText, valueFormatter: ({ value }: { value: unknown }) => String(value ?? ''), cellRenderer: FilterValue } }
const rowId = ({ data }: { data: Row }) => data.id
const searchText = (user: AccountListUser) => `${user.name} ${user.email} ${user.title}`
// Retain the existing substring search across name, email and title.
const parseSearch = (value: string) => [value.trim()]
const matchSearch = (parts: string[], aggregate: string) => aggregate.includes(parts[0] ?? '')

function UserCell({ data }: ICellRendererParams<Row>) {
  const { selfId } = useContext(GridContext)
  if (!data) return null
  return <div><p className="font-medium text-slate-800">{data.name}{selfId === data.id ? <span className="ml-2 text-xs font-normal text-slate-400">Это вы</span> : null}</p>
    <p className="mt-1 text-slate-500">{data.email}</p>{data.title ? <p className="mt-1 text-xs text-slate-400">{data.title}</p> : null}</div>
}
function RoleCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null
  return <div><span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${data.role === 'user' ? 'bg-slate-100 text-slate-600' : 'bg-sky-50 text-sky-700'}`}>{data.roleLabel}</span>
    <p className="mt-2 text-xs text-slate-500">{data.role === 'user' ? `${data.permissions.length} разрешений` : 'Все рабочие права'}</p></div>
}
function StatusCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null
  return <div><span className={`inline-flex items-center gap-1.5 text-xs font-medium ${data.status === 'active' ? 'text-emerald-700' : 'text-amber-700'}`}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${data.status === 'active' ? 'bg-emerald-500' : 'bg-amber-400'}`} />{data.statusLabel}</span>
    {data.linkExpiresAt ? <p className="mt-2 text-xs leading-5 text-slate-400">Ссылка до {new Date(data.linkExpiresAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК</p> : null}</div>
}
function ActivityCell({ data }: ICellRendererParams<Row>) {
  const now = useContext(ActivityTime)
  if (!data) return null
  if (data.activityLabel === 'Онлайн') return <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Онлайн</span>
  const time = data.activityLabel === 'Был(а) на сайте' && data.lastActiveAt ? formatAccountActivityTime(data.lastActiveAt, now) : null
  if (!time) return <span className="text-xs text-slate-400" title={data.activityLabel === 'Нет данных' ? 'Активность появится после следующего открытия сайта.' : undefined}>{data.activityLabel}</span>
  return <div className="text-xs leading-5 text-slate-500"><p>Был(а) на сайте</p><time dateTime={time.iso} title={time.exact} aria-label={`${time.label}; ${time.exact}`}>{time.label}</time></div>
}
function ActionsCell({ data }: ICellRendererParams<Row>) { const { actions } = useContext(GridContext); return data ? actions(data) : null }
function HelpHeader({ displayName }: IHeaderParams<Row>) {
  return <span className="inline-flex items-center gap-1.5">{displayName}<span onKeyDown={event => event.stopPropagation()}>
    {displayName === 'Активность'
      ? <FieldHelp label="Как определяется активность">Онлайн — пользователь работал на сайте в последние 3 минуты и ещё не вышел. Учитываются все устройства. Недавняя активность показана как «3 минуты назад»; точное время по Москве — при наведении. Список обновляется раз в 2 минуты; после закрытия вкладки статус может измениться с задержкой до 5 минут. Кнопка «Обновить список» запрашивает данные сразу.</FieldHelp>
      : <FieldHelp label="Что означает статус аккаунта">Активирован — пользователь задал пароль и может входить в систему с выданными правами. Ожидает активации — приглашение ещё не принято. Присутствие на сайте показано отдельно в столбце «Активность».</FieldHelp>}
  </span></span>
}
const COLUMNS: ColDef<Row>[] = [
  { field: 'name', headerName: 'Пользователь', minWidth: 270, flex: 2, initialSort: 'asc', cellRenderer: UserCell,
    getQuickFilterText: ({ data }) => data ? searchText(data) : '',
    filterValueGetter: ({ data }) => data ? [data.name, data.email, data.title].filter(Boolean).join(' · ') : '' },
  { field: 'roleLabel', headerName: 'Уровень доступа', minWidth: 200, cellRenderer: RoleCell },
  { field: 'statusLabel', headerName: 'Статус аккаунта', minWidth: 225, cellRenderer: StatusCell, headerComponentParams: { innerHeaderComponent: HelpHeader } },
  { field: 'activityLabel', headerName: 'Активность', minWidth: 190, cellRenderer: ActivityCell, headerComponentParams: { innerHeaderComponent: HelpHeader },
    comparator: (_a, _b, left, right, descending) => {
      const a = left.data && left.data.activityLabel !== 'Нет связи' ? accountActivityOrder(left.data) : null
      const b = right.data && right.data.activityLabel !== 'Нет связи' ? accountActivityOrder(right.data) : null
      // Unknown activity stays after dated entries in either direction.
      if (a == null || b == null) return a == null && b == null ? 0 : a == null ? descending ? -1 : 1 : descending ? 1 : -1
      return a - b
    } },
  { colId: 'actions', headerName: 'Действия', minWidth: 245, sortable: false, filter: false, cellRenderer: ActionsCell },
]

export default function AccountUsersGrid({ users, selfId, available, now, search, renderActions }: {
  users: AccountListUser[]; selfId?: string; available: boolean; now: number; search: string
  renderActions: (user: AccountListUser) => ReactNode
}) {
  const [api, setApi] = useState<GridApi<Row> | null>(null)
  const [shown, setShown] = useState(users.length), [filtered, setFiltered] = useState(false)
  const rows = useMemo(() => users.map(user => ({ ...user, roleLabel: accountRoleLabel(user.role),
    statusLabel: accountStatusLabel(user.status), activityLabel: accountActivityLabel(user, available) })), [users, available])
  const context = useMemo(() => ({ selfId, actions: renderActions }), [selfId, renderActions])
  return <GridContext.Provider value={context}><ActivityTime.Provider value={now}>
    <div className="account-users-grid" style={{ '--account-users-grid-height': `${Math.min(600, Math.max(160, shown * 108 + 62))}px` } as CSSProperties}>
      <ReadOnlyGrid<Row> label="Пользователи и права" columnFilters popupClassName="account-users-filter" modules={MODULES} rowData={rows} columnDefs={COLUMNS}
        defaultColDef={DEFAULT_COLUMN} getRowId={rowId} rowHeight={108} headerHeight={44}
        quickFilterText={search} quickFilterParser={parseSearch} quickFilterMatcher={matchSearch}
        onGridReady={event => setApi(event.api)}
        onModelUpdated={event => { setShown(event.api.getDisplayedRowCount()); setFiltered(event.api.isColumnFilterPresent()) }} />
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
        <span>Показано: {shown} из {users.length}</span>
        {filtered ? <Button variant="ghost" size="sm" onClick={() => api?.setFilterModel(null)}>Сбросить фильтры столбцов</Button> : null}
      </div>
    </div>
  </ActivityTime.Provider></GridContext.Provider>
}
