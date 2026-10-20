import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DISPATCHER_SETTINGS,
  DISPATCHER_SETTING_CODES,
} from '@/lib/dispatcher-settings'
import { SAVE_CHECK_SETTING_CODES } from '@/lib/save-check-settings'
import {
  SAVE_CHECK_DISPATCHER_LINKS,
  getDispatcherSettingIdsForSaveCheck,
  getSaveCheckSettingIdsForDispatcher,
} from '@/lib/save-check-dispatcher-links'

describe('save check and dispatcher links', () => {
  it('adds the technology-card reminder without restoring obsolete guards', () => {
    expect(Object.keys(DEFAULT_DISPATCHER_SETTINGS)).toHaveLength(28)
    expect(DISPATCHER_SETTING_CODES['check-technology-card']).toBe('ДЗ-06')
    expect(Object.values(DISPATCHER_SETTING_CODES)).not.toContain('ДЗ-16')
    expect(Object.values(DISPATCHER_SETTING_CODES)).not.toContain('ДЗ-17')
    expect(Object.values(DISPATCHER_SETTING_CODES)).not.toEqual(expect.arrayContaining(['ДЗ-24', 'ДЗ-25', 'ДЗ-26']))
  })

  it('removes the ZV-20/DZ-17 pair without replacing other links', () => {
    expect(SAVE_CHECK_DISPATCHER_LINKS.map(([saveCheckId]) => saveCheckId)).not.toContain('lnkResultRepairRules')
    expect(SAVE_CHECK_DISPATCHER_LINKS.map(([, dispatcherId]) => dispatcherId)).not.toContain('check-repair-diameter')
  })

  it('maps official stamp protections to DЗ-18 in both directions', () => {
    expect(getDispatcherSettingIdsForSaveCheck('officialDls')).toEqual(['check-welder-stamp'])
    expect(getSaveCheckSettingIdsForDispatcher('check-welder-stamp')).toEqual([
      'officialRegistry',
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
      'lnkResultControlDateFormat',
      'lnkResultDateAfterWeldDate',
      'lnkResultRequestDateOrder',
    ])
    expect(getSaveCheckSettingIdsForDispatcher('check-psto-request-date-order')).toEqual([
      'pstoResultDateFormat',
      'pstoResultDateAfterWeldDate',
      'pstoResultRequestDateOrder',
    ])
    expect(getSaveCheckSettingIdsForDispatcher('check-joint-core-data')).toEqual([
      'requiredMaterialGroupWithWeldDate',
      'requiredConnectionTypeWithWeldDate',
      'requiredWeldingMethodWithWeldDate',
      'dateFormat',
      'weldDateNotFuture',
    ])
    expect(getSaveCheckSettingIdsForDispatcher('check-control-history')).toEqual([
      'controlHistoryProtection',
    ])
  })

  it('links mandatory date formats to their stored-data audits but not operation-only rename checks', () => {
    expect(getDispatcherSettingIdsForSaveCheck('dateFormat')).toEqual(['check-joint-core-data'])
    expect(getDispatcherSettingIdsForSaveCheck('lnkResultControlDateFormat')).toEqual(['check-lnk-request-date-order'])
    expect(getDispatcherSettingIdsForSaveCheck('pstoResultDateFormat')).toEqual(['check-psto-request-date-order'])
    expect(getDispatcherSettingIdsForSaveCheck('systemJointRenameProtection')).toEqual([])
  })

  it('contains no duplicate pairs', () => {
    const keys = SAVE_CHECK_DISPATCHER_LINKS.map(([saveCheckId, dispatcherId]) => `${saveCheckId}:${dispatcherId}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('links every stored-data save check and leaves result completeness independent of dispatcher diagnostics', () => {
    const unlinked = Object.keys(SAVE_CHECK_SETTING_CODES)
      .filter((id) => getDispatcherSettingIdsForSaveCheck(id as keyof typeof SAVE_CHECK_SETTING_CODES).length === 0)

    expect(unlinked).toEqual(['officialArchive', 'lnkResultControlDateRequired', 'lnkResultConclusionRequired', 'pstoResultDateRequired', 'pstoResultDiagramRequired', 'manualJointName', 'systemJointRenameProtection'])
  })
})
