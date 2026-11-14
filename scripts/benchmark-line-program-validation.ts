/** CPU-only cost of the save-check pass duplicated by line-program commit.
 * Run with node --import tsx scripts/benchmark-line-program-validation.ts [contextRows] [selectedRows] [trials].
 * No database calls are permitted. This is not an HTTP/transaction latency measurement.
 */
import { performance } from 'node:perf_hooks'
import pg from 'pg'
import type { WeldJoint } from '../src/db/schema'
import type { WeldRow } from '../src/lib/dispatcher-types'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '../src/lib/control-process-settings'
import { DEFAULT_DATA_LIST_SETTINGS } from '../src/lib/data-list-settings'
import { DEFAULT_OTHER_SETTINGS } from '../src/lib/other-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '../src/lib/save-check-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '../src/lib/system-index-settings'

pg.Pool.prototype.connect = function () { throw new Error('CPU benchmark must not connect to a database') }
pg.Pool.prototype.query = function () { throw new Error('CPU benchmark must not query a database') }
const { prepareServerWeldRecords, validateServerWeldRecords } = await import('../src/server/weld-save-validation')

const positive = (input: string | undefined, fallback: number, limit: number) => {
  const value = input === undefined ? fallback : Number(input)
  if (!Number.isSafeInteger(value) || value < 1 || value > limit) throw new Error(`Expected integer 1..${limit}`)
  return value
}
const contextRows = positive(process.argv[2], 10_000, 200_000)
const selectedRows = Math.min(contextRows, positive(process.argv[3], 100, 1_000))
const trials = positive(process.argv[4], 7, 30)
const rows: WeldRow[] = Array.from({ length: contextRows }, (_, index) => ({
  id: index + 1, projectTitle: 'CPU', subtitleCode: 'S', line: 'L', joint: `F${index + 1}`,
  connectionType: 'С17', weldDate: '2026-11-01', stamp1K: 'AAAA', hasVik: 'да',
  weldingMethod: 'РД', materialGroup: 'М01', d1: 159, d2: 159, t1: 8, t2: 8,
}))
const previousRows = new Map(rows.slice(0, selectedRows).map(row => [row.id, row as unknown as WeldJoint]))
const context = {
  controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS, saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS,
  dataListSettings: DEFAULT_DATA_LIST_SETTINGS, otherSettings: DEFAULT_OTHER_SETTINGS,
  systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS, welderStamps: [], welderStampSuspensions: [],
  pstoLineAssignments: new Map(), programRules: { rows, approved: new Set<string>() },
}
const samples = new Map<number, { elapsedMs: number; cpuMs: number }[]>([[1, []], [2, []]])
let finalState = ''
function run(passes: number) {
  const records = [...previousRows.values()].map(row => ({ ...row, hasUzk: 'да' }))
  const cpuStart = process.cpuUsage(), start = performance.now()
  for (let index = 0; index < passes; index++) {
    prepareServerWeldRecords({ records, previousRows, context })
    validateServerWeldRecords({ records, previousRows, context })
  }
  const elapsedMs = performance.now() - start, cpu = process.cpuUsage(cpuStart)
  const currentState = JSON.stringify(records)
  if (finalState && finalState !== currentState) throw new Error('One and two validation passes changed the final records differently')
  finalState = currentState
  return { elapsedMs, cpuMs: (cpu.user + cpu.system) / 1_000 }
}
run(1); run(2)
for (let trial = 0; trial < trials; trial++) {
  for (const passes of trial % 2 ? [2, 1] : [1, 2]) samples.get(passes)!.push(run(passes))
}
const median = (values: number[]) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]
console.log(JSON.stringify({ measurement: 'prepare + validate only, no database', contextRows, selectedRows, trials,
  identicalFinalRecords: true, samples: [...samples].map(([passes, values]) => ({ passes,
    medianElapsedMs: median(values.map(value => value.elapsedMs)), medianCpuMs: median(values.map(value => value.cpuMs)), values })) }, null, 2))
