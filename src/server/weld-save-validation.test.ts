import { describe, expect, it } from 'vitest'

import type { WeldJoint } from '@/db/schema'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import type { WeldInput } from '@/lib/weld-fields'
import { validateServerWeldRecords, type ServerWeldValidationContext } from '@/server/weld-save-validation'

const context: ServerWeldValidationContext = {
  saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS,
  dataListSettings: DEFAULT_DATA_LIST_SETTINGS,
  otherSettings: DEFAULT_OTHER_SETTINGS,
  welderStamps: [],
  welderStampSuspensions: [],
}

describe('validateServerWeldRecords', () => {
  it('uses remotely configured welding methods for server-side stamp validation', () => {
    const customContext: ServerWeldValidationContext = {
      ...context,
      dataListSettings: {
        ...DEFAULT_DATA_LIST_SETTINGS,
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
      connectionType: '',
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

  it('does not re-block an unrelated edit because of an old repair issue', () => {
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
    ).not.toThrow()
  })
})
