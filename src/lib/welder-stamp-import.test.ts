import { describe, expect, it } from 'vitest'
import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from './report-config'
import { DEFAULT_SAVE_CHECK_SETTINGS } from './save-check-settings'
import type { WeldInput } from './weld-fields'
import { validateWelderStampFieldsForImport } from './welder-stamp-import'

const officialStampField = OFFICIAL_WELDER_STAMP_FIELD_KEYS[0]

describe('welder stamp import validation', () => {
  it('blocks unknown official stamps when registry checking is enabled', () => {
    const records = [{ joint: 'F1', [officialStampField]: 'UNKNOWN' }] as WeldInput[]

    expect(() =>
      validateWelderStampFieldsForImport(records, {
        [officialStampField]: [{ value: 'ABC1' }],
      }),
    ).toThrow('активного реестра клейм')
  })

  it('allows unknown official stamps when registry checking is disabled', () => {
    const records = [{ joint: 'F1', [officialStampField]: 'UNKNOWN' }] as WeldInput[]

    expect(() =>
      validateWelderStampFieldsForImport(
        records,
        {
          [officialStampField]: [{ value: 'ABC1' }],
        },
        [],
        {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialRegistry: false,
        },
      ),
    ).not.toThrow()
  })
})
