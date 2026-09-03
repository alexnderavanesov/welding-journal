import { describe, expect, it } from 'vitest'

import {
  getEarlyCoilDecisionInvalidationReason,
  getEarlyCoilDecisionTargetSource,
} from '@/server/early-coil-decision-guard'
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
