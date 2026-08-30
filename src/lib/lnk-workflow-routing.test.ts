import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  canAddLnkWorkflowResult,
  canCreateLnkWorkflowRequest,
  getCommonLnkRequestStage,
  getPreferredLnkRequestStage,
  getPreferredLnkResultStage,
} from '@/lib/lnk-workflow-routing'

function makeRow(overrides: Partial<WeldRow>): WeldRow {
  return {
    id: 1,
    weldDate: '2026-08-20',
    projectTitle: 'Проект',
    subtitleCode: 'Шифр',
    line: 'Линия',
    joint: 'F1',
    ...overrides,
  } as WeldRow
}

describe('LNK workflow routing', () => {
  it('routes a PSTO joint with missing pre-control documents to the pre-TO request workflow', () => {
    const row = makeRow({ pstoRequired: 'да', hasVik: 'да' })

    expect(getPreferredLnkRequestStage(row)).toBe('beforeHeatTreatment')
    expect(canCreateLnkWorkflowRequest(row)).toBe(true)
  })

  it('routes a requested pre-control to the pre-TO result workflow', () => {
    const row = makeRow({
      pstoRequired: 'да',
      hasVik: 'да',
      preHeatTreatmentControls: [{
        id: 10,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка до ТО',
        requestDate: '2026-08-21',
        result: 'ожидает НК',
      }],
    } as Partial<WeldRow>)

    expect(getPreferredLnkResultStage(row)).toBe('beforeHeatTreatment')
    expect(canAddLnkWorkflowResult(row)).toBe(true)
  })

  it('keeps an ordinary joint in the primary workflow', () => {
    const requestRow = makeRow({ hasVik: 'да' })
    const resultRow = makeRow({
      hasVik: 'да',
      vikRequest: 'Заявка ВИК',
      vikRequestDate: '2026-08-21',
      vikResult: 'ожидает НК',
    })

    expect(getPreferredLnkRequestStage(requestRow)).toBe('primary')
    expect(getPreferredLnkResultStage(resultRow)).toBe('primary')
  })

  it('does not combine selected joints that require different document stages', () => {
    const preRow = makeRow({ id: 1, pstoRequired: 'да', hasVik: 'да' })
    const primaryRow = makeRow({ id: 2, joint: 'F2', hasVik: 'да' })

    expect(getCommonLnkRequestStage([preRow, primaryRow])).toBeNull()
  })
})
