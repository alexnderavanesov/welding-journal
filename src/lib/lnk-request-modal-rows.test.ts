import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { countLnkRequestTargets, filterLnkRequestRows } from '@/lib/lnk-request-modal-rows'

const rows = [
  { id: 1, projectTitle: 'Риформинг', subtitleCode: '7328-ТКМ5', line: '330-ATM-10', spool: 'S01', joint: 'F12' },
  { id: 2, projectTitle: 'Гидроочистка', subtitleCode: '400', line: '330-CWR-01', spool: 'S02', joint: 'F19' },
] as WeldRow[]

describe('filterLnkRequestRows', () => {
  it('searches request rows by project and subtitle code', () => {
    expect(filterLnkRequestRows(rows, 'риформ').map((row) => row.id)).toEqual([1])
    expect(filterLnkRequestRows(rows, 'ткм5').map((row) => row.id)).toEqual([1])
  })

  it('filters a large source before calculating availability and sorting matches', () => {
    const nonMatchingRows = Array.from({ length: 5_000 }, (_, index) => ({
      id: index + 10,
      projectTitle: 'Другой проект',
      line: `L${index}`,
      get hasVik() {
        throw new Error('availability must not be calculated for rows rejected by search')
      },
    })) as WeldRow[]
    const matchingRow = {
      id: 3,
      projectTitle: 'Нужный проект',
      line: 'L3',
      hasVik: 'да',
      vikRequest: '',
    } as WeldRow

    expect(filterLnkRequestRows([...nonMatchingRows, matchingRow], 'нужный').map((row) => row.id)).toEqual([3])
  })

  it('allows selecting an early request independently of the permissive result mode', () => {
    const staged = {
      id: 3,
      projectTitle: 'Проект',
      line: 'L3',
      joint: 'F3',
      pstoRequired: 'да',
      hasVik: 'да',
    } as WeldRow

    expect(filterLnkRequestRows([staged], 'f3')).toEqual([staged])
    expect(countLnkRequestTargets([staged], ['vikRequest'])).toBe(1)
    expect(countLnkRequestTargets([staged], ['vikRequest'], {
      preHeatTreatmentLnkEnabled: true,
      allowPrimaryLnkBeforePreviousStagesComplete: true,
    })).toBe(1)
  })
})
