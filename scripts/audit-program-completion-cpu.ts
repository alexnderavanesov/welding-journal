/** Pure calculation benchmark: no database, HTTP, persisted state or production. */
import assert from 'node:assert/strict'
import { countUnfinishedProgramChains } from '../src/lib/line-program-completion'
import type { WeldRow } from '../src/lib/dispatcher-types'

let baselineVisits = 0
for (const size of [200, 200_000]) {
  let jointReads = 0
  const rows: WeldRow[] = Array.from({ length: size }, (_, i) => {
    const repair = i % 2 === 1, root = Math.floor(i / 2) + 1
    return {
      id: i + 1, projectTitle: 'CPU AUDIT', subtitleCode: 'S', line: 'ONE LARGE LINE',
      get joint() { jointReads++; return `F${root}${repair ? 'R1' : ''}` },
      weldDate: '2026-09-01', connectionType: 'С17', hasVik: 'да', vikResult: 'годен',
      hasUzk: 'да', uzkResult: repair ? 'годен' : 'ремонт',
    }
  })
  const start = performance.now()
  const unfinished = countUnfinishedProgramChains(rows, false)
  assert.equal(unfinished, 0, 'All physical connections have a good repair final')
  if (size === 200) baselineVisits = jointReads
  else assert(jointReads <= baselineVisits * (size / 200) * 1.1, 'Input hydration must not rescan the original rows quadratically')
  console.log(JSON.stringify({ joints: size, branches: size / 2, unfinished, jointReads,
    milliseconds: Math.round(performance.now() - start), scope: 'Pure completion calculation; one large line, two-row branches; no database or transport' }))
}
