import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ list: vi.fn(), context: vi.fn(), revision: vi.fn() }))
vi.mock('./weld-read', () => ({ listColumnFilterOptions: mocks.list, normalizeWeldColumnFilterOptionsRequest: (value: unknown) => value }))
vi.mock('./journal-grid', () => ({ journalReadIdentity: mocks.context, assertJournalContextRevision: mocks.revision }))
import { readJournalFilterPage, selectJournalFilterValues } from './journal-filter-options'
let revision = 0
it('keeps facets of different reports separate at the same revision', async () => {
  mocks.list.mockImplementation(async ({ report }) => [{ value: report, label: report, count: 1 }])
  for (const report of ['weldingJournal', 'lnk', 'heatTreatment'] as const) {
    expect((await readJournalFilterPage({ report, fieldKey: 'joint' })).options[0].value).toBe(report)
    expect(mocks.context.mock.lastCall?.[0].report).toBe(report)
  }
  expect(mocks.list).toHaveBeenCalledTimes(3)
})
beforeEach(() => {
  vi.clearAllMocks(); revision++
  mocks.context.mockResolvedValue({ revision, dispatcher: { computedRevision: revision, computedAt: 'now' } })
  mocks.revision.mockResolvedValue(undefined)
})
it('pages an ordered facet and returns every match only on explicit selection, reusing one computation', async () => {
  const options = Array.from({ length: 1353 }, (_, i) => ({ value: `J${String(i).padStart(4, '0')}`, label: `J${String(i).padStart(4, '0')}`, count: i + 1 }))
  mocks.list.mockResolvedValue(options)
  const input = { fieldKey: 'joint' as const, columnFilters: { line: 'L' }, revision }
  const first = await readJournalFilterPage(input)
  expect(first).toEqual({ options: options.slice(0, 150), total: 1353, next: 150, revision })
  expect(await readJournalFilterPage({ ...input, start: 150 })).toMatchObject({ options: options.slice(150, 300), next: 300 })
  expect(await readJournalFilterPage({ ...input, start: 1350 })).toEqual({ options: options.slice(1350), total: 1353, revision })
  expect(await selectJournalFilterValues({ ...input, match: 'j' })).toEqual({ values: options.map(option => option.value), revision })
  expect(await readJournalFilterPage({ ...input, match: 'J135' })).toEqual({ options: options.slice(1350), total: 3, revision })
  expect(mocks.list).toHaveBeenCalledOnce()
  expect(mocks.context).toHaveBeenCalledTimes(5) // access/revision on every cache hit
  mocks.revision.mockRejectedValueOnce(new Error('revision changed'))
  await expect(readJournalFilterPage(input)).rejects.toThrow('revision changed')
})
it('keeps formatted decimal search equivalent and invalidates across revisions and scopes', async () => {
  mocks.list.mockResolvedValue([{ value: '12.5', label: '12.5', count: 2 }])
  expect((await readJournalFilterPage({ fieldKey: 'wdi', match: '12,5' })).total).toBe(1)
  expect((await readJournalFilterPage({ fieldKey: 'wdi', match: '12.5' })).total).toBe(1)
  expect(mocks.list).toHaveBeenCalledOnce()
  await readJournalFilterPage({ fieldKey: 'wdi', columnFilters: { line: 'Other' } })
  expect(mocks.list).toHaveBeenCalledTimes(2)
  mocks.context.mockResolvedValue({ revision: ++revision, dispatcher: { computedRevision: revision, computedAt: 'later' } })
  await readJournalFilterPage({ fieldKey: 'wdi' })
  expect(mocks.list).toHaveBeenCalledTimes(3)
})

it('reads only the requested page from a warm 200000-value facet without a search', async () => {
  let reads = 0, lengthReads = 0
  const raw = Array.from({ length: 200000 }, (_, i) => ({ value: `J${i}`, label: `J${i}`, count: 1 }))
  const options = new Proxy(raw, { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++
    if (key === 'length') lengthReads++
    return Reflect.get(target, key, receiver)
  } })
  mocks.list.mockResolvedValue(options)
  const input = { fieldKey: 'joint' as const, revision }
  await readJournalFilterPage(input) // Build the exact snapshot once.
  reads = 0; lengthReads = 0
  const page = await readJournalFilterPage({ ...input, start: 100000 })
  expect(page).toEqual({ options: raw.slice(100000, 100150), total: 200000, next: 100150, revision })
  expect(reads).toBe(150)
  expect(lengthReads).toBeLessThan(10)
  expect(mocks.list).toHaveBeenCalledOnce()
  reads = 0
  expect(await readJournalFilterPage({ ...input, start: 200001 })).toEqual({ options: [], total: 200000, revision })
  expect(reads).toBe(0)
})

it('does not return a cached page or selection after access is revoked', async () => {
  mocks.list.mockResolvedValue([{value:'J1',label:'J1',count:1}])
  const input = {fieldKey:'joint' as const,revision}
  await readJournalFilterPage(input)
  mocks.context.mockRejectedValue(new Error('access denied'))
  await expect(readJournalFilterPage({...input,match:'j'})).rejects.toThrow('access denied')
  await expect(selectJournalFilterValues({...input,match:'j'})).rejects.toThrow('access denied')
  expect(mocks.list).toHaveBeenCalledOnce()
})

it('rebuilds the list after a dispatcher publication changes at the same source revision', async () => {
  mocks.list.mockResolvedValueOnce([{value:'J1',label:'J1',count:1}]).mockResolvedValue([{value:'J2',label:'J2',count:2}])
  const input = {fieldKey:'joint' as const,revision}
  expect((await readJournalFilterPage(input)).options[0].value).toBe('J1')
  mocks.context.mockResolvedValue({revision,dispatcher:{computedRevision:revision,computedAt:'later'}})
  expect((await readJournalFilterPage(input)).options[0].value).toBe('J2')
  expect(mocks.list).toHaveBeenCalledTimes(2)
})

it('expires the cache normally without bypassing freshness checks', async () => {
  vi.useFakeTimers()
  try {
    mocks.list.mockResolvedValue([{value:'J1',label:'J1',count:1}])
    const input = {fieldKey:'joint' as const,revision}
    await readJournalFilterPage(input)
    vi.advanceTimersByTime(30001)
    await readJournalFilterPage(input)
    expect(mocks.list).toHaveBeenCalledTimes(2)
    expect(mocks.context).toHaveBeenCalledTimes(2)
  } finally { vi.useRealTimers() }
})
