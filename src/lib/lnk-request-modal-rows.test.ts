import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { filterLnkRequestRows } from '@/lib/lnk-request-modal-rows'

const rows = [
  { id: 1, projectTitle: 'Риформинг', subtitleCode: '7328-ТКМ5', line: '330-ATM-10', spool: 'S01', joint: 'F12' },
  { id: 2, projectTitle: 'Гидроочистка', subtitleCode: '400', line: '330-CWR-01', spool: 'S02', joint: 'F19' },
] as WeldRow[]

describe('filterLnkRequestRows', () => {
  it('searches request rows by project and subtitle code', () => {
    expect(filterLnkRequestRows(rows, 'риформ').map((row) => row.id)).toEqual([1])
    expect(filterLnkRequestRows(rows, 'ткм5').map((row) => row.id)).toEqual([1])
  })
})
