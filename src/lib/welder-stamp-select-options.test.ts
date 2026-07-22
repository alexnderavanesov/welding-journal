import { beforeEach, describe, expect, it } from 'vitest'
import { saveDataListSettings } from './data-list-settings'
import { saveOtherSettings } from './other-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from './save-check-settings'
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

beforeEach(() => {
  window.localStorage.clear()
  saveDataListSettings({
    weldingTypes: ['РАД', 'РД'],
    connectionTypes: [],
    materialGroups: ['M01', 'M02'],
  })
  saveOtherSettings({
    includeArchivedWelderStampsInForm: false,
    requireDlsForOfficialStamps: false,
    wdiCalculationMode: 'manual',
    wdiTable: null,
  })
})

function stampRecord(value: string, archived: boolean, weldType = 'РАД'): WelderStampRecord {
  const naksPermit = {
    id: `naks-${value || 'empty'}`,
    weldType,
    materialGroups: 'M01, M02',
    diameterFrom: '1',
    diameterTo: '1000',
    thicknessFrom: '1',
    thicknessTo: '1000',
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    note: '',
  }
  return {
    id: archived ? 1 : 2,
    naksStamp: value,
    welderName: '',
    internalStamp: '',
    weldType,
    materialGroups: 'M01, M02',
    diameterFrom: '1',
    diameterTo: '1000',
    thicknessFrom: '1',
    thicknessTo: '1000',
    validFrom: '01.01.2026',
    validTo: '31.12.2026',
    naksPermits: [naksPermit],
    dlsPermits: [],
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

  it('allows disabling official registry compatibility in save checks', () => {
    const row = {
      [officialStampField]: 'UNKNOWN',
      weldingMethod: 'РАД',
      d1: '11',
      d2: '11',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [])).toContain('активном реестре')
    expect(
      getOfficialStampCompatibilitySaveBlockReason(row, [], {
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialRegistry: false,
        },
      }),
    ).toBeNull()
  })

  it('allows disabling official archive compatibility in save checks', () => {
    const archivedStamp = stampRecord('ABC1', true)
    const row = {
      [officialStampField]: 'ABC1',
      weldingMethod: 'РАД',
      d1: '11',
      d2: '11',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [archivedStamp])).toContain('ЗВ-02')
    expect(getOfficialStampCompatibilitySaveBlockReason(row, [archivedStamp])).toContain('находится в архиве')
    expect(
      getOfficialStampCompatibilitySaveBlockReason(row, [archivedStamp], {
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialArchive: false,
        },
      }),
    ).toBeNull()
  })

  it('allows disabling official suspension compatibility in save checks', () => {
    const activeStamp = stampRecord('ABC1', false)
    const suspension = suspensionRecord('ABC1')
    const row = {
      [officialStampField]: 'ABC1',
      weldingMethod: 'РАД',
      d1: '11',
      d2: '11',
      weldDate: '15.07.2026',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp], { suspensions: [suspension] })).toContain('отстранено')
    expect(
      getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp], {
        suspensions: [suspension],
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialSuspension: false,
        },
      }),
    ).toBeNull()
  })

  it('allows disabling official welding method compatibility in save checks', () => {
    const activeStamp = stampRecord('ABC1', false, 'РАД')
    const row = {
      [officialStampField]: 'ABC1',
      weldingMethod: 'РД',
      d1: '11',
      d2: '11',
      weldDate: '15.07.2026',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp])).toContain('РД')
    expect(
      getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp], {
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialWeldingMethod: false,
        },
      }),
    ).toBeNull()
  })

  it('allows disabling official NAKS date compatibility in save checks', () => {
    const activeStamp = stampRecord('ABC1', false, 'РАД')
    const row = {
      [officialStampField]: 'ABC1',
      weldingMethod: 'РАД',
      d1: '11',
      d2: '11',
      weldDate: '15.01.2027',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp])).toContain('сроку действия')
    expect(
      getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp], {
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialNaksDate: false,
        },
      }),
    ).toBeNull()
  })

  it('allows disabling official diameter compatibility in save checks', () => {
    const activeStamp = stampRecord('ABC1', false, 'РАД')
    const row = {
      [officialStampField]: 'ABC1',
      weldingMethod: 'РАД',
      d1: '1500',
      d2: '1500',
      weldDate: '15.07.2026',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp])).toContain('диаметр')
    expect(
      getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp], {
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialDiameter: false,
        },
      }),
    ).toBeNull()
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

  it('blocks official stamps without the selected material group', () => {
    const allowedStamp = withPermitGroups(stampRecord('AAAA', false, 'РАД'), 'M01')
    const blockedStamp = withPermitGroups(stampRecord('BBBB', false, 'РАД'), 'M02')
    const row = {
      stamp1K: 'AAAA',
      stamp1Z: 'BBBB',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      weldDate: '15.07.2026',
    } as WeldInput

    const blockReason = getOfficialStampCompatibilitySaveBlockReason(row, [allowedStamp, blockedStamp])

    expect(blockReason).toContain('Заполнение_1')
    expect(blockReason).toContain('группу материалов M01')
  })

  it('ignores archived permits when the weld date does not fit the archived permit', () => {
    const stamp = stampRecord('AAAA', false, 'РАД')
    stamp.naksPermits = stamp.naksPermits.map((permit) => ({ ...permit, archived: true }))
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      weldDate: '15.01.2027',
    } as WeldInput

    const blockReason = getOfficialStampCompatibilitySaveBlockReason(row, [stamp])

    expect(blockReason).toContain('Корень_1')
    expect(blockReason).toContain('РАД')
  })

  it('uses archived NAKS permits for historical weld dates inside the permit validity', () => {
    const stamp = stampRecord('AAAA', false, 'РАД')
    stamp.naksPermits = stamp.naksPermits.map((permit) => ({ ...permit, archived: true }))
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      weldDate: '15.07.2026',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [stamp])).toBeNull()
  })

  it('uses an archived NAKS permit for a second welding method when the weld date fits', () => {
    const stamp = stampRecord('ABC1', false, 'РАД')
    stamp.naksPermits = [
      {
        ...stamp.naksPermits[0],
        id: 'naks-rad',
        weldType: 'РАД',
        archived: false,
      },
      {
        ...stamp.naksPermits[0],
        id: 'naks-rd-archived',
        weldType: 'РД',
        validFrom: '2026-07-01',
        validTo: '2026-07-20',
        archived: true,
      },
    ]
    const row = {
      stamp1K: 'ABC1',
      weldingMethod: 'РД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      weldDate: '20.07.2026',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [stamp])).toBeNull()
  })

  it('shows an archived NAKS as a soft date warning instead of blocking save when weld date is empty', () => {
    const stamp = stampRecord('ABC1', false, 'РАД')
    stamp.naksPermits = [
      {
        ...stamp.naksPermits[0],
        id: 'naks-rd-archived',
        weldType: 'РД',
        validFrom: '2026-07-01',
        validTo: '2026-07-20',
        archived: true,
      },
    ]
    const row = {
      stamp1K: 'ABC1',
      weldingMethod: 'РД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      weldDate: '',
    } as WeldInput

    const options = buildWeldFormStampSelectOptions([stamp], row)
    const selectedOption = options.stamp1K?.find((option) => option.value === 'ABC1')

    expect(selectedOption?.disabled).toBe(false)
    expect(selectedOption?.reason).toContain('укажите дату сварки')
    expect(getOfficialStampCompatibilitySaveBlockReason(row, [stamp])).toBeNull()
  })

  it('shows a soft date warning for a combined method when one method is covered by an archived NAKS', () => {
    const stamp = stampRecord('ABC1', false, 'РАД')
    stamp.naksPermits = [
      {
        ...stamp.naksPermits[0],
        id: 'naks-rad',
        weldType: 'РАД',
        archived: false,
      },
      {
        ...stamp.naksPermits[0],
        id: 'naks-rd-archived',
        weldType: 'РД',
        validFrom: '2026-07-01',
        validTo: '2026-07-20',
        archived: true,
      },
    ]
    const row = {
      stamp1K: 'ABC1',
      weldingMethod: 'РАД+РД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      weldDate: '',
    } as WeldInput

    const options = buildWeldFormStampSelectOptions([stamp], row)
    const selectedOption = options.stamp1K?.find((option) => option.value === 'ABC1')

    expect(selectedOption?.disabled).toBe(false)
    expect(selectedOption?.reason).toContain('укажите дату сварки')
    expect(getOfficialStampCompatibilitySaveBlockReason(row, [stamp])).toBeNull()
  })

  it('checks NAKS dates by permit instead of the legacy summary dates on the stamp card', () => {
    const stamp = stampRecord('ABC1', false, 'РАД')
    stamp.validFrom = '01.01.2026'
    stamp.validTo = '10.07.2026'
    stamp.naksPermits = [
      {
        ...stamp.naksPermits[0],
        id: 'naks-rd-archived',
        weldType: 'РД',
        validFrom: '2026-07-01',
        validTo: '2026-07-20',
        archived: true,
      },
    ]
    const row = {
      stamp1K: 'ABC1',
      weldingMethod: 'РД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      weldDate: '20.07.2026',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [stamp])).toBeNull()
  })

  it('allows disabling official material group compatibility in save checks', () => {
    const blockedStamp = withPermitGroups(stampRecord('BBBB', false, 'РАД'), 'M02')
    const row = {
      stamp1K: 'BBBB',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      weldDate: '15.07.2026',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [blockedStamp])).toContain('группу материалов M01')
    expect(
      getOfficialStampCompatibilitySaveBlockReason(row, [blockedStamp], {
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialMaterialGroup: false,
        },
      }),
    ).toBeNull()
  })

  it('keeps material group compatibility strict even when welders cover combined methods as a team', () => {
    const rootStamp = withPermitGroups(stampRecord('AAAA', false, 'РАД'), 'M01')
    const fillStamp = withPermitGroups(stampRecord('BBBB', false, 'РД'), 'M02')
    const row = {
      stamp1K: 'AAAA',
      stamp1Z: 'BBBB',
      stamp1O: 'BBBB',
      weldingMethod: 'РАД+РД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      weldDate: '15.07.2026',
    } as WeldInput

    const blockReason = getOfficialStampCompatibilitySaveBlockReason(row, [rootStamp, fillStamp])

    expect(blockReason).toContain('Заполнение_1')
    expect(blockReason).toContain('группу материалов M01')
  })

  it('blocks official stamps when both joint thicknesses do not fit NAKS', () => {
    const activeStamp = {
      ...stampRecord('AAAA', false, 'РАД'),
      naksPermits: stampRecord('AAAA', false, 'РАД').naksPermits.map((permit) => ({ ...permit, thicknessFrom: '2', thicknessTo: '8' })),
    }
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      t1: '6',
      t2: '10',
      weldDate: '15.07.2026',
    } as WeldInput

    const blockReason = getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp])

    expect(blockReason).toContain('толщину')
    expect(blockReason).toContain('10')
  })

  it('allows disabling official thickness compatibility in save checks', () => {
    const activeStamp = {
      ...stampRecord('AAAA', false, 'РАД'),
      naksPermits: stampRecord('AAAA', false, 'РАД').naksPermits.map((permit) => ({ ...permit, thicknessFrom: '2', thicknessTo: '8' })),
    }
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      t1: '6',
      t2: '10',
      weldDate: '15.07.2026',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp])).toContain('толщину')
    expect(
      getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp], {
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialThickness: false,
        },
      }),
    ).toBeNull()
  })

  it('requires a matching DLS when DLS checking is enabled', () => {
    saveOtherSettings({
      includeArchivedWelderStampsInForm: false,
      requireDlsForOfficialStamps: true,
      wdiCalculationMode: 'manual',
      wdiTable: null,
    })
    const activeStamp = {
      ...stampRecord('AAAA', false, 'РАД'),
      dlsPermits: [
        {
          id: 'dls-1',
          number: 'ДЛС-1',
          weldType: 'РАД',
          materialGroups: 'M01',
          diameterFrom: '1',
          diameterTo: '1000',
          thicknessFrom: '1',
          thicknessTo: '8',
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
          note: '',
        },
      ],
    }
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      t1: '6',
      t2: '10',
      weldDate: '15.07.2026',
    } as WeldInput

    const blockReason = getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp])

    expect(blockReason).toContain('ДЛС')
    expect(blockReason).toContain('толщину')
    expect(blockReason).toContain('10')
  })

  it('allows disabling required DLS compatibility in save checks', () => {
    const activeStamp = {
      ...stampRecord('AAAA', false, 'РАД'),
      dlsPermits: [
        {
          id: 'dls-1',
          number: 'ДЛС-1',
          weldType: 'РАД',
          materialGroups: 'M01',
          diameterFrom: '1',
          diameterTo: '1000',
          thicknessFrom: '1',
          thicknessTo: '8',
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
          note: '',
        },
      ],
    }
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      t1: '6',
      t2: '10',
      weldDate: '15.07.2026',
    } as WeldInput

    expect(
      getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp], {
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialDls: true,
        },
      }),
    ).toContain('ДЛС')
    expect(
      getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp], {
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialDls: false,
        },
      }),
    ).toBeNull()
  })

  it('does not check DLS material group when material group save check is disabled', () => {
    const activeStamp = {
      ...stampRecord('AAAA', false, 'РАД'),
      dlsPermits: [
        {
          id: 'dls-1',
          number: 'ДЛС-1',
          weldType: 'РАД',
          materialGroups: 'M02',
          diameterFrom: '1',
          diameterTo: '1000',
          thicknessFrom: '1',
          thicknessTo: '1000',
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
          note: '',
        },
      ],
    }
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      t1: '6',
      t2: '10',
      weldDate: '15.07.2026',
    } as WeldInput

    expect(
      getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp], {
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialDls: true,
        },
      }),
    ).toContain('группу материалов M01')
    expect(
      getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp], {
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialDls: true,
          officialMaterialGroup: false,
        },
      }),
    ).toBeNull()
  })

  it('does not use archived DLS permits when the weld date does not fit the archived permit', () => {
    const activeStamp = {
      ...stampRecord('AAAA', false, 'РАД'),
      dlsPermits: [
        {
          id: 'dls-1',
          number: 'ДЛС-1',
          weldType: 'РАД',
          materialGroups: 'M01',
          diameterFrom: '1',
          diameterTo: '1000',
          thicknessFrom: '1',
          thicknessTo: '1000',
          validFrom: '2026-01-01',
          validTo: '2026-08-01',
          note: '',
          archived: true,
        },
      ],
    }
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      t1: '6',
      t2: '10',
      weldDate: '15.09.2026',
    } as WeldInput

    const blockReason = getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp], {
      saveCheckSettings: {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        officialDls: true,
      },
    })

    expect(blockReason).toContain('ДЛС')
  })

  it('uses archived DLS permits for historical weld dates inside the permit validity', () => {
    const activeStamp = {
      ...stampRecord('AAAA', false, 'РАД'),
      dlsPermits: [
        {
          id: 'dls-1',
          number: 'ДЛС-1',
          weldType: 'РАД',
          materialGroups: 'M01',
          diameterFrom: '1',
          diameterTo: '1000',
          thicknessFrom: '1',
          thicknessTo: '1000',
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
          note: '',
          archived: true,
        },
      ],
    }
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      t1: '6',
      t2: '10',
      weldDate: '15.07.2026',
    } as WeldInput

    expect(
      getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp], {
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialDls: true,
        },
      }),
    ).toBeNull()
  })

  it('shows an archived DLS as a soft date warning instead of blocking save when weld date is empty', () => {
    const activeStamp = {
      ...stampRecord('AAAA', false, 'РАД'),
      dlsPermits: [
        {
          id: 'dls-1',
          number: 'ДЛС-1',
          weldType: 'РАД',
          materialGroups: 'M01',
          diameterFrom: '1',
          diameterTo: '1000',
          thicknessFrom: '1',
          thicknessTo: '1000',
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
          note: '',
          archived: true,
        },
      ],
    }
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      t1: '6',
      t2: '10',
      weldDate: '',
    } as WeldInput

    const options = buildWeldFormStampSelectOptions([activeStamp], row, [], [], {
      saveCheckSettings: {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        officialDls: true,
      },
    })
    const selectedOption = options.stamp1K?.find((option) => option.value === 'AAAA')

    expect(selectedOption?.disabled).toBe(false)
    expect(selectedOption?.reason).toContain('укажите дату сварки')
    expect(
      getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp], {
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialDls: true,
        },
      }),
    ).toBeNull()
  })
})

function withPermitGroups(record: WelderStampRecord, materialGroups: string): WelderStampRecord {
  return {
    ...record,
    materialGroups,
    naksPermits: record.naksPermits.map((permit) => ({ ...permit, materialGroups })),
  }
}
