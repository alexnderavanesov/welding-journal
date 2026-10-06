import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SYSTEM_INDEX_SETTINGS as defaults } from '@/lib/system-index-settings'
import { prepareSystemIndexSettingsChange } from './system-index-settings-policy'

function database(rows: { id: number }[]) {
  const limit = vi.fn().mockResolvedValue(rows), from = vi.fn(() => ({ limit })), select = vi.fn(() => ({ from }))
  return { tx: { select } as unknown as Parameters<typeof prepareSystemIndexSettingsChange>[0], select, limit }
}

describe('immutable system index letters after the first joint', () => {
  it.each(['shopJoint', 'fieldJoint', 'repair', 'cutout', 'coil'])('blocks changing %s with one bounded existence query', async key => {
    const db = database([{ id: 1 }])
    await expect(prepareSystemIndexSettingsChange(db.tx, defaults, { ...defaults, [key]: 'Q' })).rejects.toThrow('пока в проекте нет стыков')
    expect(db.select).toHaveBeenCalledOnce(); expect(db.limit).toHaveBeenCalledExactlyOnceWith(1)
  })
  it('allows letters in an empty project and normalizes their case', async () => {
    const db = database([])
    expect(await prepareSystemIndexSettingsChange(db.tx, undefined, { ...defaults, repair: ' q ' })).toEqual({ ...defaults, repair: 'Q' })
    expect(db.limit).toHaveBeenCalledExactlyOnceWith(1)
  })
  it('allows both leading-letter transitions without a weld query, preserving custom indexes', async () => {
    const db = database([{ id: 1 }]), current = { ...defaults, repair: 'Q' }
    for (const flag of [true, false]) expect(await prepareSystemIndexSettingsChange(db.tx, current,
      { ...current, allowLeadingLetterIndex: flag })).toEqual({ ...current, allowLeadingLetterIndex: flag })
    expect(db.select).not.toHaveBeenCalled()
  })
  it.each([{ ...defaults, repair: 'S' }, { ...defaults, repair: '' }, { ...defaults, repair: 'QQ' }])('rejects invalid letters before any query: %s', async value => {
    const db = database([])
    await expect(prepareSystemIndexSettingsChange(db.tx, defaults, value)).rejects.toThrow()
    expect(db.select).not.toHaveBeenCalled()
  })
})
