import { beforeEach, describe, expect, it } from 'vitest'
import { saveDataListSettings } from './data-list-settings'
import { saveOtherSettings } from './other-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from './save-check-settings'
import { FACTUAL_WELDER_STAMP_FIELD_KEYS, OFFICIAL_WELDER_STAMP_FIELD_KEYS } from './report-config'
import type { WeldInput } from './weld-fields'
import {
  buildWeldFormStampSelectOptions,
  getArchivedOfficialStampValuesForRecord,
  getOfficialStampCompatibilityIssues,
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
    testTypes: ['ГИ', 'ПИ'],
  })
  saveOtherSettings({
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
    expect(getOfficialStampCompatibilitySaveBlockReason(row, [archivedStamp, activeStamp])).toContain('находится в архиве')
  })

  it('allows a historical weld before the whole stamp card archive date', () => {
    const archivedStamp = {
      ...stampRecord('ABC1', true),
      archivedAt: '2026-08-01',
    }
    const row = {
      [officialStampField]: 'ABC1',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      t1: '6',
      t2: '6',
      weldDate: '31.07.2026',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [archivedStamp])).toBeNull()
  })

  it('blocks a weld after the whole stamp card archive date', () => {
    const archivedStamp = {
      ...stampRecord('ABC1', true),
      archivedAt: '2026-08-01',
    }
    const row = {
      [officialStampField]: 'ABC1',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      t1: '6',
      t2: '6',
      weldDate: '02.08.2026',
    } as WeldInput

    const reason = getOfficialStampCompatibilitySaveBlockReason(row, [archivedStamp])

    expect(reason).toContain('ЗВ-02')
    expect(reason).toContain('архиве с 01.08.2026')
  })

  it('keeps permit errors visible in dispatcher audit after the whole stamp card is archived', () => {
    const archivedStamp = {
      ...withPermitGroups(stampRecord('ABC1', true), 'M02'),
      archivedAt: '2026-08-01',
    }
    const row = {
      [officialStampField]: 'ABC1',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      t1: '6',
      t2: '6',
      weldDate: '31.07.2026',
    } as WeldInput

    const issues = getOfficialStampCompatibilityIssues(row, [archivedStamp], {
      archiveValidationMode: 'audit',
    })

    expect(issues.some((issue) => issue.reason === 'archived')).toBe(false)
    expect(issues.some((issue) => issue.reason === 'material-group')).toBe(true)
  })

  it('audits legacy archived cards without inventing an archive-date error', () => {
    const archivedStamp = withPermitGroups(stampRecord('ABC1', true), 'M02')
    const row = {
      [officialStampField]: 'ABC1',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      t1: '6',
      t2: '6',
      weldDate: '31.07.2026',
    } as WeldInput

    const issues = getOfficialStampCompatibilityIssues(row, [archivedStamp], {
      archiveValidationMode: 'audit',
    })

    expect(issues.some((issue) => issue.reason === 'archived')).toBe(false)
    expect(issues.some((issue) => issue.reason === 'material-group')).toBe(true)
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

  it('keeps the archive check active when only the registry check is disabled', () => {
    const archivedStamp = stampRecord('ABC1', true)
    const row = {
      [officialStampField]: 'ABC1',
      weldingMethod: 'РАД',
      d1: '11',
      d2: '11',
    } as WeldInput

    const reason = getOfficialStampCompatibilitySaveBlockReason(row, [archivedStamp], {
      saveCheckSettings: {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        officialRegistry: false,
        officialArchive: true,
      },
    })

    expect(reason).toContain('ЗВ-02')
    expect(reason).toContain('находится в архиве')
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

  it('reports only the joint diameter that is not covered by NAKS', () => {
    const activeStamp = stampRecord('ABC1', false, 'РАД')
    const row = {
      [officialStampField]: 'ABC1',
      weldingMethod: 'РАД',
      d1: '1500',
      d2: '57',
      weldDate: '15.07.2026',
    } as WeldInput

    const blockReason = getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp])

    expect(blockReason).toContain('диаметр 1500.')
    expect(blockReason).not.toContain('диаметр 1500, 57')
  })

  it('checks the greatest diameter and thickness for a non-angular connection', () => {
    const activeStamp = stampRecord('ABC1', false, 'РАД')
    activeStamp.naksPermits = activeStamp.naksPermits.map((permit) => ({
      ...permit,
      diameterFrom: '100',
      diameterTo: '150',
      thicknessFrom: '10',
      thicknessTo: '15',
    }))
    const row = {
      [officialStampField]: 'ABC1',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      connectionType: 'С18',
      d1: '99',
      d2: '105',
      t1: '10',
      t2: '12',
      weldDate: '15.07.2026',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp])).toBeNull()
  })

  it('selects the greatest diameter and thickness independently for a non-angular connection', () => {
    const activeStamp = stampRecord('ABC1', false, 'РАД')
    activeStamp.naksPermits = activeStamp.naksPermits.map((permit) => ({
      ...permit,
      diameterFrom: '100',
      diameterTo: '150',
      thicknessFrom: '30',
      thicknessTo: '40',
    }))
    const row = {
      [officialStampField]: 'ABC1',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      connectionType: 'С17',
      d1: '105',
      d2: '57',
      t1: '3',
      t2: '35',
      weldDate: '15.07.2026',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp])).toBeNull()
  })

  it('shows archived official stamps automatically for a historical weld date', () => {
    const archivedStamp = {
      ...stampRecord('ARCH1', true),
      archivedAt: '2026-08-01',
      internalStamp: 'I-ARCH',
    }
    const activeStamp = stampRecord('ACTIVE1', false)
    const row = {
      weldingMethod: 'РАД',
      weldDate: '15.07.2026',
    } as WeldInput

    const options = buildWeldFormStampSelectOptions([archivedStamp, activeStamp], row)

    expect(options[officialStampField]?.some((option) => option.value === 'ARCH1')).toBe(true)
    expect(options[officialStampField]?.find((option) => option.value === 'ARCH1')?.disabled).toBe(false)
    expect(options[factualStampField]?.some((option) => option.value === 'ARCH1')).toBe(false)
  })

  it('hides archived stamps without a historical weld date', () => {
    const archivedStamp = {
      ...stampRecord('ARCH1', true),
      archivedAt: '2026-08-01',
    }

    const withoutDate = buildWeldFormStampSelectOptions([archivedStamp], { weldingMethod: 'РАД' } as WeldInput)
    const afterArchive = buildWeldFormStampSelectOptions(
      [archivedStamp],
      { weldingMethod: 'РАД', weldDate: '05.08.2026' } as WeldInput,
    )

    expect(withoutDate[officialStampField]?.some((option) => option.value === 'ARCH1')).toBe(false)
    expect(afterArchive[officialStampField]?.some((option) => option.value === 'ARCH1')).toBe(false)
  })

  it('keeps a selected archived stamp visible and blocked after the weld date moves past its archive date', () => {
    const archivedStamp = {
      ...stampRecord('ARCH1', true),
      archivedAt: '2026-08-01',
    }
    const row = {
      [officialStampField]: 'ARCH1',
      weldingMethod: 'РАД',
      weldDate: '05.08.2026',
    } as WeldInput

    const options = buildWeldFormStampSelectOptions([archivedStamp], row)

    expect(options[officialStampField]?.find((option) => option.value === 'ARCH1')).toMatchObject({
      value: 'ARCH1',
      disabled: true,
    })
    expect(getOfficialStampCompatibilitySaveBlockReason(row, [archivedStamp])).toContain('ЗВ-02')
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

  it('checks only the smaller material D and paired T for an angular connection', () => {
    const stamp = stampRecord('AAAA', false, 'РАД')
    stamp.naksPermits = stamp.naksPermits.map((permit) => ({
      ...permit,
      diameterFrom: '20',
      diameterTo: '30',
      thicknessFrom: '2',
      thicknessTo: '4',
    }))
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      connectionType: 'У17',
      d1: '530',
      t1: '30',
      d2: '25',
      t2: '3',
      weldDate: '15.07.2026',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [stamp])).toBeNull()
    expect(
      getOfficialStampCompatibilitySaveBlockReason({ ...row, connectionType: 'С17' }, [stamp]),
    ).toContain('диаметр 530.')
  })

  it('does not detach the thickness from the smaller material of an angular connection', () => {
    const stamp = stampRecord('AAAA', false, 'РАД')
    stamp.naksPermits = stamp.naksPermits.map((permit) => ({
      ...permit,
      diameterFrom: '20',
      diameterTo: '30',
      thicknessFrom: '2',
      thicknessTo: '4',
    }))
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      connectionType: 'У17',
      d1: '530',
      t1: '3',
      d2: '25',
      t2: '30',
      weldDate: '15.07.2026',
    } as WeldInput

    const blockReason = getOfficialStampCompatibilitySaveBlockReason(row, [stamp])

    expect(blockReason).toContain('толщину 30')
  })

  it('checks both thicknesses when angular connection diameters are equal', () => {
    const stamp = stampRecord('AAAA', false, 'РАД')
    stamp.naksPermits = stamp.naksPermits.map((permit) => ({
      ...permit,
      diameterFrom: '20',
      diameterTo: '30',
      thicknessFrom: '2',
      thicknessTo: '4',
    }))
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      connectionType: 'У17',
      d1: '25',
      t1: '3',
      d2: '25',
      t2: '30',
      weldDate: '15.07.2026',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [stamp])).toContain('толщину 30.')
  })

  it('applies the smaller angular material rule to DLS checks', () => {
    const stamp = stampRecord('AAAA', false, 'РАД')
    stamp.dlsPermits = [
      {
        id: 'dls-small-branch',
        number: 'ДЛС-1',
        weldType: 'РАД',
        materialGroups: 'M01',
        diameterFrom: '20',
        diameterTo: '30',
        thicknessFrom: '2',
        thicknessTo: '4',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        note: '',
      },
    ]
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      connectionType: 'У17',
      d1: '530',
      t1: '30',
      d2: '25',
      t2: '3',
      weldDate: '15.07.2026',
    } as WeldInput
    const saveCheckSettings = {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      officialDls: true,
    }

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [stamp], { saveCheckSettings })).toBeNull()
    expect(
      getOfficialStampCompatibilitySaveBlockReason(
        { ...row, connectionType: 'С17' },
        [stamp],
        { saveCheckSettings },
      ),
    ).toContain('ДЛС')
  })

  it('checks a repeated official stamp as one welder', () => {
    const stamp = stampRecord('AAAA', false, 'РАД')
    const suspension = suspensionRecord('AAAA')
    const row = {
      stamp1K: 'AAAA',
      stamp1Z: 'AAAA',
      stamp1O: 'AAAA',
      weldingMethod: 'РАД',
      d1: '11',
      d2: '11',
      weldDate: '15.07.2026',
    } as WeldInput

    const issues = getOfficialStampCompatibilityIssues(row, [stamp], {
      suspensions: [suspension],
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      stamp: 'AAAA',
      reason: 'suspended',
    })
  })

  it('combines diameter and thickness ranges of different methods inside one stamp for a combined weld', () => {
    const stamp = stampRecordWithComplementaryCombinedPermits('AAAA')
    const combinedRow = {
      stamp1K: 'AAAA',
      stamp1Z: 'AAAA',
      weldingMethod: 'РАД+РД',
      materialGroup: 'M01',
      d1: '57',
      d2: '57',
      t1: '3',
      t2: '3',
      weldDate: '15.07.2026',
    } as WeldInput

    const options = buildWeldFormStampSelectOptions([stamp], combinedRow)

    expect(options[officialStampField]?.find((option) => option.value === 'AAAA')?.disabled).toBe(false)
    expect(getOfficialStampCompatibilitySaveBlockReason(combinedRow, [stamp])).toBeNull()
    expect(
      getOfficialStampCompatibilitySaveBlockReason({ ...combinedRow, weldingMethod: 'РАД' }, [stamp]),
    ).toContain('диаметр')
    expect(
      getOfficialStampCompatibilitySaveBlockReason({ ...combinedRow, weldingMethod: 'РД' }, [stamp]),
    ).toContain('толщину')
  })

  it('combines NAKS and DLS ranges separately inside one stamp for a combined weld', () => {
    const stamp = stampRecordWithComplementaryCombinedPermits('AAAA', true)
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД+РД',
      materialGroup: 'M01',
      d1: '57',
      d2: '57',
      t1: '3',
      t2: '3',
      weldDate: '15.07.2026',
    } as WeldInput
    const saveCheckSettings = {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      officialDls: true,
    }

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [stamp], { saveCheckSettings })).toBeNull()
  })

  it('combines D and T independently across permits of one non-combined method and group', () => {
    const stamp = stampRecord('AAAA', false, 'РАД')
    stamp.naksPermits = [
      {
        ...stamp.naksPermits[0],
        id: 'naks-low-d-low-t',
        materialGroups: 'M01',
        diameterFrom: '1',
        diameterTo: '50',
        thicknessFrom: '1',
        thicknessTo: '5',
      },
      {
        ...stamp.naksPermits[0],
        id: 'naks-high-d-high-t',
        materialGroups: 'M01',
        diameterFrom: '50',
        diameterTo: '100',
        thicknessFrom: '5',
        thicknessTo: '10',
      },
    ]
    stamp.dlsPermits = [
      {
        id: 'dls-low-d-low-t',
        number: 'ДЛС-1',
        weldType: 'РАД',
        materialGroups: 'M01',
        diameterFrom: '1',
        diameterTo: '50',
        thicknessFrom: '1',
        thicknessTo: '5',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        note: '',
      },
      {
        id: 'dls-high-d-high-t',
        number: 'ДЛС-2',
        weldType: 'РАД',
        materialGroups: 'M01',
        diameterFrom: '50',
        diameterTo: '100',
        thicknessFrom: '5',
        thicknessTo: '10',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        note: '',
      },
    ]
    const saveCheckSettings = {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      officialDls: true,
    }
    const baseRow = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      weldDate: '15.07.2026',
    } as WeldInput

    expect(
      getOfficialStampCompatibilitySaveBlockReason(
        { ...baseRow, d1: '25', d2: '25', t1: '8', t2: '8' },
        [stamp],
        { saveCheckSettings },
      ),
    ).toBeNull()
    expect(
      getOfficialStampCompatibilitySaveBlockReason(
        { ...baseRow, d1: '75', d2: '75', t1: '3', t2: '3' },
        [stamp],
        { saveCheckSettings },
      ),
    ).toBeNull()
  })

  it('still blocks a combined weld when the own DLS ranges do not cover its dimensions', () => {
    const stamp = stampRecordWithComplementaryCombinedPermits('AAAA', true)
    stamp.dlsPermits = stamp.dlsPermits.map((permit) => ({
      ...permit,
      diameterFrom: '1',
      diameterTo: '50',
    }))
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД+РД',
      materialGroup: 'M01',
      d1: '57',
      d2: '57',
      t1: '3',
      t2: '3',
      weldDate: '15.07.2026',
    } as WeldInput

    const blockReason = getOfficialStampCompatibilitySaveBlockReason(row, [stamp], {
      saveCheckSettings: {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        officialDls: true,
      },
    })

    expect(blockReason).toContain('ДЛС')
    expect(blockReason).toContain('диаметр')
  })

  it('does not combine diameter and thickness ranges between different official welders', () => {
    const radStamp = stampRecord('AAAA', false, 'РАД')
    radStamp.naksPermits = radStamp.naksPermits.map((permit) => ({
      ...permit,
      materialGroups: 'M01',
      diameterFrom: '1',
      diameterTo: '50',
      thicknessFrom: '1',
      thicknessTo: '5',
    }))
    const rdStamp = stampRecord('BBBB', false, 'РД')
    rdStamp.naksPermits = rdStamp.naksPermits.map((permit) => ({
      ...permit,
      materialGroups: 'M01',
      diameterFrom: '50',
      diameterTo: '100',
      thicknessFrom: '5',
      thicknessTo: '10',
    }))
    const row = {
      stamp1K: 'AAAA',
      stamp1Z: 'BBBB',
      weldingMethod: 'РАД+РД',
      materialGroup: 'M01',
      d1: '57',
      d2: '57',
      t1: '3',
      t2: '3',
      weldDate: '15.07.2026',
    } as WeldInput

    const blockReason = getOfficialStampCompatibilitySaveBlockReason(row, [radStamp, rdStamp])

    expect(blockReason).toContain('Клеймо AAAA')
    expect(blockReason).toContain('диаметр')
  })

  it('does not combine ranges across different material groups for a combined weld', () => {
    const stamp = stampRecordWithComplementaryCombinedPermits('AAAA')
    stamp.naksPermits = stamp.naksPermits.map((permit) => (
      permit.weldType === 'РД' ? { ...permit, materialGroups: 'M02' } : permit
    ))
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД+РД',
      materialGroup: 'M01',
      d1: '57',
      d2: '57',
      t1: '3',
      t2: '3',
      weldDate: '15.07.2026',
    } as WeldInput

    const blockReason = getOfficialStampCompatibilitySaveBlockReason(row, [stamp])

    expect(blockReason).toContain('группу материалов M01')
  })

  it('does not combine a permit that is expired on the weld date', () => {
    const stamp = stampRecordWithComplementaryCombinedPermits('AAAA')
    stamp.naksPermits = stamp.naksPermits.map((permit) => (
      permit.weldType === 'РД' ? { ...permit, validTo: '2026-07-10' } : permit
    ))
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД+РД',
      materialGroup: 'M01',
      d1: '57',
      d2: '57',
      t1: '3',
      t2: '3',
      weldDate: '15.07.2026',
    } as WeldInput

    expect(getOfficialStampCompatibilitySaveBlockReason(row, [stamp])).toContain('сроку действия')
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

  it('reports only the joint thickness that is not covered by NAKS', () => {
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

    expect(blockReason).toContain('толщину 10.')
    expect(blockReason).not.toContain('толщину 6, 10')
  })

  it('reports only the greatest joint thickness for a non-angular connection', () => {
    const activeStamp = {
      ...stampRecord('AAAA', false, 'РАД'),
      naksPermits: stampRecord('AAAA', false, 'РАД').naksPermits.map((permit) => ({
        ...permit,
        thicknessFrom: '2',
        thicknessTo: '8',
      })),
    }
    const row = {
      stamp1K: 'AAAA',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '11',
      d2: '11',
      t1: '14',
      t2: '10',
      weldDate: '15.07.2026',
    } as WeldInput

    const blockReason = getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp])

    expect(blockReason).toContain('толщину 14.')
    expect(blockReason).not.toContain('толщину 14, 10.')
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
    expect(blockReason).toContain('толщину 10.')
    expect(blockReason).not.toContain('толщину 6, 10')
  })

  it('combines matching NAKS and DLS ranges of the same official stamp', () => {
    const activeStamp = {
      ...stampRecord('E0SM', false, 'РАД'),
      naksPermits: [
        {
          id: 'naks-large',
          weldType: 'РАД',
          materialGroups: 'M01',
          diameterFrom: '28.5',
          diameterTo: '',
          thicknessFrom: '3',
          thicknessTo: '12',
          validFrom: '2026-01-01',
          validTo: '2028-12-31',
          note: '',
        },
        {
          id: 'naks-small',
          weldType: 'РАД',
          materialGroups: 'M01',
          diameterFrom: '18',
          diameterTo: '36',
          thicknessFrom: '3',
          thicknessTo: '6',
          validFrom: '2026-01-01',
          validTo: '2028-12-31',
          note: '',
        },
      ],
      dlsPermits: [
        {
          id: 'dls-large',
          number: 'ДЛС-1',
          weldType: 'РАД',
          materialGroups: 'M01',
          diameterFrom: '28.5',
          diameterTo: '',
          thicknessFrom: '3',
          thicknessTo: '12',
          validFrom: '2026-06-12',
          validTo: '2026-09-12',
          note: '',
        },
        {
          id: 'dls-small',
          number: 'ДЛС-2',
          weldType: 'РАД',
          materialGroups: 'M01',
          diameterFrom: '18',
          diameterTo: '36',
          thicknessFrom: '3',
          thicknessTo: '6',
          validFrom: '2026-06-12',
          validTo: '2026-09-12',
          note: '',
        },
      ],
    }
    const row = {
      stamp1K: 'E0SM',
      weldingMethod: 'РАД',
      materialGroup: 'M01',
      d1: '108',
      d2: '22',
      t1: '8',
      t2: '5',
      weldDate: '20.07.2026',
    } as WeldInput
    const saveCheckSettings = {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      officialDls: true,
    }

    const options = buildWeldFormStampSelectOptions([activeStamp], row, [], [], { saveCheckSettings })
    const selectedOption = options.stamp1K?.find((option) => option.value === 'E0SM')

    expect(selectedOption?.disabled).toBe(false)
    expect(getOfficialStampCompatibilitySaveBlockReason(row, [activeStamp], { saveCheckSettings })).toBeNull()
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

function stampRecordWithComplementaryCombinedPermits(value: string, includeDls = false): WelderStampRecord {
  const record = stampRecord(value, false, 'РАД')
  const permits = [
    {
      ...record.naksPermits[0],
      id: `${value}-rad`,
      weldType: 'РАД',
      materialGroups: 'M01',
      diameterFrom: '1',
      diameterTo: '50',
      thicknessFrom: '1',
      thicknessTo: '5',
    },
    {
      ...record.naksPermits[0],
      id: `${value}-rd`,
      weldType: 'РД',
      materialGroups: 'M01',
      diameterFrom: '50',
      diameterTo: '100',
      thicknessFrom: '5',
      thicknessTo: '10',
    },
  ]
  return {
    ...record,
    weldType: 'РАД, РД',
    materialGroups: 'M01',
    naksPermits: permits,
    dlsPermits: includeDls
      ? permits.map((permit, index) => ({
          ...permit,
          id: `${value}-dls-${index + 1}`,
          number: `ДЛС-${index + 1}`,
        }))
      : [],
  }
}
