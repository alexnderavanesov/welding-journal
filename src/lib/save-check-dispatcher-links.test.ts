import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DISPATCHER_SETTINGS,
  DISPATCHER_SETTING_CODES,
} from '@/lib/dispatcher-settings'
import {
  SAVE_CHECK_DISPATCHER_LINKS,
  getDispatcherSettingIdsForSaveCheck,
  getSaveCheckSettingIdsForDispatcher,
} from '@/lib/save-check-dispatcher-links'

describe('save check and dispatcher links', () => {
  it('keeps 33 current dispatcher settings and reserves the removed DЗ-16 code', () => {
    expect(Object.keys(DEFAULT_DISPATCHER_SETTINGS)).toHaveLength(33)
    expect(Object.values(DISPATCHER_SETTING_CODES)).not.toContain('ДЗ-16')
  })

  it('maps official stamp protections to DЗ-18 in both directions', () => {
    expect(getDispatcherSettingIdsForSaveCheck('officialDls')).toEqual(['check-welder-stamp'])
    expect(getSaveCheckSettingIdsForDispatcher('check-welder-stamp')).toEqual([
      'officialRegistry',
      'officialArchive',
      'officialNaksDate',
      'officialSuspension',
      'officialWeldingMethod',
      'officialMaterialGroup',
      'officialDiameter',
      'officialThickness',
      'officialDls',
    ])
  })

  it('maps regrouped chronology and data-quality checks exactly', () => {
    expect(getSaveCheckSettingIdsForDispatcher('check-lnk-request-date-order')).toEqual([
      'lnkResultDateAfterWeldDate',
      'lnkResultRequestDateOrder',
    ])
    expect(getSaveCheckSettingIdsForDispatcher('check-psto-request-date-order')).toEqual([
      'pstoResultDateAfterWeldDate',
      'pstoResultRequestDateOrder',
    ])
    expect(getSaveCheckSettingIdsForDispatcher('check-joint-core-data')).toEqual([
      'requiredMaterialGroupWithWeldDate',
      'requiredConnectionTypeWithWeldDate',
      'requiredWeldingMethodWithWeldDate',
      'weldDateNotFuture',
      'manualJointName',
    ])
    expect(getSaveCheckSettingIdsForDispatcher('check-lnk-result-completeness')).toEqual([
      'lnkResultControlDateRequired',
      'lnkResultConclusionRequired',
    ])
    expect(getSaveCheckSettingIdsForDispatcher('check-psto-result-completeness')).toEqual([
      'pstoResultDateRequired',
      'pstoResultDiagramRequired',
    ])
    expect(getSaveCheckSettingIdsForDispatcher('check-control-history')).toEqual([
      'controlHistoryProtection',
    ])
  })

  it('does not invent dispatcher counterparts for format-only and rename-operation checks', () => {
    expect(getDispatcherSettingIdsForSaveCheck('dateFormat')).toEqual([])
    expect(getDispatcherSettingIdsForSaveCheck('lnkResultControlDateFormat')).toEqual([])
    expect(getDispatcherSettingIdsForSaveCheck('pstoResultDateFormat')).toEqual([])
    expect(getDispatcherSettingIdsForSaveCheck('systemJointRenameProtection')).toEqual([])
  })

  it('contains no duplicate pairs', () => {
    const keys = SAVE_CHECK_DISPATCHER_LINKS.map(([saveCheckId, dispatcherId]) => `${saveCheckId}:${dispatcherId}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
