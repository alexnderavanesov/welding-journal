import { performance } from 'node:perf_hooks'

import { sql } from 'drizzle-orm'

import { db } from '../src/db/index.ts'
import {
  preHeatTreatmentControls,
  pstoRepeatCycles,
  weldJoints,
} from '../src/db/schema.ts'
import { loadPstoLineAssignmentSummaries } from '../src/server/psto-line-assignment-summary.ts'

const DEFAULT_ROW_COUNT = 100_000
const DEFAULT_LINE_COUNT = 1_000
const MAX_ROW_COUNT = 500_000
const MAX_LINE_COUNT = 20_000
const BENCHMARK_WELD_ID_BASE = -2_000_000_000
const BENCHMARK_PRE_CONTROL_ID_BASE = -1_900_000_000
const BENCHMARK_REPEAT_CYCLE_ID_BASE = -1_800_000_000

const rowCount = readPositiveInteger(process.argv[2], DEFAULT_ROW_COUNT, MAX_ROW_COUNT)
const lineCount = Math.min(
  rowCount,
  readPositiveInteger(process.argv[3], DEFAULT_LINE_COUNT, MAX_LINE_COUNT),
)
const connectionUrl = new URL(process.env.DATABASE_URL ?? '')
if (!new Set(['localhost', '127.0.0.1', '[::1]']).has(connectionUrl.hostname)) {
  throw new Error('PSTO registry benchmark can run only against a local PostgreSQL database.')
}

const benchmarkProject = `__psto_registry_benchmark_${process.pid}_${Date.now()}`
const rollbackMarker = new Error('PSTO registry benchmark rollback')
let output: Record<string, number> | undefined

try {
  await db.transaction(async (tx) => {
    const insertStartedAt = performance.now()
    await tx.execute(sql`
      insert into ${weldJoints} (
        "id",
        "project_title",
        "subtitle_code",
        "line",
        "joint",
        "psto_required",
        "psto_request",
        "psto_result",
        "tvmt_result"
      )
      select
        ${BENCHMARK_WELD_ID_BASE} + generated.value,
        ${benchmarkProject},
        'BENCHMARK',
        'LINE-' || (((generated.value - 1) % ${lineCount}) + 1)::text,
        'J-' || generated.value::text,
        case
          when generated.value % 10 < 6 then 'да'
          when generated.value % 10 = 6 then 'отменен'
          else null
        end,
        case when generated.value % 20 = 0 then 'PSTO request' else null end,
        case when generated.value % 25 = 0 then 'проведено' else null end,
        case when generated.value % 40 = 0 then 'годен' else null end
      from generate_series(1, ${rowCount}::integer) as generated(value)
    `)
    await tx.execute(sql`
      insert into ${preHeatTreatmentControls} ("id", "weld_joint_id", "method")
      select
        ${BENCHMARK_PRE_CONTROL_ID_BASE} + substring(${weldJoints.joint} from 3)::integer,
        ${weldJoints.id},
        'РК'
      from ${weldJoints}
      where ${weldJoints.projectTitle} = ${benchmarkProject}
        and substring(${weldJoints.joint} from 3)::integer % 50 = 1
    `)
    await tx.execute(sql`
      insert into ${pstoRepeatCycles} ("id", "weld_joint_id", "sequence")
      select
        ${BENCHMARK_REPEAT_CYCLE_ID_BASE} + substring(${weldJoints.joint} from 3)::integer,
        ${weldJoints.id},
        2
      from ${weldJoints}
      where ${weldJoints.projectTitle} = ${benchmarkProject}
        and substring(${weldJoints.joint} from 3)::integer % 100 = 2
    `)
    const insertMs = performance.now() - insertStartedAt

    const analyzeStartedAt = performance.now()
    await tx.execute(sql`analyze ${weldJoints}, ${preHeatTreatmentControls}, ${pstoRepeatCycles}`)
    const analyzeMs = performance.now() - analyzeStartedAt

    const firstQueryStartedAt = performance.now()
    const firstSummaries = await loadPstoLineAssignmentSummaries(tx)
    const firstQueryMs = performance.now() - firstQueryStartedAt
    const secondQueryStartedAt = performance.now()
    const secondSummaries = await loadPstoLineAssignmentSummaries(tx)
    const secondQueryMs = performance.now() - secondQueryStartedAt

    const benchmarkSummaries = secondSummaries.filter(
      (summary) => summary.projectTitle === benchmarkProject,
    )
    const summarizedRows = benchmarkSummaries.reduce(
      (total, summary) => total + summary.rowCount,
      0,
    )
    if (summarizedRows !== rowCount || benchmarkSummaries.length !== lineCount) {
      throw new Error(
        `Unexpected benchmark result: ${summarizedRows} rows in ${benchmarkSummaries.length} lines.`,
      )
    }
    const actualCounts = benchmarkSummaries.reduce((counts, summary) => ({
      assignedCount: counts.assignedCount + summary.assignedCount,
      cancelledCount: counts.cancelledCount + summary.cancelledCount,
      historyRowCount: counts.historyRowCount + summary.historyRowCount,
      preControlCount: counts.preControlCount + summary.preControlCount,
      repeatCycleCount: counts.repeatCycleCount + summary.repeatCycleCount,
    }), emptyCounts())
    const expectedCounts = buildExpectedCounts(rowCount)
    if (JSON.stringify(actualCounts) !== JSON.stringify(expectedCounts)) {
      throw new Error(
        `Unexpected aggregate counts: ${JSON.stringify({ actualCounts, expectedCounts })}`,
      )
    }

    output = {
      rowCount,
      lineCount,
      insertMs: Math.round(insertMs),
      analyzeMs: Math.round(analyzeMs),
      firstQueryMs: Math.round(firstQueryMs),
      secondQueryMs: Math.round(secondQueryMs),
      returnedLineCount: firstSummaries.length,
    }
    throw rollbackMarker
  })
} catch (error) {
  if (error !== rollbackMarker) throw error
} finally {
  await db.execute(sql`analyze ${weldJoints}, ${preHeatTreatmentControls}, ${pstoRepeatCycles}`)
}

console.log(JSON.stringify(output, null, 2))

function readPositiveInteger(value: string | undefined, fallback: number, maximum: number) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`Expected an integer from 1 to ${maximum}, received: ${value}`)
  }
  return parsed
}

function emptyCounts() {
  return {
    assignedCount: 0,
    cancelledCount: 0,
    historyRowCount: 0,
    preControlCount: 0,
    repeatCycleCount: 0,
  }
}

function buildExpectedCounts(total: number) {
  const counts = emptyCounts()
  for (let sequence = 1; sequence <= total; sequence += 1) {
    const assigned = sequence % 10 < 6
    const cancelled = sequence % 10 === 6
    const primaryHistory = sequence % 20 === 0 || sequence % 25 === 0 || sequence % 40 === 0
    const preControl = sequence % 50 === 1
    const repeatCycle = sequence % 100 === 2
    counts.assignedCount += Number(assigned)
    counts.cancelledCount += Number(cancelled)
    counts.historyRowCount += Number(primaryHistory || preControl || repeatCycle)
    counts.preControlCount += Number(preControl)
    counts.repeatCycleCount += Number(repeatCycle)
  }
  return counts
}
