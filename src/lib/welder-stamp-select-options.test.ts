import { describe, expect, it } from 'vitest'
import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from './report-config'
import type { WeldInput } from './weld-fields'
import {
  buildWeldFormStampSelectOptions,
  getArchivedOfficialStampValuesForRecord,
  getOfficialStampCompatibilitySaveBlockReason,
} from './welder-stamp-compatibility'
import type { WelderStampRecord } from './welder-stamp-types'

const officialStampField = OFFICIAL_WELDER_STAMP_FIELD_KEYS[0]

function stampRecord(value: string, archived: boolean): WelderStampRecord {
  return {
    id: archived ? 1 : 2,
    naksStamp: value,
    internalStamp: '',
    weldType: 'РАД',
    diameterFrom: '1',
    diameterTo: '1000',
    validFrom: '01.01.2026',
    validTo: '31.12.2026',
    archived,
  }
}

describe('welder stamp select options', () => {
  it('keeps an archived official stamp available only for the joint where it was already selected', () => {
    const archivedStamp = stampRecord('ABC1', true)
    const activeStamp = stampRecord('XYZ9', false)
    const row = {
      [officialStampField]: 'ABC1',
      weldingMethod: 'РАД',
      d1: '11',
      d2: '11',
    } as WeldInput

    const allowedArchivedStamps = getArchivedOfficialStampValuesForRecord(row, [archivedStamp, activeStamp])
    const optionsForExistingRow = buildWeldFormStampSelectOptions([archivedStamp, activeStamp], row, allowedArchivedStamps)
    const optionsForNewRow = buildWeldFormStampSelectOptions([archivedStamp, activeStamp], { weldingMethod: 'РАД' } as WeldInput)

    expect(allowedArchivedStamps).toEqual(['ABC1'])
    expect(optionsForExistingRow[officialStampField]?.find((option) => option.value === 'ABC1')).toMatchObject({
      value: 'ABC1',
      disabled: false,
    })
    expect(optionsForNewRow[officialStampField]?.some((option) => option.value === 'ABC1')).toBe(false)
    expect(getOfficialStampCompatibilitySaveBlockReason(row, [archivedStamp, activeStamp])).toContain('Корень_1')
    expect(
      getOfficialStampCompatibilitySaveBlockReason(row, [archivedStamp, activeStamp], {
        allowedArchivedOfficialStamps: allowedArchivedStamps,
      }),
    ).toBeNull()
  })
})
