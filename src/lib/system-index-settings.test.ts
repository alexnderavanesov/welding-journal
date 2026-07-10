import { afterEach, describe, expect, it } from 'vitest'

import { formatRepeatedJointName, getCoilJointNames, parseJointChainName } from '@/lib/joint-chain'
import {
  DEFAULT_SYSTEM_INDEX_SETTINGS,
  getConfiguredBaseJointType,
  getSystemIndexValidationError,
  saveSystemIndexSettings,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'

const customSettings: SystemIndexSettings = {
  shopJoint: 'A',
  fieldJoint: 'B',
  repair: 'C',
  cutout: 'D',
  coil: 'E',
}

describe('system index settings', () => {
  afterEach(() => {
    saveSystemIndexSettings(DEFAULT_SYSTEM_INDEX_SETTINGS)
  })

  it('formats and parses joint chain names with configured letters', () => {
    saveSystemIndexSettings(customSettings)

    expect(formatRepeatedJointName('B1', [{ suffix: 'R', index: 1 }])).toBe('B1C1')
    expect(formatRepeatedJointName('B1', [{ suffix: 'W', index: 2 }])).toBe('B1D2')
    expect(getCoilJointNames('B1')).toEqual(['B1E1', 'B1E2'])
    expect(parseJointChainName('B1D2C1E1')).toEqual({
      base: 'B1',
      segments: [
        { suffix: 'W', index: 2 },
        { suffix: 'R', index: 1 },
        { suffix: 'Y', index: 1 },
      ],
    })
  })

  it('uses configured base indexes for S/F statistics semantics', () => {
    saveSystemIndexSettings(customSettings)

    expect(getConfiguredBaseJointType('A10')).toBe('s')
    expect(getConfiguredBaseJointType('B10')).toBe('f')
  })

  it('rejects duplicate configured letters', () => {
    expect(getSystemIndexValidationError({ ...customSettings, coil: 'D' })).toContain('не должны повторяться')
  })
})
