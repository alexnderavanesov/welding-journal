import { describe, expect, it, vi } from 'vitest'

import {
  getEarlyCoilDecisionInvalidationReason,
  getEarlyCoilDecisionTargetSource,
  refreshEarlyCoilDecisionContextsInTransaction,
} from '@/server/early-coil-decision-guard'
import { getEarlyCoilDecisionKey } from '@/lib/early-coil-decision'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('getEarlyCoilDecisionInvalidationReason', () => {
  const previous = row({ rkResult: 'ремонт' })

  it('allows document corrections while a rejected result remains', () => {
    expect(getEarlyCoilDecisionInvalidationReason({
      ...previous,
      rkConclusion: 'Исправленное заключение',
      rkConclusionDate: '2026-09-02',
    }, previous)).toBeNull()
  })

  it('allows changing one rejected method when another rejected method remains', () => {
    expect(getEarlyCoilDecisionInvalidationReason({
      ...previous,
      rkResult: 'годен',
      pvkResult: 'вырез',
    }, previous)).toBeNull()
  })

  it('keeps the decision valid when a rejection moves from primary LNK to pre-TO LNK', () => {
    const transferred = row({
      ...previous,
      pstoRequired: 'да',
      hasRk: 'да',
      rkResult: null,
      preHeatTreatmentControls: [{
        id: 11,
        weldJointId: previous.id,
        method: 'РК',
        result: 'ремонт',
      }],
    })

    expect(getEarlyCoilDecisionInvalidationReason(transferred, previous)).toBeNull()
  })

  it('blocks removing the last rejection from pre-TO or duplicate control history', () => {
    const preHeatTreatmentSource = row({
      pstoRequired: 'да',
      hasRk: 'да',
      rkResult: null,
      preHeatTreatmentControls: [{
        id: 11,
        weldJointId: 1,
        method: 'РК',
        result: 'ремонт',
      }],
    })
    const duplicateSource = row({
      rkResult: null,
      duplicateControls: [{
        id: 12,
        weldJointId: 1,
        method: 'РК',
        result: 'вырез',
        controlDate: '',
        conclusion: '',
        conclusionDate: '',
      }],
    })

    expect(getEarlyCoilDecisionInvalidationReason(row({
      ...preHeatTreatmentSource,
      preHeatTreatmentControls: [],
    }), preHeatTreatmentSource)).toMatch(/должен оставаться хотя бы один/)
    expect(getEarlyCoilDecisionInvalidationReason(row({
      ...duplicateSource,
      duplicateControls: [],
    }), duplicateSource)).toMatch(/должен оставаться хотя бы один/)
  })

  it('blocks removing the last rejection, changing identity or making the source unofficial', () => {
    expect(getEarlyCoilDecisionInvalidationReason({ ...previous, rkResult: 'годен' }, previous))
      .toMatch(/должен оставаться хотя бы один/)
    expect(getEarlyCoilDecisionInvalidationReason({ ...previous, line: 'Другая линия' }, previous))
      .toMatch(/нельзя изменить/)
    expect(getEarlyCoilDecisionInvalidationReason({ ...previous, officiality: 'неофициальный' }, previous))
      .toMatch(/официальным/)
  })

  it('allows only a server-authorized line move while preserving the accepted decision', () => {
    expect(getEarlyCoilDecisionInvalidationReason(
      { ...previous, line: 'Другая линия' },
      previous,
      { allowLineMove: true },
    )).toBeNull()
    expect(getEarlyCoilDecisionInvalidationReason(
      { ...previous, projectTitle: 'Другой проект', line: 'Другая линия' },
      previous,
      { allowLineMove: true },
    )).toMatch(/нельзя изменить/)
    expect(getEarlyCoilDecisionInvalidationReason(
      { ...previous, line: 'Другая линия', rkResult: 'годен' },
      previous,
      { allowLineMove: true },
    )).toMatch(/должен оставаться хотя бы один/)
  })

  it('allows only a server-authorized R/W rename while preserving the accepted decision', () => {
    expect(getEarlyCoilDecisionInvalidationReason(
      { ...previous, joint: 'S1W1' },
      previous,
      { allowJointRename: true },
    )).toBeNull()
    expect(getEarlyCoilDecisionInvalidationReason(
      { ...previous, joint: 'S1W1', line: 'Другая линия' },
      previous,
      { allowJointRename: true },
    )).toMatch(/нельзя изменить/)
    expect(getEarlyCoilDecisionInvalidationReason(
      { ...previous, joint: 'S1W1', rkResult: 'годен' },
      previous,
      { allowJointRename: true },
    )).toMatch(/должен оставаться хотя бы один/)
  })

  it('recognizes only the Y1/Y2 rows created from the exact accepted branch and scope', () => {
    const source = row({ id: 10, joint: 'S1Y1R1', rkResult: 'ремонт' })
    const decisions = [{ source, settings: DEFAULT_SYSTEM_INDEX_SETTINGS }]

    expect(getEarlyCoilDecisionTargetSource(
      row({ id: 11, joint: 'S1Y1', rkResult: null }),
      decisions,
    )).toBeNull()
    expect(getEarlyCoilDecisionTargetSource(
      row({ id: 12, joint: 'S1Y1Y1', rkResult: null }),
      decisions,
    )?.id).toBe(source.id)
    expect(getEarlyCoilDecisionTargetSource(
      row({ id: 13, joint: 'S1Y1Y2', line: 'Другая линия', rkResult: null }),
      decisions,
    )).toBeNull()
  })

  it('refreshes several accepted-decision contexts with one batched write', async () => {
    const rows = [
      row({ id: 10, joint: 'S10R1', rkResult: 'ремонт' }),
      row({ id: 20, joint: 'S20R1', rkResult: 'ремонт' }),
      row({ id: 30, joint: 'S30R1', rkResult: 'ремонт' }),
    ]
    const where = vi.fn().mockResolvedValue(
      rows.map((source) => ({ key: getEarlyCoilDecisionKey(source.id) })),
    )
    const from = vi.fn().mockReturnValue({ where })
    const select = vi.fn().mockReturnValue({ from })
    const execute = vi.fn().mockResolvedValue(undefined)

    await refreshEarlyCoilDecisionContextsInTransaction(
      { select, execute } as never,
      rows,
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )

    expect(select).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('refreshes production-sized accepted-decision selections with one read and one write', async () => {
    const rows = Array.from({ length: 2_001 }, (_, index) => row({
      id: index + 1,
      joint: `S${index + 1}R1`,
      rkResult: 'ремонт',
    }))
    const where = vi.fn(async () => (
      rows.map((source) => ({ key: getEarlyCoilDecisionKey(source.id) }))
    ))
    const from = vi.fn().mockReturnValue({ where })
    const select = vi.fn().mockReturnValue({ from })
    const execute = vi.fn().mockResolvedValue(undefined)

    await refreshEarlyCoilDecisionContextsInTransaction(
      { select, execute } as never,
      rows,
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )

    expect(select).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

function row(values: Partial<WeldRow>): WeldRow {
  return {
    id: 1,
    projectTitle: 'Проект',
    subtitleCode: 'Шифр',
    line: 'Линия',
    joint: 'S1R1',
    weldDate: '2026-09-01',
    ...values,
  } as WeldRow
}
