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
      id: 2,
      currentJoint: 'F1W1',
      targetJoint: 'F1R1',
    }, DEFAULT_SYSTEM_INDEX_SETTINGS)).toBe(true)
    expect(isAuthorizedSystemRepeatedJointRename(rows, {
      id: 2,
      currentJoint: 'F1W1',
      targetJoint: 'F999',
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
  })
})
