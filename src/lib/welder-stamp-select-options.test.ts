import { describe, expect, it } from 'vitest'
import { FACTUAL_WELDER_STAMP_FIELD_KEYS, OFFICIAL_WELDER_STAMP_FIELD_KEYS } from './report-config'
import type { WeldInput } from './weld-fields'
import {
  buildWeldFormStampSelectOptions,
  getArchivedOfficialStampValuesForRecord,
  getOfficialStampCompatibilitySaveBlockReason,
} from './welder-stamp-compatibility'
import type { WelderStampRecord, WelderStampSuspensionRecord } from './welder-stamp-types'

const officialStampField = OFFICIAL_WELDER_STAMP_FIELD_KEYS[0]
const factualStampField = FACTUAL_WELDER_STAMP_FIELD_KEYS[0]

function stampRecord(value: string, archived: boolean, weldType = 'РАД'): WelderStampRecord {
  return {
    id: archived ? 1 : 2,
    naksStamp: value,
    welderName: '',
    internalStamp: '',
    weldType,
    diameterFrom: '1',
    diameterTo: '1000',
    validFrom: '01.01.2026',
    validTo: '31.12.2026',
    archived,
  }
}

function suspensionRecord(value: string): WelderStampSuspensionRecord {
  return {
    id: 1,
    naksStamp: value,
    suspendedFrom: '10.07.2026',
    suspendedTo: '20.07.2026',
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

  it('disables and blocks an official stamp suspended on the weld date', () => {
    const activeStamp = stampRecord('ABC1', false)
    const suspension = suspensionRecord('ABC1')
    const row = {
      [officialStampField]: 'ABC1',
      weldingMethod: 'РАД',
      d1: '11',
      d2: '11',
      weldDate: '15.07.2026',
    } as WeldInput

    const options = buildWeldFormStampSelectOptions([activeStamp], row, [], [suspension])
    const blockReason = getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp], {
      suspensions: [suspension],
    })

    expect(options[officialStampField]?.find((option) => option.value === 'ABC1')).toMatchObject({
      value: 'ABC1',
      disabled: true,
    })
    expect(blockReason).toContain('Клеймо ABC1')
    expect(blockReason).toContain('отстранено')
  })

  it('can include archived stamps in create and edit dropdowns by setting', () => {
    const archivedStamp = { ...stampRecord('ARCH1', true), internalStamp: 'I-ARCH' }
    const archivedInternalStamp = { ...stampRecord('', true), internalStamp: 'I-ONLY' }
    const activeStamp = stampRecord('ACTIVE1', false)
    const row = { weldingMethod: 'РАД' } as WeldInput

    const options = buildWeldFormStampSelectOptions([archivedStamp, archivedInternalStamp, activeStamp], row, [], [], {
      includeArchivedStamps: true,
    })

    expect(options[officialStampField]?.some((option) => option.value === 'ARCH1')).toBe(true)
    expect(options[officialStampField]?.find((option) => option.value === 'ARCH1')?.disabled).toBe(false)
    expect(options[factualStampField]?.some((option) => option.value === 'ARCH1')).toBe(true)
    expect(options[factualStampField]?.some((option) => option.value === 'I-ONLY')).toBe(true)
  })

  it('allows several official welders to cover a combined welding method as a team', () => {
    const rootStamp = stampRecord('AAAA', false, 'РАД')
    const fillStamp = stampRecord('BBBB', false, 'РД')
    const row = {
      stamp1K: 'AAAA',
      stamp1Z: 'BBBB',
      stamp1O: 'BBBB',
      weldingMethod: 'РАД+РД',
      d1: '11',
      d2: '11',
      weldDate: '15.07.2026',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [rootStamp, fillStamp])).toBeNull()
  })

  it('keeps a single official welder strict for every selected welding method', () => {
    const rootStamp = stampRecord('AAAA', false, 'РАД')
    const row = {
      stamp1K: 'AAAA',
      stamp1Z: 'AAAA',
      stamp1O: 'AAAA',
      weldingMethod: 'РАД+РД',
      d1: '11',
      d2: '11',
      weldDate: '15.07.2026',
    } as WeldInput

    const blockReason = getOfficialStampCompatibilitySaveBlockReason(row, [rootStamp])

    expect(blockReason).toContain('Корень_1')
    expect(blockReason).toContain('РД')
  })

  it('blocks a team when no official welder covers one of the combined methods', () => {
    const rootStamp = stampRecord('AAAA', false, 'РАД')
    const fillStamp = stampRecord('BBBB', false, 'РАД')
    const row = {
      stamp1K: 'AAAA',
      stamp1Z: 'BBBB',
      weldingMethod: 'РАД+РД',
      d1: '11',
      d2: '11',
      weldDate: '15.07.2026',
    } as WeldInput

    const blockReason = getOfficialStampCompatibilitySaveBlockReason(row, [rootStamp, fillStamp])

    expect(blockReason).toContain('Команда официальных клейм')
    expect(blockReason).toContain('РД')
  })

  it('keeps partial official stamps selectable for combined welding methods', () => {
    const rootStamp = stampRecord('AAAA', false, 'РАД')
    const fillStamp = stampRecord('BBBB', false, 'РД')
    const row = {
      weldingMethod: 'РАД+РД',
      d1: '11',
      d2: '11',
    } as WeldInput

    const options = buildWeldFormStampSelectOptions([rootStamp, fillStamp], row)

    expect(options[officialStampField]?.find((option) => option.value === 'AAAA')?.disabled).toBe(false)
    expect(options[officialStampField]?.find((option) => option.value === 'BBBB')?.disabled).toBe(false)
  })
})
