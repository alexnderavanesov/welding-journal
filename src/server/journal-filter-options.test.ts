import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ list: vi.fn(), context: vi.fn(), revision: vi.fn() }))
vi.mock('./weld-read', () => ({ listColumnFilterOptions: mocks.list, normalizeWeldColumnFilterOptionsRequest: (value: unknown) => value }))
vi.mock('./journal-grid', () => ({ journalReadIdentity: mocks.context, assertJournalContextRevision: mocks.revision }))
import { readJournalFilterPage, selectJournalFilterValues } from './journal-filter-options'
import { journalFilterSearchText, type JournalFilterRequest } from '@/lib/journal-filter-options'
import type { WeldColumnFilterOption } from './weld-contracts'
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
  // A packed snapshot no longer retains or reads the raw option objects.
  // Keep the bounded-page requirement without requiring those old references.
  expect(reads).toBeLessThanOrEqual(150)
  expect(page.options).toHaveLength(150)
  expect(lengthReads).toBeLessThan(10)
  expect(mocks.list).toHaveBeenCalledOnce()
  reads = 0
  expect(await readJournalFilterPage({ ...input, start: 200001 })).toEqual({ options: [], total: 200000, revision })
  expect(reads).toBe(0)
})

it('reuses one source computation for first page, search, More and SelectFound with 250000 long distinct values', async () => {
  const options = Array.from({ length: 250000 }, (_, index) => {
    const value = 'F' + String(index).padStart(12, '0')
    return { value, label: value, count: index % 19 + 1 }
  })
  mocks.list.mockResolvedValue(options)
  const input = { fieldKey: 'joint' as const, revision }
  expect(await readJournalFilterPage(input)).toEqual({ options: options.slice(0, 150), total: 250000, next: 150, revision })
  const match = 'f00000001'
  expect(await readJournalFilterPage({ ...input, match })).toEqual({
    options: options.slice(10000, 10150), total: 10000, next: 150, revision,
  })
  expect(await readJournalFilterPage({ ...input, match, start: 150 })).toEqual({
    options: options.slice(10150, 10300), total: 10000, next: 300, revision,
  })
  expect(await selectJournalFilterValues({ ...input, match })).toEqual({
    values: options.slice(10000, 20000).map(option => option.value), revision,
  })
  expect(await readJournalFilterPage({ ...input, start: 249995 })).toEqual({ options: options.slice(249995), total: 250000, revision })
  expect(mocks.list).toHaveBeenCalledOnce()
  expect(mocks.context).toHaveBeenCalledTimes(5)
})

const exactSearchCases: Array<{
  fieldKey: JournalFilterRequest['fieldKey']; options: WeldColumnFilterOption[]; matches: string[]
}> = [
  { fieldKey: 'joint', options: [
    { value: 'plain', label: 'plain', count: Number.MAX_SAFE_INTEGER },
    { value: '', label: '(пусто)', count: 0 },
    { value: 'A B', label: 'A B', count: 4294967313 },
    { value: 'ЁЖ\ud800', label: 'Особая подпись', count: 7 },
    { value: 'blank-label', label: '', count: 3 },
  ], matches: ['', ' ', 'plain plain', 'b a', 'Ёж', '(пусто)', 'подпись', '\ud800', 'blank-label', 'not-found'] },
  { fieldKey: 'wdi', options: [
    { value: '12.50', label: '12.50', count: 5 },
    { value: '-0.01', label: '-0.01', count: 3 },
    { value: '1000.35', label: '1000.35', count: 7 },
  ], matches: ['', '12,5', '12.5', '-0', '1\u00a0000', '50 12', ' '] },
  { fieldKey: 'weldDate', options: [
    { value: '2026-11-07', label: '2026-11-07', count: 8 },
    { value: '', label: '(пусто)', count: 4 },
  ], matches: ['', '07.11', '2026', '07 2026', '(пусто)', ' '] },
  { fieldKey: 'createdAt', options: [
    { value: '2026-11-06T21:01:02.003Z', label: '2026-11-06T21:01:02.003Z', count: 1 },
  ], matches: ['', '21:01', '.003', 'z 2026', ' '] },
]
it.each(exactSearchCases)('preserves raw labels, exact counts and full search text for $fieldKey', async ({ fieldKey, options, matches }) => {
  mocks.list.mockResolvedValue(options)
  const input = { fieldKey, revision }
  for (const match of matches) {
    const expected = options.filter(option => journalFilterSearchText(fieldKey, option).includes(match.toLocaleLowerCase('ru')))
    expect(await readJournalFilterPage({ ...input, match })).toEqual({ options: expected, total: expected.length, revision })
    expect(await readJournalFilterPage({ ...input, match, start: 1 })).toEqual({ options: expected.slice(1), total: expected.length, revision })
    expect(await selectJournalFilterValues({ ...input, match })).toEqual({ values: expected.map(option => option.value), revision })
  }
  expect(mocks.list).toHaveBeenCalledOnce()
})

it('coalesces concurrent page and selection requests without skipping access or revision checks', async () => {
  let release!: (options: WeldColumnFilterOption[]) => void
  let started!: () => void
  const sourceStarted = new Promise<void>(resolve => { started = resolve })
  mocks.list.mockImplementationOnce(() => new Promise<WeldColumnFilterOption[]>(resolve => { release = resolve; started() }))
  const input = { fieldKey: 'joint' as const, revision }
  const first = readJournalFilterPage(input)
  const selection = selectJournalFilterValues({ ...input, match: 'second' })
  await sourceStarted
  expect(mocks.list).toHaveBeenCalledOnce()
  const options = [{ value: 'first', label: 'first', count: 0 }, { value: 'second', label: 'Second label', count: 42 }]
  release(options)
  expect(await first).toEqual({ options, total: 2, revision })
  expect(await selection).toEqual({ values: ['second'], revision })
  expect(mocks.list).toHaveBeenCalledOnce()
  expect(mocks.context).toHaveBeenCalledTimes(2)
  expect(mocks.revision).toHaveBeenCalledTimes(3) // one source computation and both completed reads
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
