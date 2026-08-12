import { describe, expect, it } from 'vitest'

import type { WeldJoint } from '@/db/schema'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import type { WeldInput } from '@/lib/weld-fields'
import {
  mergeWeldRecordsWithPrevious,
  prepareServerWeldRecords,
  validateServerWeldRecords,
  type ServerWeldValidationContext,
} from '@/server/weld-save-validation'

const context: ServerWeldValidationContext = {
  saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS,
  dataListSettings: DEFAULT_DATA_LIST_SETTINGS,
  otherSettings: DEFAULT_OTHER_SETTINGS,
  systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
  welderStamps: [],
  welderStampSuspensions: [],
}

describe('validateServerWeldRecords', () => {
  it('blocks a saved weld date without a material group and allows disabling ZВ-29', () => {
    const record = {
      joint: 'F1',
      weldDate: '2026-07-01',
      materialGroup: '',
      connectionType: 'С17',
      weldingMethod: 'РД',
    } as WeldInput
    const contextWithoutRootCheck = {
      ...context,
      dataListSettings: {
        ...DEFAULT_DATA_LIST_SETTINGS,
        connectionTypes: ['С17'],
        weldingTypes: ['РД'],
      },
      saveCheckSettings: {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        requiredRootStampWithWeldDate: false,
        requiredConnectionTypeWithWeldDate: false,
      },
    }

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context: contextWithoutRootCheck,
    })).toThrow('ЗВ-29')

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context: {
        ...contextWithoutRootCheck,
        saveCheckSettings: {
          ...contextWithoutRootCheck.saveCheckSettings,
          requiredMaterialGroupWithWeldDate: false,
        },
      },
    })).not.toThrow()
  })

  it('blocks a saved weld date without a connection type and allows disabling ZВ-30', () => {
    const record = {
      joint: 'F1',
      weldDate: '2026-07-01',
      materialGroup: 'М01',
      connectionType: '',
      weldingMethod: 'РД',
    } as WeldInput
    const contextWithoutRootCheck = {
      ...context,
      dataListSettings: {
        ...DEFAULT_DATA_LIST_SETTINGS,
        materialGroups: ['М01'],
      },
      saveCheckSettings: {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        requiredRootStampWithWeldDate: false,
      },
    }

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context: contextWithoutRootCheck,
    })).toThrow('ЗВ-30')

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context: {
        ...contextWithoutRootCheck,
        saveCheckSettings: {
          ...contextWithoutRootCheck.saveCheckSettings,
          requiredConnectionTypeWithWeldDate: false,
        },
      },
    })).not.toThrow()
  })

  it('validates required weld fields after a partial update is merged with the stored row', () => {
    const previous = {
      id: 9,
      projectTitle: 'Проект',
      subtitleCode: 'Шифр',
      line: 'Линия',
      joint: 'F9',
      weldDate: null,
      materialGroup: null,
      connectionType: null,
      weldingMethod: null,
    } as WeldJoint
    const [record] = mergeWeldRecordsWithPrevious(
      [{ id: previous.id, weldDate: '2026-07-01' }],
      new Map([[previous.id, previous]]),
    )

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context: {
        ...context,
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          requiredRootStampWithWeldDate: false,
        },
      },
      importMode: true,
    })).toThrow('ЗВ-29')

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context: {
        ...context,
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          requiredRootStampWithWeldDate: false,
          requiredMaterialGroupWithWeldDate: false,
        },
      },
      importMode: true,
    })).toThrow('ЗВ-30')

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context: {
        ...context,
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          requiredRootStampWithWeldDate: false,
          requiredMaterialGroupWithWeldDate: false,
          requiredConnectionTypeWithWeldDate: false,
        },
      },
      importMode: true,
    })).toThrow('ЗВ-31')
  })

  it('blocks a saved weld date without a welding method and allows disabling ZВ-31', () => {
    const record = {
      joint: 'F1',
      weldDate: '2026-07-01',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: '',
    } as WeldInput
    const validationContext = {
      ...context,
      dataListSettings: {
        ...DEFAULT_DATA_LIST_SETTINGS,
        connectionTypes: ['С17'],
        materialGroups: ['М01'],
      },
      saveCheckSettings: {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        requiredRootStampWithWeldDate: false,
      },
    }

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context: validationContext,
    })).toThrow('ЗВ-31')

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context: {
        ...validationContext,
        saveCheckSettings: {
          ...validationContext.saveCheckSettings,
          requiredWeldingMethodWithWeldDate: false,
        },
      },
    })).not.toThrow()
  })

  it('keeps an existing indexed base valid after the setting is disabled', () => {
    const previous = { id: 7, joint: 'FB01', responsible: '' } as WeldJoint
    const record = { ...previous, responsible: 'Иванов' } as unknown as WeldInput

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context,
    })).not.toThrow()
  })

  it('blocks a new indexed base until the project setting is enabled', () => {
    const record = { joint: 'FB01' } as WeldInput

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context,
    })).toThrow('ЗВ-26')

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context: {
        ...context,
        systemIndexSettings: {
          ...DEFAULT_SYSTEM_INDEX_SETTINGS,
          allowLeadingLetterIndex: true,
        },
      },
    })).not.toThrow()
  })

  it('blocks an old malformed joint name on the next edit', () => {
    const previous = { id: 8, joint: 'F1R', responsible: '' } as WeldJoint
    const record = { ...previous, responsible: 'Петров' } as unknown as WeldInput

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context,
    })).toThrow('ЗВ-26')
  })

  it('allows a validated system descendant of an indexed base', () => {
    expect(() => validateServerWeldRecords({
      records: [{ joint: 'FB01R1' }],
      previousRows: new Map(),
      context,
      allowSystemJointNames: true,
    })).not.toThrow()
  })

  it('rejects empty identity fields in import mode', () => {
    expect(() => validateServerWeldRecords({
      records: [{ projectTitle: 'Проект', subtitleCode: '', line: 'Линия', joint: 'F1' }],
      previousRows: new Map(),
      context,
      importMode: true,
    })).toThrow('обязательные поля не могут быть пустыми: Шифр')
  })

  it('merges a partial update with the stored row without clearing omitted fields', () => {
    const previous = {
      id: 5,
      projectTitle: 'Риформинг',
      subtitleCode: '400',
      line: 'LIN-001',
      joint: 'F5',
    } as WeldJoint

    expect(mergeWeldRecordsWithPrevious(
      [{ id: 5, responsible: 'Иванов' }],
      new Map([[5, previous]]),
    )).toEqual([
      expect.objectContaining({
        id: 5,
        projectTitle: 'Риформинг',
        subtitleCode: '400',
        line: 'LIN-001',
        joint: 'F5',
        responsible: 'Иванов',
      }),
    ])
  })

  it('recalculates system WDI when only the connection type changes', () => {
    const previous = {
      id: 6,
      joint: 'F6',
      connectionType: 'С17',
      d1: 57,
      d2: 108,
      wdi: 4.25,
    } as WeldJoint
    const record = {
      ...previous,
      connectionType: 'У17',
    } as unknown as WeldInput

    prepareServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context: {
        ...context,
        otherSettings: {
          ...DEFAULT_OTHER_SETTINGS,
          wdiCalculationMode: 'formula',
        },
      },
    })

    expect(record.wdi).toBe(2.24)
  })

  it('checks VIK chronology when only another NDT result is changed', () => {
    const previous = {
      id: 19,
      joint: 'F19',
      weldDate: '2026-07-01',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: 'РД',
      stamp1K: 'АВС1',
      hasRk: 'да',
      rkResult: null,
    } as WeldJoint
    const record = {
      ...previous,
      rkResult: 'годен',
      rkConclusionDate: '2026-07-03',
    } as unknown as WeldInput

    expect(() =>
      validateServerWeldRecords({
        records: [record],
        previousRows: new Map([[previous.id, previous]]),
        context,
      }),
    ).toThrow('ЗВ-18')
  })

  it('uses remotely configured welding methods for server-side stamp validation', () => {
    const customContext: ServerWeldValidationContext = {
      ...context,
      dataListSettings: {
        ...DEFAULT_DATA_LIST_SETTINGS,
        connectionTypes: ['С17'],
        materialGroups: ['М01'],
        weldingTypes: ['МАД'],
      },
      welderStamps: [{
        id: 1,
        naksStamp: 'АВС1',
        welderName: 'Иванов Иван',
        internalStamp: '',
        weldType: 'МАД',
        materialGroups: 'М01',
        diameterFrom: '',
        diameterTo: '',
        thicknessFrom: '',
        thicknessTo: '',
        validFrom: '',
        validTo: '',
        naksPermits: [{
          id: 'naks-custom',
          weldType: 'МАД',
          materialGroups: 'М01',
          diameterFrom: '1',
          diameterTo: '100',
          thicknessFrom: '1',
          thicknessTo: '10',
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
          note: '',
        }],
        dlsPermits: [],
        archived: false,
        archivedAt: '',
      }],
    }
    const record = {
      joint: 'S1',
      weldDate: '2026-07-15',
      weldingMethod: 'МАД',
      connectionType: 'С17',
      materialGroup: 'М01',
      d1: 57,
      d2: 57,
      t1: 3,
      t2: 3,
      stamp1K: 'АВС1',
    } as WeldInput

    expect(() =>
      validateServerWeldRecords({
        records: [record],
        previousRows: new Map(),
        context: customContext,
      }),
    ).not.toThrow()
  })

  it('blocks a result-only change that introduces a forbidden small-diameter repair', () => {
    const previous = {
      id: 17,
      joint: 'S17',
      d1: 55,
      d2: 57,
      hasVik: 'да',
      vikResult: 'годен',
      hasRk: 'да',
      rkResult: 'годен',
    } as WeldJoint
    const record = {
      ...previous,
      rkResult: 'ремонт',
    } as unknown as WeldInput

    expect(() =>
      validateServerWeldRecords({
        records: [record],
        previousRows: new Map([[previous.id, previous]]),
        context,
      }),
    ).toThrow('ЗВ-20')
  })

  it('blocks an unrelated edit when an old repair is forbidden by diameter', () => {
    const previous = {
      id: 18,
      joint: 'S18',
      d1: 55,
      d2: 57,
      hasRk: 'да',
      rkResult: 'ремонт',
      responsible: '',
    } as WeldJoint
    const record = {
      ...previous,
      responsible: 'Иванов',
    } as unknown as WeldInput

    expect(() =>
      validateServerWeldRecords({
        records: [record],
        previousRows: new Map([[previous.id, previous]]),
        context,
      }),
    ).toThrow('ЗВ-20')
  })
})
