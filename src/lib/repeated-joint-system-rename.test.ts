import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  isAuthorizedSystemRepeatedJointRename,
  toCanonicalSystemJointName,
} from '@/lib/repeated-joint-system-rename'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'

const baseRow = {
  projectTitle: 'Проект',
  subtitleCode: '400',
  line: 'LIN-1',
  weldDate: '2026-08-01',
} as const

describe('system repeated-joint rename authorization', () => {
  it('allows only the rename currently proposed by chain rules', () => {
    const rows = [
      { ...baseRow, id: 1, joint: 'F1', finalStatus: 'не годен', rkResult: 'ремонт' },
      { ...baseRow, id: 2, joint: 'F1W1', finalStatus: 'ожидает сварку' },
    ] as WeldRow[]

    expect(isAuthorizedSystemRepeatedJointRename(rows, {
      changes: [{ rowId: 2, currentJoint: 'F1W1', targetJoint: 'F1R1' }],
    }, DEFAULT_SYSTEM_INDEX_SETTINGS)).toBe(true)
    expect(isAuthorizedSystemRepeatedJointRename(rows, {
      changes: [{ rowId: 2, currentJoint: 'F1W1', targetJoint: 'F999' }],
    }, DEFAULT_SYSTEM_INDEX_SETTINGS)).toBe(false)
  })

  it('authorizes only the complete current rename plan', () => {
    const rows = [
      { ...baseRow, id: 1, joint: 'S1', finalStatus: 'не годен', rkResult: 'вырез' },
      { ...baseRow, id: 2, joint: 'S1R1', finalStatus: 'не годен', rkResult: 'ремонт' },
      { ...baseRow, id: 3, joint: 'S1R2', finalStatus: 'ожидает сварку' },
    ] as WeldRow[]
    const fullPlan = {
      changes: [
        { rowId: 2, currentJoint: 'S1R1', targetJoint: 'S1W1' },
        { rowId: 3, currentJoint: 'S1R2', targetJoint: 'S1W1R1' },
      ],
    }

    expect(isAuthorizedSystemRepeatedJointRename(
      rows,
      fullPlan,
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )).toBe(true)
    expect(isAuthorizedSystemRepeatedJointRename(rows, {
      changes: [fullPlan.changes[0]!],
    }, DEFAULT_SYSTEM_INDEX_SETTINGS)).toBe(false)
    expect(isAuthorizedSystemRepeatedJointRename(rows, {
      changes: [
        fullPlan.changes[0]!,
        { rowId: 3, currentJoint: 'S1R2', targetJoint: 'S1W1R2' },
      ],
    }, DEFAULT_SYSTEM_INDEX_SETTINGS)).toBe(false)
  })

  it('normalizes configured system letters before checking the chain', () => {
    const settings = {
      ...DEFAULT_SYSTEM_INDEX_SETTINGS,
      shopJoint: 'A',
      fieldJoint: 'B',
      repair: 'C',
      cutout: 'D',
      coil: 'E',
    }
    expect(toCanonicalSystemJointName('B7D1', settings)).toBe('F7W1')
    const rows = [
      { ...baseRow, id: 1, joint: 'B7', finalStatus: 'не годен', rkResult: 'вырез' },
      { ...baseRow, id: 2, joint: 'B7C1', finalStatus: 'не годен', rkResult: 'ремонт' },
      { ...baseRow, id: 3, joint: 'B7C2', finalStatus: 'ожидает сварку' },
    ] as WeldRow[]
    expect(isAuthorizedSystemRepeatedJointRename(rows, {
      changes: [
        { rowId: 2, currentJoint: 'B7C1', targetJoint: 'B7D1' },
        { rowId: 3, currentJoint: 'B7C2', targetJoint: 'B7D1C1' },
      ],
    }, settings)).toBe(true)
  })
})
