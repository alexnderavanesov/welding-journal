import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DISPATCHER_SETTINGS,
  DISPATCHER_SETTING_ACTION_HELP,
  DISPATCHER_SETTING_CODES,
  DISPATCHER_SETTING_GROUPS,
  DISPATCHER_SETTING_HELP,
  DISPATCHER_SETTING_TASK_TYPE_LABELS,
  getDispatcherTaskCode,
  getDispatcherTaskSettingId,
  isDispatcherTaskEnabled,
} from '@/lib/dispatcher-settings'
import type { DispatcherTask, WeldRow } from '@/lib/dispatcher-types'
import {
  LNK_REQUEST_DATE_ORDER_REASON,
  LNK_VIK_DATE_ORDER_REASON,
  LNK_VIK_REQUIRED_REASON,
} from '@/lib/lnk-chronology-checks'
import { PSTO_REQUEST_DATE_ORDER_REASON } from '@/lib/psto-chronology-checks'
import {
  REPAIR_FORBIDDEN_BY_DIAMETER_REASON,
  REPAIR_FORBIDDEN_BY_REPAIR_LIMIT_REASON,
  UNOFFICIAL_REJECTED_WITH_COIL_REASON,
} from '@/lib/report-config'
import {
  CONTROL_HISTORY_REASON,
  JOINT_CORE_DATA_REASON,
  LNK_RESULT_COMPLETENESS_REASON,
  PSTO_RESULT_COMPLETENESS_REASON,
} from '@/lib/dispatcher-check-reasons'

const row = { id: 1, joint: 'F1' } as WeldRow

describe('dispatcher settings', () => {
  it('keeps every dispatcher setting documented once with a unique code', () => {
    const settingIds = Object.keys(DEFAULT_DISPATCHER_SETTINGS).sort()
    const groupedIds = DISPATCHER_SETTING_GROUPS.flatMap((group) => group.items.map((item) => item.id))

    expect(groupedIds).toHaveLength(new Set(groupedIds).size)
    expect([...groupedIds].sort()).toEqual(settingIds)
    expect(Object.keys(DISPATCHER_SETTING_CODES).sort()).toEqual(settingIds)
    expect(Object.keys(DISPATCHER_SETTING_TASK_TYPE_LABELS).sort()).toEqual(settingIds)
    expect(Object.keys(DISPATCHER_SETTING_HELP).sort()).toEqual(settingIds)
    expect(Object.keys(DISPATCHER_SETTING_ACTION_HELP).sort()).toEqual(settingIds)
    expect(new Set(Object.values(DISPATCHER_SETTING_CODES)).size).toBe(settingIds.length)
    expect(Object.values(DISPATCHER_SETTING_CODES).sort((left, right) =>
      left.localeCompare(right, 'ru', { numeric: true }),
    )).toEqual(
      Array.from({ length: 34 }, (_, index) => index + 1)
        .filter((number) => number !== 16)
        .map((number) => `ДЗ-${String(number).padStart(2, '0')}`),
    )
  })

  it('maps every dispatcher task family to its own setting and code', () => {
    const cases: Array<[DispatcherTask, keyof typeof DEFAULT_DISPATCHER_SETTINGS]> = [
      [makePercentageTask('new-welder'), 'percentage-new-welder'],
      [makePercentageTask('excess'), 'percentage-excess'],
      [makePercentageTask('rejected-primary'), 'percentage-rejected-primary'],
      [makePercentageTask('suspend-welder'), 'percentage-suspend-welder'],
      [makePercentageTask('missing'), 'percentage-missing'],
      [{ ...makePercentageTask('missing'), fullControlRequired: true }, 'percentage-full-control'],
      [makeCreateTask(''), 'repeated-create'],
      [makeCreateTask('неофициальный'), 'repeated-create-official-from-unofficial'],
      [makeTask('coil'), 'repeated-coil'],
      [makeTask('delete'), 'repeated-delete'],
      [makeTask('rename'), 'repeated-rename'],
      [makeTask('duplicate-check'), 'chain-duplicate'],
      [makeLineTask('weldControlPercent'), 'line-percent'],
      [makeLineTask('groupName'), 'line-group'],
      [makeLineTask('category'), 'line-category'],
      [makeLineTask('controlPresence'), 'line-control-presence'],
      [makeLineTask('pstoPresence'), 'line-psto-presence'],
      [makeExpiryTask('naks'), 'welder-stamp-expiry'],
      [makeExpiryTask('dls'), 'welder-dls-expiry'],
      [makeCheckTask('проверить даты сварки'), 'chain-date-order'],
      [makeCheckTask(REPAIR_FORBIDDEN_BY_DIAMETER_REASON), 'check-repair-diameter'],
      [makeCheckTask(REPAIR_FORBIDDEN_BY_REPAIR_LIMIT_REASON), 'check-repair-diameter'],
      [makeCheckTask('проверить клеймо'), 'check-welder-stamp'],
      [makeCheckTask('дозаполнить клейма_1'), 'check-incomplete-stamps'],
      [makeCheckTask('дозаполнить клейма_2'), 'check-incomplete-stamps'],
      [makeCheckTask('дозаполнить дату сварки'), 'check-incomplete-stamps'],
      [makeCheckTask(LNK_REQUEST_DATE_ORDER_REASON), 'check-lnk-request-date-order'],
      [makeCheckTask(LNK_VIK_DATE_ORDER_REASON), 'check-lnk-vik-date-order'],
      [makeCheckTask(LNK_VIK_REQUIRED_REASON), 'check-lnk-vik-required'],
      [makeCheckTask(PSTO_REQUEST_DATE_ORDER_REASON), 'check-psto-request-date-order'],
      [makeCheckTask(JOINT_CORE_DATA_REASON), 'check-joint-core-data'],
      [makeCheckTask(LNK_RESULT_COMPLETENESS_REASON), 'check-lnk-result-completeness'],
      [makeCheckTask(PSTO_RESULT_COMPLETENESS_REASON), 'check-psto-result-completeness'],
      [makeCheckTask(CONTROL_HISTORY_REASON), 'check-control-history'],
      [makeCheckTask('повторный стык уже заварен'), 'repeated-obsolete-check'],
      [makeCheckTask('повторный стык содержит данные'), 'repeated-obsolete-check'],
      [makeCheckTask(UNOFFICIAL_REJECTED_WITH_COIL_REASON), 'chain-consistency'],
      [makeCheckTask('проверить целостность катушки'), 'chain-consistency'],
    ]

    for (const [task, settingId] of cases) {
      expect(getDispatcherTaskSettingId(task)).toBe(settingId)
      expect(getDispatcherTaskCode(task)).toBe(DISPATCHER_SETTING_CODES[settingId])
    }
  })

  it('filters a disabled percentage line task without disabling other percentage issues', () => {
    const settings = { ...DEFAULT_DISPATCHER_SETTINGS, 'percentage-excess': false }
    const excessTask = makePercentageTask('excess', 'Проверить лишний контроль процентной линии')
    const missingTask = makePercentageTask('missing', 'Назначить РК/УЗК по процентной линии')

    expect(isDispatcherTaskEnabled(excessTask, settings)).toBe(false)
    expect(isDispatcherTaskEnabled(missingTask, settings)).toBe(true)
  })

  it('distinguishes ordinary and full percentage control by data rather than title text', () => {
    const ordinaryTask = {
      ...makePercentageTask('missing', 'Назначить 100% контроль'),
      fullControlRequired: false,
    }
    const fullControlTask = {
      ...makePercentageTask('missing', 'Назначить контроль'),
      fullControlRequired: true,
    }

    expect(getDispatcherTaskSettingId(ordinaryTask)).toBe('percentage-missing')
    expect(getDispatcherTaskSettingId(fullControlTask)).toBe('percentage-full-control')
  })

  it('filters welder stamp expiry reminders separately from dispatcher tasks', () => {
    const settings = { ...DEFAULT_DISPATCHER_SETTINGS, 'welder-stamp-expiry': false }
    const task = makeExpiryTask('naks')

    expect(isDispatcherTaskEnabled(task, settings)).toBe(false)
  })

  it('filters DLS expiry reminders separately from NAKS expiry reminders', () => {
    const settings = { ...DEFAULT_DISPATCHER_SETTINGS, 'welder-dls-expiry': false }
    const naksTask = makeExpiryTask('naks')
    const dlsTask = makeExpiryTask('dls')

    expect(isDispatcherTaskEnabled(naksTask, settings)).toBe(true)
    expect(isDispatcherTaskEnabled(dlsTask, settings)).toBe(false)
  })

  it('filters official-from-unofficial create tasks separately from repeated joint create tasks', () => {
    const settings = { ...DEFAULT_DISPATCHER_SETTINGS, 'repeated-create-official-from-unofficial': false }
    const unofficialCreateTask = makeCreateTask('неофициальный')
    const regularCreateTask = makeCreateTask('')

    expect(isDispatcherTaskEnabled(unofficialCreateTask, settings)).toBe(false)
    expect(isDispatcherTaskEnabled(regularCreateTask, settings)).toBe(true)
  })
})

function makePercentageTask(
  issue: 'missing' | 'excess' | 'new-welder' | 'rejected-primary' | 'suspend-welder',
  title = '',
): Extract<DispatcherTask, { kind: 'percentage-line-control' }> {
  return {
    kind: 'percentage-line-control',
    key: `percentage-line-control:${issue}:line:a1`,
    row,
    issue,
    projectTitle: '',
    subtitleCode: '',
    line: 'L1',
    stamp: 'A1',
    title,
    details: '',
    requiredControls: 1,
    coveredControls: 0,
    assignedControls: 0,
    count: 1,
  }
}

function makeCheckTask(reason: string): DispatcherTask {
  return {
    kind: 'check',
    key: `check:${reason}`,
    row,
    sourceRow: row,
    sourceJoint: 'F1',
    targetJoint: 'F1',
    baseJoint: 'F1',
    suffix: 'R',
    reason,
  }
}

function makeLineTask(
  fieldKey: 'weldControlPercent' | 'groupName' | 'category' | 'controlPresence' | 'pstoPresence',
): DispatcherTask {
  return {
    kind: 'line-consistency',
    key: `line:${fieldKey}`,
    row,
    line: 'L1',
    projectTitle: '',
    subtitleCode: '',
    fieldKey,
    fieldLabel: '',
    title: '',
    values: [],
    details: '',
  }
}

function makeTask(kind: 'coil' | 'delete' | 'rename' | 'duplicate-check'): DispatcherTask {
  return { kind, key: kind, row } as DispatcherTask
}

function makeCreateTask(officiality: string): DispatcherTask {
  return {
    kind: 'create',
    key: `create:${officiality || 'regular'}`,
    row: { ...row, officiality },
    sourceJoint: 'F1',
    targetJoint: 'F1R1',
    result: 'ремонт',
    suffix: 'R',
    methodCode: 'РК',
  } as DispatcherTask
}

function makeExpiryTask(permitKind: 'naks' | 'dls'): DispatcherTask {
  return {
    kind: 'welder-stamp-expiry',
    key: `welder-stamp-expiry:${permitKind}:1:A1:permit:2026-07-10`,
    stamp: {
      id: 1,
      naksStamp: 'A1',
      internalStamp: '',
      welderName: '',
      weldType: '',
      materialGroups: '',
      diameterFrom: '',
      diameterTo: '',
      thicknessFrom: '',
      thicknessTo: '',
      validFrom: '',
      validTo: '2026-07-10',
      naksPermits: [],
      dlsPermits: [],
      archived: false,
    },
    permitKind,
    permitNumber: permitKind === 'dls' ? 'ДЛС-1' : undefined,
    naksStamp: 'A1',
    validTo: '2026-07-10',
    daysLeft: 0,
    expired: false,
  } as DispatcherTask
}
