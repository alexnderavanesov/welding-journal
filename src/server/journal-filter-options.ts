import { createHash } from 'node:crypto'
import { FIELD_BY_KEY } from '@/lib/weld-fields'
import { journalFilterSearchText, type JournalFilterPage, type JournalFilterRequest } from '@/lib/journal-filter-options'
import type { WeldColumnFilterOption } from './weld-contracts'
import { listColumnFilterOptions, normalizeWeldColumnFilterOptionsRequest } from './weld-read'
import { assertJournalContextRevision, journalReadIdentity } from './journal-grid'
import { createJournalSnapshotCache } from './journal-snapshot-cache'

type FacetSnapshot = { options: WeldColumnFilterOption[]; search: string[] }
const facets = createJournalSnapshotCache<FacetSnapshot>({ bytes: 64 * 1024 * 1024, entries: 16,
  weigh: value => value.options.reduce((sum, option, index) => sum + 128 + 2 * (option.value.length + option.label.length + value.search[index].length), 0) })
const PAGE = 150
async function readSnapshot(input: JournalFilterRequest) {
  if (!input || !FIELD_BY_KEY.has(input.fieldKey) || input.match !== undefined && typeof input.match !== 'string'
    || input.start !== undefined && (!Number.isSafeInteger(input.start) || input.start < 0)) throw new Error('Некорректный запрос значений фильтра.')
  const data = normalizeWeldColumnFilterOptionsRequest({ report: 'weldingJournal', fieldKey: input.fieldKey, search: input.search, columnFilters: input.columnFilters })
  const context = await journalReadIdentity({ columnFilters: { ...data.columnFilters, ...(data.search ? { search: data.search } : {}) },
    groupBy: [], route: [], start: 0, end: 100, revision: input.revision }, data.fieldKey)
  const key = createHash('sha256').update(JSON.stringify([context.revision, context.dispatcher.computedRevision, context.dispatcher.computedAt, data])).digest('hex')
  const snapshot = await facets.load(key, async () => {
    const options = await listColumnFilterOptions(data)
    await assertJournalContextRevision(context)
    return { options, search: options.map(option => journalFilterSearchText(data.fieldKey, option)) }
  })
  await assertJournalContextRevision(context)
  return { snapshot, revision: context.revision, match: (input.match ?? '').toLocaleLowerCase('ru') }
}
export async function readJournalFilterPage(input: JournalFilterRequest): Promise<JournalFilterPage> {
  const { snapshot, revision, match } = await readSnapshot(input)
  const start = input.start ?? 0, options: WeldColumnFilterOption[] = []
  // Common lists stay available for immediate local search; only large lists
  // require a round trip while typing. Rendering remains paged in either case.
  const size = start === 0 && snapshot.options.length <= 1000 ? 1000 : PAGE
  // An unsearched snapshot already has an exact total and order. Paging it
  // must not walk every distinct value again for each 150-value response.
  if (!match) {
    const total = snapshot.options.length
    const options = snapshot.options.slice(start, start + size)
    return { options, total, revision, ...(start + options.length < total ? { next: start + options.length } : {}) }
  }
  let total = 0
  for (let index = 0; index < snapshot.options.length; index++) {
    if (!snapshot.search[index].includes(match)) continue
    if (total >= start && options.length < size) options.push(snapshot.options[index])
    total++
  }
  return { options, total, revision, ...(start + options.length < total ? { next: start + options.length } : {}) }
}
export async function selectJournalFilterValues(input: JournalFilterRequest) {
  const { snapshot, revision, match } = await readSnapshot(input)
  return { revision, values: snapshot.options.filter((_option, index) => !match || snapshot.search[index].includes(match)).map(option => option.value) }
}
