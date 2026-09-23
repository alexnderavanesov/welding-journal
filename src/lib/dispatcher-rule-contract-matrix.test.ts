import { describe, expect, it } from 'vitest'

import {
  CONTROL_HISTORY_REASON,
  JOINT_CORE_DATA_REASON,
  LNK_RESULT_COMPLETENESS_REASON,
  PSTO_RESULT_COMPLETENESS_REASON,
} from '@/lib/dispatcher-check-reasons'
import {
  DEFAULT_DISPATCHER_SETTINGS,
  DISPATCHER_SETTING_CODES,
  getDispatcherTaskCode,
  getDispatcherTaskSettingId,
  isDispatcherTaskEnabled,
  type DispatcherSettingId,
} from '@/lib/dispatcher-settings'
import {
  buildDispatcherTaskCodeIndexRows,
  buildMergedDispatcherTaskCodes,
} from '@/lib/dispatcher-task-row-codes'
import type { DispatcherTask, WeldRow } from '@/lib/dispatcher-types'
import {
  LNK_REQUEST_DATE_ORDER_REASON,
  LNK_VIK_DATE_ORDER_REASON,
  LNK_VIK_REQUIRED_REASON,
} from '@/lib/lnk-chronology-checks'
import { PSTO_REQUEST_DATE_ORDER_REASON } from '@/lib/psto-chronology-checks'
import {
  REPAIR_FORBIDDEN_BY_DIAMETER_REASON,
  UNOFFICIAL_REJECTED_WITH_COIL_REASON,
} from '@/lib/report-config'

type DispatcherRuleContract = {
  settingId: DispatcherSettingId
  task: DispatcherTask
  expectedRowIds: number[]
  storage: 'row-index' | 'reminder-only'
}

const rows = [
  row(1, { joint: 'F1' }),
  row(2, { joint: 'F2' }),
  row(3, { line: 'L2', joint: 'F3' }),
]

const contracts: DispatcherRuleContract[] = [
  percentageContract('percentage-new-welder', 'new-welder'),
  percentageContract('percentage-excess', 'excess'),
  percentageContract('percentage-rejected-primary', 'rejected-primary'),
  percentageContract('percentage-missing', 'missing'),
  percentageContract('percentage-full-control', 'missing', true),
  percentageContract('percentage-suspend-welder', 'suspend-welder'),
  rowContract('repeated-create', createTask(false), [1]),
  rowContract('repeated-create-official-from-unofficial', createTask(true), [1]),
  rowContract('repeated-coil', simpleTask('coil'), [1]),
  rowContract('repeated-delete', deleteTask(), [2]),
  rowContract('repeated-rename', renameTask(), [2, 3]),
  rowContract('repeated-obsolete-check', checkTask('повторный стык содержит данные'), [1]),
  rowContract('chain-consistency', checkTask(UNOFFICIAL_REJECTED_WITH_COIL_REASON), [1]),
  rowContract('chain-duplicate', duplicateTask(), [1]),
  rowContract('chain-date-order', checkTask('проверить даты сварки'), [1]),
  rowContract('check-repair-diameter', checkTask(REPAIR_FORBIDDEN_BY_DIAMETER_REASON), [1]),
  rowContract('check-welder-stamp', checkTask('проверить клеймо'), [1]),
  rowContract('check-incomplete-stamps', checkTask('дозаполнить клейма_1'), [1]),
  rowContract('check-lnk-request-date-order', checkTask(LNK_REQUEST_DATE_ORDER_REASON), [1]),
  rowContract('check-lnk-vik-date-order', checkTask(LNK_VIK_DATE_ORDER_REASON), [1]),
  rowContract('check-lnk-vik-required', checkTask(LNK_VIK_REQUIRED_REASON), [1]),
  rowContract('check-psto-request-date-order', checkTask(PSTO_REQUEST_DATE_ORDER_REASON), [1]),
  lineContract('line-percent', 'weldControlPercent'),
  lineContract('line-group', 'groupName'),
  lineContract('line-category', 'category'),
  lineContract('line-control-presence', 'controlPresence'),
  reminderContract('welder-stamp-expiry', 'naks'),
  reminderContract('welder-dls-expiry', 'dls'),
  lineContract('line-psto-presence', 'pstoPresence'),
  rowContract('check-joint-core-data', checkTask(JOINT_CORE_DATA_REASON), [1]),
  rowContract('check-lnk-result-completeness', checkTask(LNK_RESULT_COMPLETENESS_REASON), [1]),
  rowContract('check-psto-result-completeness', checkTask(PSTO_RESULT_COMPLETENESS_REASON), [1]),
  rowContract('check-control-history', checkTask(CONTROL_HISTORY_REASON), [1]),
]

describe('dispatcher rule contract matrix', () => {
  it('requires one contract for every active DZ setting and no stale contract', () => {
    const contractIds = contracts.map((contract) => contract.settingId).sort()
    const settingIds = Object.keys(DISPATCHER_SETTING_CODES).sort()

    expect(contractIds).toHaveLength(new Set(contractIds).size)
    expect(contractIds).toEqual(settingIds)
  })

  it.each(contracts)('$settingId keeps rule -> code -> setting behavior aligned', ({ settingId, task }) => {
    expect(getDispatcherTaskSettingId(task)).toBe(settingId)
    expect(getDispatcherTaskCode(task)).toBe(DISPATCHER_SETTING_CODES[settingId])
    expect(isDispatcherTaskEnabled(task, DEFAULT_DISPATCHER_SETTINGS)).toBe(true)
    expect(isDispatcherTaskEnabled(task, {
      ...DEFAULT_DISPATCHER_SETTINGS,
      [settingId]: false,
    })).toBe(false)
  })

  it.each(contracts.filter((contract) => contract.storage === 'row-index'))(
    '$settingId persists its code and exposes it through dispatcherTasks',
    ({ settingId, task, expectedRowIds }) => {
      const code = DISPATCHER_SETTING_CODES[settingId]
      const persistedRows = buildDispatcherTaskCodeIndexRows([task], rows)

      expect(persistedRows.map((entry) => entry.rowId)).toEqual(expectedRowIds)
      expect(persistedRows.every((entry) => entry.code === code)).toBe(true)
      expect(persistedRows.every((entry) => entry.taskKey === `code:${code}`)).toBe(true)

      const { activeByRowId, allByRowId } = buildMergedDispatcherTaskCodes(persistedRows, [])
      for (const rowId of expectedRowIds) {
        expect(activeByRowId.get(rowId)?.split(', ')).toContain(code)
        expect(allByRowId.get(rowId)?.split(', ')).toContain(code)
      }

      const cleared = buildMergedDispatcherTaskCodes(
        buildDispatcherTaskCodeIndexRows([], rows),
        [],
      )
      for (const rowId of expectedRowIds) {
        expect(cleared.activeByRowId.has(rowId)).toBe(false)
        expect(cleared.allByRowId.has(rowId)).toBe(false)
      }
    },
  )

  it.each(contracts.filter((contract) => contract.storage === 'reminder-only'))(
    '$settingId remains a reminder and never leaks into the persisted row field',
    ({ task }) => {
      expect(buildDispatcherTaskCodeIndexRows([task], rows)).toEqual([])
    },
  )
})

function row(id: number, partial: Partial<WeldRow> = {}): WeldRow {
  return {
    id,
    projectTitle: 'P1',
    subtitleCode: 'S1',
    line: 'L1',
    joint: `F${id}`,
    ...partial,
  }
}

function rowContract(
  settingId: DispatcherSettingId,
  task: DispatcherTask,
  expectedRowIds: number[],
): DispatcherRuleContract {
  return { settingId, task, expectedRowIds, storage: 'row-index' }
}

function percentageContract(
  settingId: DispatcherSettingId,
  issue: Extract<DispatcherTask, { kind: 'percentage-line-control' }>['issue'],
  fullControlRequired = false,
): DispatcherRuleContract {
  return rowContract(settingId, {
    kind: 'percentage-line-control',
    key: `percentage:${settingId}`,
    row: rows[0],
    issue,
    projectTitle: 'P1',
    subtitleCode: 'S1',
    line: 'L1',
    stamp: 'A1',
    title: settingId,
    details: '',
    requiredControls: 1,
    coveredControls: 0,
    assignedControls: 0,
    count: 1,
    fullControlRequired,
  }, [1, 2])
}

function lineContract(
  settingId: DispatcherSettingId,
  fieldKey: Extract<DispatcherTask, { kind: 'line-consistency' }>['fieldKey'],
): DispatcherRuleContract {
  return rowContract(settingId, {
    kind: 'line-consistency',
    key: `line:${settingId}`,
    row: rows[0],
    projectTitle: 'P1',
    subtitleCode: 'S1',
    line: 'L1',
    fieldKey,
    fieldLabel: fieldKey,
    title: settingId,
    values: ['a', 'b'],
    details: '',
  }, [1, 2])
}

function createTask(unofficial: boolean): DispatcherTask {
  return {
    kind: 'create',
    key: unofficial ? 'create:unofficial' : 'create:regular',
    row: { ...rows[0], officiality: unofficial ? 'неофициальный' : 'официальный' },
    sourceJoint: 'F1',
    targetJoint: 'F1R1',
    result: 'ремонт',
    suffix: 'R',
    methodCode: 'РК',
  }
}

function simpleTask(kind: 'coil'): DispatcherTask {
  return {
    kind,
    key: kind,
    row: rows[0],
    sourceJoint: 'F1',
    targetJoints: ['F1Y1', 'F1Y2'],
    result: 'ремонт',
    methodCode: 'РК',
  }
}

function deleteTask(): DispatcherTask {
  return {
    kind: 'delete',
    key: 'delete:F2',
    row: rows[1],
    sourceRow: rows[0],
    sourceJoint: 'F1',
    targetJoint: 'F2',
    suffix: 'R',
    reason: 'лишний повторный стык',
  }
}

function renameTask(): DispatcherTask {
  return {
    kind: 'rename',
    key: 'rename:F2',
    row: rows[1],
    sourceRow: rows[0],
    sourceJoint: 'F1',
    currentJoint: 'F2',
    targetJoint: 'F1R1',
    baseJoint: 'F1',
    changes: [
      { rowId: 2, currentJoint: 'F2', targetJoint: 'F1R1' },
      { rowId: 3, currentJoint: 'F3', targetJoint: 'F1R2' },
    ],
  }
}

function checkTask(reason: string): DispatcherTask {
  return {
    kind: 'check',
    key: `check:${reason}`,
    row: rows[0],
    sourceRow: rows[0],
    sourceJoint: 'F1',
    targetJoint: 'F1',
    baseJoint: 'F1',
    suffix: 'R',
    reason,
  }
}

function duplicateTask(): DispatcherTask {
  return {
    kind: 'duplicate-check',
    key: 'duplicate:F1',
    row: rows[0],
    sourceJoint: 'F1',
    baseJoint: 'F1',
    count: 2,
  }
}

function reminderContract(
  settingId: DispatcherSettingId,
  permitKind: 'naks' | 'dls',
): DispatcherRuleContract {
  return {
    settingId,
    expectedRowIds: [],
    storage: 'reminder-only',
    task: {
      kind: 'welder-stamp-expiry',
      key: `expiry:${permitKind}`,
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
        validTo: '2026-12-31',
        naksPermits: [],
        dlsPermits: [],
        archived: false,
      },
      permitKind,
      permitNumber: permitKind === 'dls' ? 'DLS-1' : undefined,
      naksStamp: 'A1',
      validTo: '2026-12-31',
      daysLeft: 30,
      expired: false,
    },
  }
}
