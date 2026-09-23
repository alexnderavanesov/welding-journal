import { describe, expect, it } from 'vitest'
import type { WeldJoint } from '@/db/schema'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS, SAVE_CHECK_SETTING_CODES, type SaveCheckSettingId, type SaveCheckSettings } from '@/lib/save-check-settings'
import { SAVE_CHECK_DISPATCHER_LINKS } from '@/lib/save-check-dispatcher-links'
import { DEFAULT_DISPATCHER_REMINDER_SETTINGS, DEFAULT_DISPATCHER_SETTINGS, DISPATCHER_SETTING_CODES, getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import { buildVisibleDispatcherTasks } from '@/lib/dispatcher-task-builder'
import { getPstoLineIdentityKey } from '@/lib/psto-line-assignment'
import type { WeldInput } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import { validateServerWeldRecords, type ServerWeldValidationContext } from '@/server/weld-save-validation'

const base: WeldInput = {
  id: 1, joint: 'S1', projectTitle: 'P1', subtitleCode: 'C1', line: 'L1', officiality: 'действующий',
  weldDate: '2026-07-01', weldingMethod: 'РД', connectionType: 'СШ', materialGroup: 'M01',
  d1: 108, d2: 108, t1: 4, t2: 4, stamp1K: 'A1', stamp1Z: 'A1', stamp1O: 'A1',
  stamp1KFact: 'A1', stamp1ZFact: 'A1', stamp1OFact: 'A1',
}

describe('every stored-data ZV / DZ pair', () => {
  it.each(SAVE_CHECK_DISPATCHER_LINKS)('%s blocks a new violation on the server and %s finds the stored violation', (saveCheck, dispatcherSetting) => {
    const { previous, record, context } = fixture(saveCheck)
    expect(() => validateServerWeldRecords({ records: [record], previousRows: previous ? new Map([[1, previous as WeldJoint]]) : new Map(), context })).toThrow(SAVE_CHECK_SETTING_CODES[saveCheck])
    const result = buildVisibleDispatcherTasks({
      rows: [record as WeldRow], welderStamps: context.welderStamps, welderStampSuspensions: context.welderStampSuspensions,
      acceptedDispatcherWarningKeys: new Set(), dismissedRepeatedJointTaskKeys: new Set(),
      dispatcherSettings: DEFAULT_DISPATCHER_SETTINGS, dispatcherReminderSettings: DEFAULT_DISPATCHER_REMINDER_SETTINGS,
      dataListSettings: context.dataListSettings,
    })
    expect(result.repeatedJointTasks.map(getDispatcherTaskCode)).toContain(DISPATCHER_SETTING_CODES[dispatcherSetting])
  })
})

function fixture(setting: SaveCheckSettingId) {
  const settings = Object.fromEntries(Object.keys(DEFAULT_SAVE_CHECK_SETTINGS).map((id) => [id, id === setting])) as SaveCheckSettings
  let previous: WeldInput | undefined
  let record = { ...base }
  const context: ServerWeldValidationContext = {
    controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS, saveCheckSettings: settings,
    dataListSettings: { ...DEFAULT_DATA_LIST_SETTINGS, weldingTypes: ['РД'], connectionTypes: ['СШ'], materialGroups: ['M01'] },
    otherSettings: DEFAULT_OTHER_SETTINGS, systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
    welderStamps: [stamp()], welderStampSuspensions: [], pstoLineAssignments: new Map(),
  }
  if (setting.startsWith('official')) {
    const permit = context.welderStamps[0].naksPermits[0]
    if (setting === 'officialRegistry') context.welderStamps = []
    if (setting === 'officialArchive') context.welderStamps[0].archived = true
    if (setting === 'officialNaksDate') permit.validTo = '2026-06-01'
    if (setting === 'officialSuspension') context.welderStampSuspensions = [{ id: 1, naksStamp: 'A1', suspendedFrom: '2026-06-01', suspendedTo: '2026-08-01' }]
    if (setting === 'officialWeldingMethod') permit.weldType = 'РАД'
    if (setting === 'officialMaterialGroup') permit.materialGroups = 'M02'
    if (setting === 'officialDiameter') permit.diameterTo = '50'
    if (setting === 'officialThickness') permit.thicknessTo = '2'
    if (setting === 'officialDls') context.welderStamps[0].dlsPermits = [{ ...permit, id: 'dls', number: 'D1', validTo: '2026-06-01' }]
  } else if (setting.startsWith('lnkResult')) {
    previous = { ...base, hasVik: 'да', vikRequest: 'ВИК-1', vikRequestDate: '2026-07-02' }
    record = { ...previous, vikResult: 'годен', vikConclusionDate: '2026-07-03', vikConclusion: 'ВИК заключение' }
    if (setting === 'lnkResultControlDateRequired') record.vikConclusionDate = null
    if (setting === 'lnkResultControlDateFormat') record.vikConclusionDate = 'не дата'
    if (setting === 'lnkResultDateAfterWeldDate') record.vikConclusionDate = '2026-06-30'
    if (setting === 'lnkResultRequestDateOrder') record.vikConclusionDate = '2026-07-01'
    if (setting === 'lnkResultConclusionRequired') record.vikConclusion = null
    if (setting === 'lnkResultRepairRules') Object.assign(record, { vikResult: 'ремонт', d1: 57, d2: 57 })
    if (setting === 'lnkResultVikDateBeforeOther' || setting === 'lnkResultVikRequiredBeforeOther') {
      Object.assign(previous, { hasRk: 'да', rkRequest: 'РК-1', rkRequestDate: '2026-07-02' })
      record = { ...previous, rkResult: 'годен', rkConclusionDate: '2026-07-03', rkConclusion: 'РК заключение' }
      if (setting === 'lnkResultVikDateBeforeOther') Object.assign(record, { vikResult: 'годен', vikConclusionDate: '2026-07-04', vikConclusion: 'ВИК заключение' })
    }
  } else if (setting.startsWith('pstoResult')) {
    previous = { ...base, pstoRequired: 'да', pstoRequest: 'ПСТО-1', pstoRequestDate: '2026-07-02' }
    record = { ...previous, pstoResult: 'проведено', pstoDate: '2026-07-03', heatTreatmentDiagram: 'D1' }
    context.pstoLineAssignments = new Map([[getPstoLineIdentityKey(record), { rowCount: 1, assignedCount: 1 }]])
    if (setting === 'pstoResultDateRequired') record.pstoDate = null
    if (setting === 'pstoResultDateFormat') record.pstoDate = 'не дата'
    if (setting === 'pstoResultDateAfterWeldDate') record.pstoDate = '2026-06-30'
    if (setting === 'pstoResultRequestDateOrder') record.pstoDate = '2026-07-01'
    if (setting === 'pstoResultDiagramRequired') record.heatTreatmentDiagram = null
  } else {
    if (setting === 'requiredRootStampWithWeldDate') record.stamp1K = null
    if (setting === 'requiredMaterialGroupWithWeldDate') record.materialGroup = null
    if (setting === 'requiredConnectionTypeWithWeldDate') record.connectionType = null
    if (setting === 'requiredWeldingMethodWithWeldDate') record.weldingMethod = null
    if (setting === 'dateFormat') record.weldDate = 'не дата'
    if (setting === 'weldDateNotFuture') record.weldDate = '2099-01-01'
    if (setting === 'manualJointName') record.joint = 'S??'
    if (setting === 'controlHistoryProtection') {
      previous = { ...base, hasRk: 'да', rkRequest: 'РК-1', rkRequestDate: '2026-07-02', rkResult: 'годен', rkConclusionDate: '2026-07-03', rkConclusion: 'РК заключение' }
      record = { ...previous, hasRk: null }
    }
  }
  return { previous, record, context }
}

function stamp(): WelderStampRecord {
  const permit = { id: 'naks', weldType: 'РД', materialGroups: 'M01', diameterFrom: '1', diameterTo: '1000', thicknessFrom: '1', thicknessTo: '100', validFrom: '2026-01-01', validTo: '2026-12-31', note: '' }
  return { ...permit, id: 1, naksStamp: 'A1', internalStamp: '', welderName: 'Тестовый сварщик', archived: false, naksPermits: [permit], dlsPermits: [] }
}
