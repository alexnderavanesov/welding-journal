import { expect, it, vi } from 'vitest'
import { parseJointName, validateManualJointName } from './joint-name'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'

it('reuses bounded patterns without caching parsed rows or stale mutable settings', () => {
  const settings = { ...DEFAULT_SYSTEM_INDEX_SETTINGS }
  parseJointName('S1', settings)
  const regex = vi.spyOn(globalThis, 'RegExp')
  try {
    for (let i = 1; i <= 200; i++) {
      expect(parseJointName(`S${i}R2W1`, settings).segments).toEqual([{ suffix: 'R', index: 2 }, { suffix: 'W', index: 1 }])
    }
    expect(regex).not.toHaveBeenCalled()
    regex.mockRestore()
    settings.repair = 'Q'
    expect(parseJointName('S1Q2', settings).segments).toEqual([{ suffix: 'R', index: 2 }])
    expect(validateManualJointName('S1Q2', settings)).toMatch(/зарезервированы/)
    expect(parseJointName('S1R2', DEFAULT_SYSTEM_INDEX_SETTINGS).segments).toEqual([{ suffix: 'R', index: 2 }])
    // A caller mutating its result cannot poison later parsing.
    parseJointName('S1R2').segments.length = 0
    expect(parseJointName('S1R2').segments).toHaveLength(1)
  } finally { regex.mockRestore() }
})
