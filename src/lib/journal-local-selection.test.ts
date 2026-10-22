import { expect, it } from 'vitest'
import type { GridApi, IRowNode } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import { readJournalLocalSelection } from './journal-local-selection'

it('proves completeness with distinct real leaves, including collapsed nested stores', () => {
  const outer = { group: true, data: { journalGroup: { route: ['A'], recordCount: 3 } } }
  const inner = { group: true, parent: outer, expanded: false, data: { journalGroup: { route: ['A', 'B'], recordCount: 2 } } }
  const first = { data: { id: 1 }, parent: inner }
  const nodes = [first, inner, outer, first, { data: { id: 2 }, parent: inner }, { stub: true, data: { id: 3 }, parent: outer }]
  const api = { forEachNode: (visit: (node: IRowNode<WeldRow>, index: number) => void) => nodes.forEach((node, index) => visit(node as unknown as IRowNode<WeldRow>, index)) } as Pick<GridApi<WeldRow>, 'forEachNode'>
  let result = readJournalLocalSelection(api, 3)
  expect([...result.get('["A","B"]')!]).toEqual([1, 2])
  expect(result.has('["A"]')).toBe(false)
  expect(result.has('[]')).toBe(false)
  nodes.push({ stub: false, data: { id: 3 }, parent: outer })
  result = readJournalLocalSelection(api, 3)
  expect([...result.get('["A"]')!]).toEqual([1, 2, 3])
  expect([...result.get('[]')!]).toEqual([1, 2, 3])
})
