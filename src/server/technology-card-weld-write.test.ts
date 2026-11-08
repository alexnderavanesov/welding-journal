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
  it('batches 200000 new dates with one matcher and usage operation; applies nonempty defaults and preserves empty ones', async () => {
    const materials = { ...card, weldingElectrodes: 'Из ТК', fillerWire: '  ', shieldingGas: 'Аргон' }
    vi.mocked(loadTechnologyCardMatcher).mockResolvedValue(createTechnologyCardMatcher([materials], DEFAULT_DATA_LIST_SETTINGS))
    const records: WeldInput[] = Array.from({ length: 200_000 }, (_, id) => ({ ...row, id, fillerWire: 'Ручная проволока' }))
    await prepareTechnologyCardWeldWrites(tx, records, new Map())
    expect(loadTechnologyCardMatcher).toHaveBeenCalledOnce()
    expect(markTechnologyCardsUsed).toHaveBeenCalledOnce()
    expect(records.every(item => item.technologyCardNumber === card.name && item.weldingElectrodes === 'Из ТК' && item.fillerWire === 'Ручная проволока' && item.shieldingGas === 'Аргон')).toBe(true)
  })
  it('validates a selected revision without overwriting manual corrections made after that choice', async () => {
    vi.mocked(resolveTechnologyCardNames).mockResolvedValue(new Map([[card.name, { ...card, weldingElectrodes: 'Из ТК' }]]))
    const records = [{ ...row, technologyCardNumber: card.name, technologyCardSelection: { id: card.id, revision: card.revision } }]
    await prepareTechnologyCardWeldWrites(tx, records, new Map())
    expect(records[0].weldingElectrodes).toBe('Сохранить')
    expect(loadTechnologyCardMatcher).not.toHaveBeenCalled()
  })
  it('preserves unknown/mismatched text, older dates and missing dimensions', async () => {
    const records: WeldInput[] = [{ ...row, id: 1, technologyCardNumber: 'Неизвестная' }, { ...row, id: 2, d2: null }, { ...row, id: 3 }]
    await prepareTechnologyCardWeldWrites(tx, records, new Map([[3, { ...row, id: 3 }]]))
    expect(records.map(item => item.technologyCardNumber)).toEqual(['Неизвестная', undefined, undefined])
  })
  it('auto-assigns support cards from final merged D1/T1 and the single group in the same bounded write path', async () => {
    const supportCard = { ...card, name: 'ТК-ОП', connectionType: 'Т1', materialGroups: ['М05'], weldingMethods: ['РД'] }
    const settings = { ...DEFAULT_DATA_LIST_SETTINGS, connectionTypes: [...DEFAULT_DATA_LIST_SETTINGS.connectionTypes, 'Т1'] }
    vi.mocked(loadTechnologyCardMatcher).mockResolvedValue(createTechnologyCardMatcher([supportCard], settings))
    const support = { ...row, joint: 'ОП-1', connectionType: 'Т1', materialGroup: 'М05', weldingMethod: 'РД', d2: null, t2: null }
    const records: WeldInput[] = [
      { ...support, id: 1 }, { ...support, id: 2, technologyCardNumber: 'Назначена ранее' },
      { ...support, id: 3 }, { ...support, id: 4, materialGroup: 'М01' },
    ]
    await prepareTechnologyCardWeldWrites(tx, records, new Map([[1, { ...support, id: 1, weldDate: null }], [3, { ...support, id: 3 }]]))
    expect(records.map(value => value.technologyCardNumber)).toEqual([supportCard.name, 'Назначена ранее', undefined, undefined])
    expect(loadTechnologyCardMatcher).toHaveBeenCalledOnce()
    expect(markTechnologyCardsUsed).toHaveBeenCalledOnce()
    expect(records.every(value => value.weldingElectrodes === 'Сохранить' && value.d2 === null && value.t2 === null)).toBe(true)
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
