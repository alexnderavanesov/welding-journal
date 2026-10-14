/** Opt-in CPU diagnostics only: no DB, HTTP, server imports or runtime patches.
 * node --import tsx scripts/profile-dispatcher-pure.ts smoke|regular|huge|counts
 * Run ONE process, ideally with `nice -n 10`, `ulimit -t 60` and
 * `--max-old-space-size=768`. Output is generated in a fresh OS temp directory.
 * This is not an E2E benchmark or a business-rule acceptance test.
 */
import assert from 'node:assert/strict'
import { Session } from 'node:inspector/promises'
import type { Profiler } from 'node:inspector'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDispatcherRuleFixtures } from '../src/test/dispatcher-rule-fixtures'
import { buildVisibleDispatcherTasks } from '../src/lib/dispatcher-task-builder'
import { prepareReportRows, prepareReportRowsInPlace } from '../src/lib/use-report-rows'
import { DEFAULT_DISPATCHER_REMINDER_SETTINGS, DEFAULT_DISPATCHER_SETTINGS, getDispatcherTaskCode } from '../src/lib/dispatcher-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '../src/lib/system-index-settings'
import { DEFAULT_DATA_LIST_SETTINGS } from '../src/lib/data-list-settings'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '../src/lib/control-process-settings'
import { createTechnologyCardReview } from '../src/lib/technology-card-review'
import { createCompletedParentBranchChecker, hasCompletedParentBranch } from '../src/lib/repeated-joint-consistency-tasks'
import { buildPercentageLineSummaries } from '../src/lib/percentage-line-summary'
import type { WeldRow } from '../src/lib/dispatcher-types'
import type { WelderStampRecord } from '../src/lib/welder-stamp-types'

const mode = process.argv[2] ?? 'smoke'
assert(['smoke', 'regular', 'huge', 'counts'].includes(mode), 'Unknown bounded profile mode')
assert.equal(typeof window, 'undefined', 'Pure Node only')
// Fail closed if a future dependency accidentally attempts an HTTP request.
globalThis.fetch = async () => { throw new Error('HTTP is forbidden in this pure CPU sidecar') }
const output = mkdtempSync(join(tmpdir(), 'welding-dispatcher-pure-'))
console.log(JSON.stringify({ output, mode, complete: false }))
// Detect concurrent edits in the shared checkout when comparing two profiles.
const libDirectory = new URL('../src/lib/', import.meta.url)
const sourceFiles = [new URL(import.meta.url), ...readdirSync(libDirectory)
  .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map(name => new URL(name, libDirectory))]
const sourceFingerprints = Object.fromEntries(sourceFiles.map(file => [file.pathname,
  createHash('sha256').update(readFileSync(file)).digest('hex')]))
const fixtures = createDispatcherRuleFixtures()
const base = fixtures.find(fixture => fixture.settingId === 'percentage-missing')!.rows[0]!
const permit = { ...fixtures.find(fixture => fixture.settingId === 'welder-stamp-expiry')!.welderStamps[0]!.naksPermits[0]!,
  validFrom: '2020-01-01', validTo: '2099-12-31' }
const stamp: WelderStampRecord = {
  ...fixtures.find(fixture => fixture.settingId === 'welder-stamp-expiry')!.welderStamps[0]!,
  id: 1, naksStamp: 'A1', validFrom: permit.validFrom, validTo: permit.validTo,
  naksPermits: [permit], dlsPermits: [{ ...permit, id: 'dls', number: 'CPU-DLS' }],
}
const input = {
  acceptedDispatcherWarningKeys: new Set<string>(), dismissedRepeatedJointTaskKeys: new Set<string>(),
  earlyCoilDecisionSourceRowIds: new Set<number>(),
  dispatcherReminderSettings: DEFAULT_DISPATCHER_REMINDER_SETTINGS,
  dispatcherSettings: DEFAULT_DISPATCHER_SETTINGS,
  systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS, dataListSettings: DEFAULT_DATA_LIST_SETTINGS,
  controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS,
  technologyCardReview: createTechnologyCardReview({ cards: [], names: [] }, DEFAULT_DATA_LIST_SETTINGS),
  welderStamps: [stamp], welderStampSuspensions: [], includeWelderStampExpiryTasks: false,
}

function rowsFor(lines: number, size: number, repairs = false): WeldRow[] {
  return Array.from({ length: lines * size }, (_, index) => {
    const local = index % size
    return { ...base, id: index + 1, projectTitle: 'PURE CPU PROFILE', line: `L${Math.floor(index / size)}`,
      joint: repairs ? `F${Math.floor(local / 2) + 1}${local % 2 ? 'R1' : ''}` : `F${local + 1}`,
      preHeatTreatmentLnkEnabled: DEFAULT_CONTROL_PROCESS_SETTINGS.preHeatTreatmentLnkEnabled,
      ...(repairs ? { hasRk: 'да', rkResult: local % 2 ? 'годен' : 'ремонт' } : {}),
    }
  })
}

function calculate(rows: WeldRow[]) {
  return buildVisibleDispatcherTasks({ ...input, rows }).repeatedJointTasks
}

function summarize(profile: Profiler.Profile) {
  const byId = new Map(profile.nodes.map(node => [node.id, node]))
  const parents = new Map<number, number>()
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id)
  const self = new Map<string, number>(), inclusive = new Map<string, number>()
  let micros = 0
  const label = (node: Profiler.ProfileNode) => {
    const frame = node.callFrame
    const path = frame.url.replace(/^.*\/welding-journal\//, '')
    return `${frame.functionName || '(anonymous)'} ${path}:${frame.lineNumber + 1}`
  }
  profile.samples?.forEach((id, index) => {
    const duration = profile.timeDeltas?.[index] ?? 0
    const node = byId.get(id)!
    // The first inspector sample can include Profiler.start's own handshake.
    // It is unrelated to the synchronous work bracketed by cpuUsage/performance.
    if (node.callFrame.url === 'node:inspector') return
    micros += duration
    const key = label(node)
    self.set(key, (self.get(key) ?? 0) + duration)
    const visited = new Set<string>()
    let current: number | undefined = id
    while (current !== undefined) {
      const ancestor = label(byId.get(current)!)
      if (!visited.has(ancestor)) inclusive.set(ancestor, (inclusive.get(ancestor) ?? 0) + duration)
      visited.add(ancestor)
      current = parents.get(current)
    }
  })
  const top = (values: Map<string, number>) => [...values].sort((a, b) => b[1] - a[1]).slice(0, 24)
    .map(([frame, value]) => ({ frame, ms: Math.round(value / 1000), percent: +(value / micros * 100).toFixed(2) }))
  return { sampledMs: Math.round(micros / 1000), self: top(self), inclusive: top(inclusive) }
}

const results: unknown[] = []
const session = new Session()
session.connect()
await session.post('Profiler.enable')
await session.post('Profiler.setSamplingInterval', { interval: 1000 })

async function profile(name: string, fn: () => unknown) {
  await session.post('Profiler.start')
  const start = performance.now(), cpuStart = process.cpuUsage()
  const value = fn()
  const cpu = process.cpuUsage(cpuStart), elapsed = performance.now() - start
  const { profile: captured } = await session.post('Profiler.stop')
  writeFileSync(join(output, `${name}.cpuprofile`), JSON.stringify(captured))
  const result = { name, elapsedMs: Math.round(elapsed), cpuMs: Math.round((cpu.user + cpu.system) / 1000),
    rssMiB: Math.round(process.memoryUsage().rss / 2 ** 20), value, ...summarize(captured) }
  results.push(result)
  console.log(JSON.stringify(result))
}

// Warm imports/JIT on a small complete line; no profiler includes module loading.
calculate(prepareReportRows(rowsFor(1, 20)))
if (mode === 'smoke' || mode === 'regular') {
  const lines = mode === 'regular' ? 1000 : 2, size = 200
  const rows = rowsFor(lines, size)
  // Check a small equivalence sample, ignoring only absent versus empty relations.
  const expected = prepareReportRows(rows.slice(0, size))
  const actual = prepareReportRowsInPlace(rows.slice(0, size).map(row => ({ ...row })))
  assert.deepEqual(actual.map(row => ({ ...row, duplicateControls: row.duplicateControls ?? [] })), expected)
  assert(expected.every(row => row.finalStatus === 'ожидает заявку'))
  await profile('prepare-copy', () => {
    let prepared = 0
    for (let offset = 0; offset < rows.length; offset += 5000) prepared += prepareReportRows(rows.slice(offset, offset + 5000)).length
    return { rows: prepared, batch: 5000 }
  })
  await profile('prepare-in-place', () => {
    for (let offset = 0; offset < rows.length; offset += 5000) prepareReportRowsInPlace(rows.slice(offset, offset + 5000))
    return { rows: rows.length, batch: 5000 }
  })
  await profile('percentage-summaries-complete-lines', () => {
    let rowCount = 0, stamps = 0, required = 0
    for (let offset = 0; offset < rows.length; offset += size) {
      for (const summary of buildPercentageLineSummaries(rows.slice(offset, offset + size), input.systemIndexSettings, input.acceptedDispatcherWarningKeys)) {
        rowCount += summary.rowCount
        stamps += summary.stamps.length
        required += summary.stamps.reduce((sum, stamp) => sum + stamp.requiredControls, 0)
      }
    }
    return { lines, rows: rowCount, stamps, required }
  })
  await profile('tasks-complete-lines', () => {
    const codes: Record<string, number> = {}
    let count = 0
    for (let offset = 0; offset < rows.length; offset += size) {
      const tasks = calculate(rows.slice(offset, offset + size))
      count += tasks.length
      for (const task of tasks) { const code = getDispatcherTaskCode(task); codes[code] = (codes[code] ?? 0) + 1 }
    }
    return { lines, rows: rows.length, tasks: count, codes }
  })
} else if (mode === 'huge') {
  // Deliberately bounded: reveal scaling before attempting an indivisible 200k line.
  for (const repairs of [false, true]) for (const size of [200, 1000, 2000, 20_000]) {
    const rows = prepareReportRowsInPlace(rowsFor(1, size, repairs))
    await profile(`one-line-${repairs ? 'repairs' : 'primary'}-${size}`, () => ({ rows: size, tasks: calculate(rows).length }))
  }
  // Isolated existing coil-branch guard, not a claim that every row takes this
  // path. The production dispatcher invokes it for each eligible rejected Y row.
  // Count visits instead of attempting the potentially quadratic 200k case.
  for (const size of [200, 1000]) {
    let statusReads = 0
    const rows: WeldRow[] = rowsFor(1, size).map((row, index) => ({ ...row, joint: `F${index + 1}Y1`,
      get finalStatus() { statusReads++; return 'не годен' },
    }))
    for (const row of rows) assert.equal(hasCompletedParentBranch(rows, row, String(row.joint), DEFAULT_SYSTEM_INDEX_SETTINGS), false)
    // N full candidate scans plus one object-spread read of each source in
    // getJointChainIdentity({ ...row, joint: sourceJoint }).
    assert.equal(statusReads, size * (size + 1))
    const linearStatusReads = statusReads
    statusReads = 0
    const check = createCompletedParentBranchChecker(rows, DEFAULT_SYSTEM_INDEX_SETTINGS)
    for (const row of rows) assert.equal(check(row, String(row.joint)), false)
    assert.equal(statusReads, size * 2)
    const result = { name: 'coil-parent-guard-visits', rows: size, eligibleSources: size, linearStatusReads, indexedStatusReads: statusReads,
      scope: 'Isolated guard, not full-dispatcher acceptance; all candidates rejected' }
    results.push(result)
    console.log(JSON.stringify(result))
  }
} else {
  const interesting = /^(buildLineProgramTopology|buildProgramRepairRequirements|captureProgramChainStates|calculateLineProgram|calculateLineProgramDetails|parseJointName|parseJointChainName|parseRepeatedJointName|normalizeResultStatus|getControlAssignmentHistory|calculateFinalStatus|calculateFinalStatusInRows|parseDateLikeToIso|normalizeSaveCheckSettings|isActiveOfficialWeld)$/
  for (const repairs of [false, true]) {
    const rows = prepareReportRowsInPlace(rowsFor(1, 200, repairs))
    await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false })
    calculate(rows)
    const { result } = await session.post('Profiler.takePreciseCoverage')
    await session.post('Profiler.stopPreciseCoverage')
    const counts = result.flatMap(script => script.url.includes('/src/lib/') ? script.functions
      .filter(fn => interesting.test(fn.functionName))
      .map(fn => ({ function: fn.functionName, path: script.url.replace(/^.*\/welding-journal\//, ''), calls: fn.ranges[0]?.count ?? 0 })) : [])
      .sort((a, b) => b.calls - a.calls)
    const resultRow = { name: 'exact-call-counts', rows: 200, repairs, counts }
    results.push(resultRow)
    console.log(JSON.stringify(resultRow))
  }
}
session.disconnect()
writeFileSync(join(output, 'summary.json'), JSON.stringify({ mode, node: process.version, sourceFingerprints, scope: 'Pure CPU; no DB/IO/serialization; narrow fixture rows; not a production timing comparison', results }, null, 2))
console.log(JSON.stringify({ output, mode, complete: true }))
