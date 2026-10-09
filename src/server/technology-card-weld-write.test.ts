import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { createTechnologyCardMatcher } from '@/lib/technology-card-matching'
import type { TechnologyCardRecord } from '@/lib/technology-card-types'
import type { WeldInput } from '@/lib/weld-fields'
import { prepareTechnologyCardWeldWrites } from './technology-card-weld-write'
import { loadTechnologyCardMatcher, markTechnologyCardsUsed, resolveTechnologyCardNames } from './technology-card-registry'
import { lockTechnologyCardRegistry } from './technology-card-registry-lock'
import { restrictWeldMutationRecord } from './weld-mutation-policy'

vi.mock('./technology-card-registry', () => ({ loadTechnologyCardMatcher: vi.fn(), markTechnologyCardsUsed: vi.fn(), resolveTechnologyCardNames: vi.fn() }))
vi.mock('./technology-card-registry-lock', () => ({ lockTechnologyCardRegistry: vi.fn() }))
vi.mock('./weld-validation-settings-lock', () => ({ lockWeldValidationSettings: vi.fn() }))
const tx = {} as Parameters<typeof prepareTechnologyCardWeldWrites>[0]
const card: TechnologyCardRecord = { id: 1, revision: 2, name: 'ТК №12', weldingMethods: ['РАД'], connectionType: 'С17',
  materialGroups: ['М01'], diameterFrom: 57, diameterTo: 159, thicknessFrom: 3, thicknessTo: 8, psto: 'any', archived: false }
const row: WeldInput = { id: 10, joint: 'F10', weldDate: '2026-10-01', weldingMethod: 'РАД', connectionType: 'С17', materialGroup: 'М01', d1: 57, d2: 159, t1: 6, t2: 3, weldingElectrodes: 'Сохранить' }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadTechnologyCardMatcher).mockResolvedValue(createTechnologyCardMatcher([card], DEFAULT_DATA_LIST_SETTINGS))
  vi.mocked(resolveTechnologyCardNames).mockResolvedValue(new Map([[card.name, card]]))
})
describe('final merged technology card writes', () => {
  it('adds no registry queries for unrelated saved-date edits or undated joints', async () => {
    await prepareTechnologyCardWeldWrites(tx, [{ ...row, joint: 'F20' }], new Map([[10, row]]))
    await prepareTechnologyCardWeldWrites(tx, [{ ...row, weldDate: null }], new Map())
    expect(lockTechnologyCardRegistry).not.toHaveBeenCalled()
    expect(markTechnologyCardsUsed).not.toHaveBeenCalled()
  })
  it('batches 200000 new dates with one matcher and usage operation; preserves materials', async () => {
    const records: WeldInput[] = Array.from({ length: 200_000 }, (_, id) => ({ ...row, id }))
    await prepareTechnologyCardWeldWrites(tx, records, new Map())
    expect(loadTechnologyCardMatcher).toHaveBeenCalledOnce()
    expect(markTechnologyCardsUsed).toHaveBeenCalledOnce()
    expect(records.every(item => item.technologyCardNumber === card.name && item.weldingElectrodes === row.weldingElectrodes)).toBe(true)
  })
  it('preserves unknown/mismatched text, older dates and missing dimensions', async () => {
    const records: WeldInput[] = [{ ...row, id: 1, technologyCardNumber: 'Неизвестная' }, { ...row, id: 2, d2: null }, { ...row, id: 3 }]
    await prepareTechnologyCardWeldWrites(tx, records, new Map([[3, { ...row, id: 3 }]]))
    expect(records.map(item => item.technologyCardNumber)).toEqual(['Неизвестная', undefined, undefined])
  })
  it.each([{ ...card, revision: 3 }, { ...card, archived: true }, { ...card, name: 'Переименована' }])('rejects a stale selected card before saving', async current => {
    vi.mocked(resolveTechnologyCardNames).mockResolvedValue(new Map([[card.name, current]]))
    await expect(prepareTechnologyCardWeldWrites(tx, [{ ...row, technologyCardNumber: card.name, technologyCardSelection: { id: 1, revision: 2 } }], new Map([[10, row]]))).rejects.toThrow('уже изменена или архивирована')
    expect(markTechnologyCardsUsed).not.toHaveBeenCalled()
  })
  it('marks the previous name used when its last link is cleared', async () => {
    await prepareTechnologyCardWeldWrites(tx, [{ ...row, technologyCardNumber: null }], new Map([[10, { ...row, technologyCardNumber: card.name }]]))
    expect(markTechnologyCardsUsed).toHaveBeenCalledWith(tx, expect.arrayContaining([expect.objectContaining({ technologyCardNumber: card.name })]))
  })
  it('retains selection revision in welding only, never in other mutation scopes', () => {
    const input = { id: 10, technologyCardSelection: { id: 1, revision: 2 } }
    expect(restrictWeldMutationRecord(input, 'welding').technologyCardSelection).toEqual(input.technologyCardSelection)
    expect(restrictWeldMutationRecord(input, 'lnk').technologyCardSelection).toBeUndefined()
  })
})
