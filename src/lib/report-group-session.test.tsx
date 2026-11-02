import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GridApi, GridState } from 'ag-grid-community'
import { ReportGroupSessionProvider, useReportGroupSession } from './report-group-session'

const columns = [{ colId: 'line', rowGroup: true, rowGroupIndex: 0 }]
const api = (expansion: GridState['ssrmRowGroupExpansion'], groups = ['line']) => ({
  getState: () => ({ ssrmRowGroupExpansion: expansion, rowSelection: ['private-id'], filter: { filterModel: { line: 'filter' } } }),
  getRowGroupColumns: () => groups.map(id => ({ getColId: () => id })),
}) as unknown as GridApi
describe('report expansion lifetime', () => {
  it('keeps compact bulk state and exceptions independent for each report, without selections or filters', () => {
    let current!: ReturnType<typeof useReportGroupSession>
    function Probe({ view }: { view: string }) { current = useReportGroupSession(view, columns); return null }
    const visit = (view: string) => <ReportGroupSessionProvider><Probe key={view} view={view} /></ReportGroupSessionProvider>
    const { rerender, unmount } = render(visit('journal'))
    const bulk = { expandAll: true, invertedRowGroupIds: ['group:A'] }
    act(() => current.capture(api(bulk)))
    bulk.invertedRowGroupIds.push('later-mutation')
    rerender(visit('lnk'))
    expect(current.initialState).toBeUndefined()
    act(() => current.capture(api({ expandedRowGroupIds: ['group:B'] })))
    rerender(visit('journal'))
    expect(current.initialState).toEqual({ partialColumnState: true, rowGroup: { groupColIds: ['line'] }, ssrmRowGroupExpansion: { expandAll: true, invertedRowGroupIds: ['group:A'] } })
    act(() => current.capture(api({ expandAll: false, invertedRowGroupIds: [] })))
    rerender(visit('lnk'))
    expect(current.initialState?.ssrmRowGroupExpansion).toEqual({ expandedRowGroupIds: ['group:B'] })
    rerender(visit('journal'))
    expect(current.initialState?.ssrmRowGroupExpansion).toEqual({ expandAll: false, invertedRowGroupIds: [] })
    unmount()
    render(visit('journal')) // reload/logout/permission revision ends the provider lifetime
    expect(current.initialState).toBeUndefined()
  })
  it('does not restore a different grouping or replace normal state with targeted document navigation', () => {
    let current!: ReturnType<typeof useReportGroupSession>
    function Probe({ group, enabled }: { group: string; enabled: boolean }) { current = useReportGroupSession('documents', [{ colId: group, rowGroup: true }], enabled); return null }
    const visit = (key: string, group: string, enabled = true) => <ReportGroupSessionProvider><Probe key={key} group={group} enabled={enabled} /></ReportGroupSessionProvider>
    const { rerender } = render(visit('a', 'line'))
    act(() => current.capture(api({ expandAll: true, invertedRowGroupIds: [] })))
    rerender(visit('b', 'project'))
    expect(current.initialState).toBeUndefined()
    rerender(visit('target', 'line', false))
    expect(current.initialState).toBeUndefined()
    act(() => current.capture(api({ expandAll: false, invertedRowGroupIds: [] })))
    rerender(visit('c', 'line'))
    expect(current.initialState?.ssrmRowGroupExpansion).toEqual({ expandAll: true, invertedRowGroupIds: [] })
  })
})
