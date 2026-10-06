import { expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { buildOfficialityRestorationRenames } from './lnk-officiality-restoration'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'

it.each([24, 1024, 200_000])('indexes %i context rows once instead of scanning the journal for each restored chain', count => {
  let reads = 0
  const rows: WeldRow[] = Array.from({ length: count }, (_, index) => ({ id: index + 1, projectTitle: 'P', subtitleCode: 'U', line: 'L',
    get joint() { reads++; return `S${Math.floor(index / 2) + 1}` },
    officiality: index % 2 === 0 ? 'неофициальный' : null, rkResult: index % 2 === 0 ? 'ремонт' : 'годен',
  }))
  const restored = rows.filter((_, index) => index % 2 === 0).slice(0, 1000)
  const changes = buildOfficialityRestorationRenames(rows, restored, DEFAULT_SYSTEM_INDEX_SETTINGS)
  expect(changes).toHaveLength(restored.length)
  expect(changes[0]).toEqual({ rowId: 2, currentJoint: 'S1', targetJoint: 'S1R1' })
  expect(reads).toBeLessThan(count * 15)
})
