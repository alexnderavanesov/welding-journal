import { createHash } from 'node:crypto'
import { FIELD_BY_KEY } from '@/lib/weld-fields'
import { journalFilterSearchText, type JournalFilterPage, type JournalFilterRequest } from '@/lib/journal-filter-options'
import type { WeldColumnFilterOption } from './weld-contracts'
import { listColumnFilterOptions, normalizeWeldColumnFilterOptionsRequest } from './weld-read'
import { assertJournalContextRevision, journalReadIdentity } from './journal-grid'
import { createJournalSnapshotCache } from './journal-snapshot-cache'
import { journalReport } from '@/lib/journal-server-grid'

type FacetSnapshot = { values: string[]; labels?: string[]; counts: Float64Array; search: string[] }
const facets = createJournalSnapshotCache<FacetSnapshot>({ bytes: 64 * 1024 * 1024, entries: 16,
  // Conservative representation estimate: string pointers/headers, Float64
  // counts and reserve, UTF-16 capacity, optional labels and array headers.
  weigh: snapshot => snapshot.values.reduce((sum, value, index) => sum + 112 + (snapshot.labels ? 8 : 0)
    + 2 * (value.length + snapshot.search[index].length)
    + (snapshot.labels && snapshot.labels[index] !== value ? 40 + 2 * snapshot.labels[index].length : 0), 512) })
const PAGE = 150
function compactFacetOptions(options: WeldColumnFilterOption[], fieldKey: JournalFilterRequest['fieldKey']): FacetSnapshot {
  const length = options.length
  const values = new Array<string>(length), search = new Array<string>(length), counts = new Float64Array(length)
  let labels: string[] | undefined
  for (let index = 0; index < length; index++) {
    const option = options[index]
    values[index] = option.value
    counts[index] = option.count
    if (!labels && option.label !== option.value) labels = values.slice()
    if (labels) labels[index] = option.label
    search[index] = journalFilterSearchText(fieldKey, option)
  }
  return { values, labels, counts, search }
}
function facetOptionAt(snapshot: FacetSnapshot, index: number): WeldColumnFilterOption {
  return { value: snapshot.values[index], label: snapshot.labels?.[index] ?? snapshot.values[index], count: snapshot.counts[index] }
}
async function readSnapshot(input: JournalFilterRequest) {
  if (!input || !FIELD_BY_KEY.has(input.fieldKey) || input.match !== undefined && typeof input.match !== 'string'
    || input.start !== undefined && (!Number.isSafeInteger(input.start) || input.start < 0)) throw new Error('Некорректный запрос значений фильтра.')
  const data = normalizeWeldColumnFilterOptionsRequest({ report: journalReport(input.report), fieldKey: input.fieldKey, search: input.search, columnFilters: input.columnFilters })
  const context = await journalReadIdentity({ report: data.report, columnFilters: { ...data.columnFilters, ...(data.search ? { search: data.search } : {}) },
    groupBy: [], route: [], start: 0, end: 100, revision: input.revision }, data.fieldKey)
  const key = createHash('sha256').update(JSON.stringify([context.revision, context.dispatcher.computedRevision, context.dispatcher.computedAt, data])).digest('hex')
  const snapshot = await facets.load(key, async () => {
    const options = await listColumnFilterOptions(data)
    await assertJournalContextRevision(context)
    return compactFacetOptions(options, data.fieldKey)
  })
  await assertJournalContextRevision(context)
  return { snapshot, revision: context.revision, match: (input.match ?? '').toLocaleLowerCase('ru') }
}
export async function readJournalFilterPage(input: JournalFilterRequest): Promise<JournalFilterPage> {
  const { snapshot, revision, match } = await readSnapshot(input)
  const start = input.start ?? 0, options: WeldColumnFilterOption[] = []
  // Common lists stay available for immediate local search; only large lists
  // require a round trip while typing. Rendering remains paged in either case.
  const size = start === 0 && snapshot.values.length <= 1000 ? 1000 : PAGE
  // An unsearched snapshot already has an exact total and order. Paging it
  // must not walk every distinct value again for each 150-value response.
  if (!match) {
    const total = snapshot.values.length
    for (let index = start; index < Math.min(total, start + size); index++) options.push(facetOptionAt(snapshot, index))
    return { options, total, revision, ...(start + options.length < total ? { next: start + options.length } : {}) }
  }
  let total = 0
  for (let index = 0; index < snapshot.values.length; index++) {
    if (!snapshot.search[index].includes(match)) continue
    if (total >= start && options.length < size) options.push(facetOptionAt(snapshot, index))
    total++
  }
  return { options, total, revision, ...(start + options.length < total ? { next: start + options.length } : {}) }
}
export async function selectJournalFilterValues(input: JournalFilterRequest) {
  const { snapshot, revision, match } = await readSnapshot(input)
  const values = snapshot.values.filter((_value, index) => !match || snapshot.search[index].includes(match))
  return { revision, values }
}
