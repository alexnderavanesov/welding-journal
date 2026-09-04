import { describe, expect, it } from 'vitest'

import {
  mergePreHeatTreatmentControlsIntoRows,
  mergePstoRepeatCyclesIntoRows,
} from '@/lib/heat-treatment-control-relations'
import { recordsToVisibleExportMatrix } from '@/lib/weld-export-utils'
import { FIELD_BY_KEY, type WeldInput } from '@/lib/weld-fields'

describe('heat-treatment control relations', () => {
  it('groups pre-heat-treatment controls by weld without changing the source rows', () => {
    const rows = [{ id: 1, joint: 'F1' }, { id: 2, joint: 'F2' }]
    const result = mergePreHeatTreatmentControlsIntoRows(rows, [
      { id: 12, weldJointId: 1, method: 'ПВК', result: 'ожидает НК' },
      { id: 11, weldJointId: 1, method: 'ВИК', requestName: 'Заявка ВИК до ТО', result: 'годен' },
      { id: 13, weldJointId: 3, method: 'РК' },
    ])

    expect(rows).toEqual([{ id: 1, joint: 'F1' }, { id: 2, joint: 'F2' }])
    expect(result[0]?.preHeatTreatmentControls.map((control) => control.method)).toEqual(['ВИК', 'ПВК'])
    expect(result[0]?.preVikRequest).toBe('Заявка ВИК до ТО')
    expect(result[0]?.preVikResult).toBe('годен')
    expect(result[0]?.prePvkResult).toBe('ожидает НК')
    expect(result[1]?.preHeatTreatmentControls).toEqual([])
    expect(result[1]?.preVikRequest).toBeUndefined()
  })

  it('sorts repeat cycles by sequence for every weld', () => {
    const result = mergePstoRepeatCyclesIntoRows([{ id: 1 }, { id: 2 }], [
      { id: 30, weldJointId: 1, sequence: 3 },
      { id: 20, weldJointId: 1, sequence: 2 },
      { id: 40, weldJointId: 2, sequence: 2 },
    ])

    expect(result[0]?.pstoRepeatCycles.map((cycle) => cycle.sequence)).toEqual([2, 3])
    expect(result[1]?.pstoRepeatCycles.map((cycle) => cycle.sequence)).toEqual([2])
  })

  it('materializes virtual pre-TO fields before Excel export', () => {
    const rows = mergePreHeatTreatmentControlsIntoRows([{ id: 1, joint: 'F1' }], [{
      id: 11,
      weldJointId: 1,
      method: 'РК',
      requestName: 'Заявка РК до ТО-001',
      requestDate: '2026-08-03',
      result: 'годен',
      conclusionDate: '2026-08-04',
      conclusionName: 'ЗНК-РК до ТО-001',
      defectDescription: '0-100: ДНО\n100-0: пора',
    }])
    const fields = ['preRkRequest', 'preRkExposureScheme', 'preRkDefectDescription']
      .map((fieldKey) => FIELD_BY_KEY.get(fieldKey as never)!)

    expect(recordsToVisibleExportMatrix(rows as unknown as WeldInput[], fields)).toEqual([
      fields.map((field) => field.label),
      ['Заявка РК до ТО-001', '0-100, 100-0', 'ДНО; пора'],
    ])
  })

  it('materializes plain VIK, UZK and PVK defect descriptions without RK parsing', () => {
    const [row] = mergePreHeatTreatmentControlsIntoRows([{ id: 1 }], [
      { id: 11, weldJointId: 1, method: 'ВИК', defectDescription: 'Пора: 12 мм' },
      { id: 12, weldJointId: 1, method: 'УЗК', defectDescription: 'Трещина; зона 2' },
      { id: 13, weldJointId: 1, method: 'ПВК', defectDescription: 'ДНО' },
    ])

    expect(row).toMatchObject({
      preVikDefectDescription: 'Пора: 12 мм',
      preUzkDefectDescription: 'Трещина; зона 2',
      prePvkDefectDescription: 'ДНО',
    })
  })
})
