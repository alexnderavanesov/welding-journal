import { useEffect, useRef, type ComponentProps, type ComponentType } from 'react'
import type { ProgramGrid as RealProgramGrid } from '@/components/line-program-grid'
import { isProgramRowClick } from '@/lib/line-program-workspace'

/** Domain component tests exercise real cell actions. Native grid layout/state has browser coverage. */
export function ProgramGrid<T>(props: ComponentProps<typeof RealProgramGrid<T>>) {
  const visited = useRef(new Set<string>())
  const latest = useRef(props); latest.current = props
  useEffect(() => { latest.current.onFilterRows?.(props.rows) }, [props.rows])
  const Detail = props.detailRenderer as ComponentType<any> | undefined
  return <div data-program-grid={props.kind}>
    {props.toolbar}
    <div role="table" aria-label={props.label}>
      <div role="rowgroup" data-testid={props.kind === 'assignments' ? 'assignment-table-header' : undefined}><div role="row">{props.columns.filter(column => !column.hide).map(column => <div role="columnheader" key={column.colId}>{column.headerName}</div>)}</div></div>
      {(props.virtual || props.kind === 'joints' ? props.rows.slice(0, 50) : props.rows).map(data => {
        const id = props.getId(data), expanded = props.isExpanded?.(data)
        if (expanded) visited.current.add(id)
        return <div key={id} {...props.rowAttributes?.(data)} className={typeof props.getRowClass === 'function' ? String(props.getRowClass({ data } as any) ?? '') : undefined} onContextMenu={event => props.onRowMenu?.(event, data)} onClick={event => { if (isProgramRowClick(event.target)) { event.stopPropagation(); props.onRowClick?.(data) } }}>
          <div role="row">{props.columns.filter(column => !column.hide).map(colDef => {
            const Cell = colDef.cellRenderer as ComponentType<any> | undefined
            return <div role="cell" key={colDef.colId}>{Cell ? <Cell data={data} colDef={colDef} /> : null}</div>
          })}</div>
          {Detail && visited.current.has(id) ? <div hidden={!expanded}><Detail data={data} /></div> : null}
        </div>
      })}
    </div>
  </div>
}
