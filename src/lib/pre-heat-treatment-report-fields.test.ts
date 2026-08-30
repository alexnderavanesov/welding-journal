import { describe, expect, it } from 'vitest'
import { getPreHeatTreatmentReportValue } from '@/lib/pre-heat-treatment-report-fields'
import type { WeldInput } from '@/lib/weld-fields'

describe('pre-heat-treatment report values', () => {
  it('shows unfinished methods as no longer needed after a rejected pre-TO result', () => {
    const row = {
      id: 1,
      pstoRequired: 'да',
      hasRk: 'да',
      hasPvk: 'да',
      preHeatTreatmentControls: [
        {
          id: 1,
          weldJointId: 1,
          method: 'РК',
          requestName: 'Заявка до ТО',
          result: 'вырез',
        },
        {
          id: 2,
          weldJointId: 1,
          method: 'ПВК',
          requestName: 'Заявка до ТО',
          result: 'ожидает НК',
        },
      ],
    } as unknown as WeldInput

    expect(getPreHeatTreatmentReportValue(row, 'preRkResult')).toBe('вырез')
    expect(getPreHeatTreatmentReportValue(row, 'prePvkRequest')).toBe('Заявка до ТО')
    expect(getPreHeatTreatmentReportValue(row, 'prePvkResult')).toBe('нет потребности')
  })
})
