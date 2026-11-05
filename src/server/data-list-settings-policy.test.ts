import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { prepareDataListSettingsChangeInTransaction as prepare } from './data-list-settings-policy'

function transaction(used: string[] = []) {
  const limit = vi.fn().mockResolvedValue(used.map(value => ({ value })))
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }))
  return { tx: { select } as unknown as Parameters<typeof prepare>[0], select, limit }
}

describe('connection type deletion policy', () => {
  it('checks all removed types in one bounded query, regardless of list size', async () => {
    const previous = { ...DEFAULT_DATA_LIST_SETTINGS, connectionTypes: Array.from({ length: 200 }, (_, i) => `Т${i}`) }
    const { tx, select, limit } = transaction()
    expect((await prepare(tx, previous, { ...previous, connectionTypes: [] })).connectionTypes).toEqual([])
    expect(select).toHaveBeenCalledOnce()
    expect(limit).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('rejects the whole change if one removed type is used', async () => {
    const { tx } = transaction(['Т1'])
    await expect(prepare(tx, DEFAULT_DATA_LIST_SETTINGS, { ...DEFAULT_DATA_LIST_SETTINGS, connectionTypes: [] }))
      .rejects.toThrow('«Т1»: он используется в стыках')
  })

  it('does not query welds for additions or invalid input', async () => {
    const { tx, select } = transaction()
    const next = { ...DEFAULT_DATA_LIST_SETTINGS, connectionTypes: [...DEFAULT_DATA_LIST_SETTINGS.connectionTypes, 'Т4'] }
    expect((await prepare(tx, DEFAULT_DATA_LIST_SETTINGS, next)).connectionTypes).toContain('Т4')
    await expect(prepare(tx, DEFAULT_DATA_LIST_SETTINGS, { ...next, connectionTypes: ['Н1'] })).rejects.toThrow('«С», «У» или «Т»')
    expect(select).not.toHaveBeenCalled()
  })
})
