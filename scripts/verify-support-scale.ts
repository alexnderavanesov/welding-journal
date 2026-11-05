import assert from 'node:assert/strict'
import { cpus, totalmem } from 'node:os'
import { performance } from 'node:perf_hooks'
import type { WeldRow } from '../src/lib/dispatcher-types'
import { calculateLineProgram } from '../src/lib/line-program-calculation'
import { getProgramRemovalHints } from '../src/lib/line-program-excess'
import { buildLineProgramDisplay } from '../src/lib/line-program-display'
import { buildSupportStatistics } from '../src/lib/support-statistics'

// No database access: bounded physical-chain calculation profile for T-21.
// Each 1000-record line has 800 supports, 100 repairs and 100 ordinary joints.
const measurements: Record<string, unknown>[] = []
for (const size of [20_000, 200_000]) {
  const rows: WeldRow[] = [], lines: WeldRow[][] = []
  for (let line = 0; line < size / 1000; line++) {
    const group: WeldRow[] = []; lines.push(group)
    for (let n = 1; n <= 1000; n++) {
      const repair = n > 800 && n <= 900, ordinary = n > 900, base = repair ? n - 800 : n
      const id = line * 1000 + n, root = line * 1000 + base
      const row: WeldRow = { id, projectTitle: 'Support scale', subtitleCode: 'T21', line: `L${line}`, joint: ordinary ? `F${n}` : `ОП${base}${repair ? 'R1' : ''}`,
        connectionType: ordinary ? 'С17' : 'Т1', weldDate: repair ? '2026-10-02' : '2026-09-01', weldLength: '600.123456789123456789',
        officiality: 'действующий', revisionActuality: 'актуальная', stamp1K: repair ? 'REPAIR' : `W${base % 10}`,
        category: 'II', groupName: 'A', weldControlPercent: 10, pvkControlPercent: 10,
        hasVik: 'да', vikResult: !repair && base <= 100 ? 'ремонт' : 'годен',
        hasUzk: base % 2 === 0 ? 'да' : null, hasPvk: base % 4 === 0 ? 'да' : null,
        programChainState: { weldJointId: id, kind: repair ? 'repair' : 'primary', physicalRootId: root,
          sourceRowId: repair ? root : null, coilParentId: null, coilSide: null, replacedByCoil: false },
      }
      group.push(row); rows.push(row)
    }
  }
  const start = performance.now()
  let physical = 0, required = 0, removable = 0
  for (const line of lines) {
    const groups = calculateLineProgram(line, 10, 10, undefined, undefined, true)
    assert.equal(groups.length, 10)
    assert(!groups.some(group => group.stamp === 'REPAIR'))
    physical += groups.reduce((sum, group) => sum + group.rowIds.length, 0)
    required += groups.reduce((sum, group) => sum + group.common.required, 0)
    assert(groups.every(group => group.common.additionalRequired === 0 && !group.fullControlRequired))
    const hints = getProgramRemovalHints(1, line, groups, new Set())
    removable += hints.size
    const display = buildLineProgramDisplay(line, groups, 10, 10, hints, true)
    assert(display)
  }
  assert.equal(physical, size * .8); assert.equal(required, size * .08)
  const calculationMs = Math.round(performance.now() - start)
  const statisticsStart = performance.now()
  const statistics = buildSupportStatistics(rows, '2026-09-01', '2026-10-31')
  assert.equal(statistics.physical, size * .8)
  assert.equal(statistics.produced, size * .8)
  assert.equal(statistics.rejected, 0)
  assert.equal(statistics.repairs, size * .1)
  assert.equal(statistics.missingLength, 0)
  assert.equal(statistics.months.find(month => month.month === '2026-10')?.physical, size * .1)
  // Decimal expected values are computed independently using the known fixture scale.
  const exact = (n: number) => {
    const value = (600123456789123456789n * BigInt(n)).toString().padStart(19, '0')
    return `${value.slice(0, -18)}.${value.slice(-18)}`.replace(/\.?0+$/, '')
  }
  assert.equal(statistics.lengthMm, exact(size * .8))
  assert.equal(statistics.repairLengthMm, exact(size * .1))
  const result = { rows: size, physical, repairs: statistics.repairs, required, removable,
    calculationMs, statisticsMs: Math.round(performance.now() - statisticsStart), rssMiB: Math.round(process.memoryUsage().rss / 1048576) }
  measurements.push(result); console.log(JSON.stringify(result))
}
console.log(JSON.stringify({ cpu: cpus()[0]?.model, logicalCpus: cpus().length, systemMemoryGiB: Math.round(totalmem() / 1073741824), measurements }))
