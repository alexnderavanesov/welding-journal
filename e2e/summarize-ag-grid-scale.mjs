import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

// Offline only: no server, database, browser or application imports.
const root = resolve('outputs/ag-grid-scale-2026-11-07')
const [beforeLabel, afterLabel, supplementLabel] = process.argv.slice(2)
for (const label of [beforeLabel, afterLabel, ...(supplementLabel ? [supplementLabel] : [])]) assert(/^[\w-]+$/.test(label ?? ''), 'Pass before and after output labels')
const read = async (label, file) => JSON.parse(await readFile(resolve(root, label, `${file}.json`), 'utf8'))
const load = async label => Object.fromEntries(await Promise.all(['fixture', 'opening', 'interactions', 'resources', 'sql-and-resources', 'scale-facet-trace']
  .map(async name => [name, await read(label, name)])))
const before = await load(beforeLabel), after = await load(afterLabel)
const supplement = supplementLabel ? await load(supplementLabel) : null
if (supplement) {
  assert.equal(before.fixture.count, supplement.fixture.count)
  assert.deepEqual(before.fixture.counts, supplement.fixture.counts)
  assert.deepEqual(before.opening.viewport, supplement.opening.viewport)
  assert.equal(before.opening.version, supplement.opening.version)
  assert(['interactions', 'interactions:program-nested'].includes(supplement.opening.onlyPhase))
  // Preserve original evidence; the comparison explicitly identifies the
  // supplemental run. Same named samples come from the complete later phase.
  before.interactions = { ...before.interactions, samples: [...new Map([
    ...before.interactions.samples, ...supplement.interactions.samples,
  ].map(sample => [sample.name, sample])).values()] }
}
assert.equal(before.fixture.count, after.fixture.count)
assert.deepEqual(before.fixture.counts, after.fixture.counts)
assert.deepEqual(before.opening.viewport, after.opening.viewport)
assert.equal(before.opening.version, after.opening.version, 'Different Chrome builds are not a paired comparison')
let beforeSignature
try { beforeSignature = await read(beforeLabel, 'calculation-signature') }
catch (error) {
  if (error.code !== 'ENOENT' || !supplementLabel) throw error
  beforeSignature = await read(supplementLabel, 'calculation-signature')
}
const afterSignature = await read(afterLabel, 'calculation-signature')
assert.deepEqual(beforeSignature, afterSignature, 'Calculation identities/counts/order/statuses changed')
const median = values => { const v = values.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null }
const group = (samples, key, value) => {
  const groups = new Map()
  for (const sample of samples) {
    if (sample.failed) continue
    const name = key(sample), values = groups.get(name) ?? []
    values.push(value(sample)); groups.set(name, values)
  }
  return new Map([...groups].map(([name, values]) => [name, { samples: values.length, median: median(values), min: Math.min(...values), max: Math.max(...values) }]))
}
const compare = (a, b) => [...new Set([...a.keys(), ...b.keys()])].map(name => {
  const before = a.get(name), after = b.get(name)
  return { name, before, after, percent: before?.median && after?.median !== undefined ? (after.median / before.median - 1) * 100 : null }
})
const openings = value => group(value.opening.results, x => `${x.section}:${x.phase}`, x => x.observedSummaryReadyMs)
const interactions = (value, field) => group(value.interactions.samples, x => x.name.replace(/:\d+$/, ''), x => x[field])
const facets = value => value['scale-facet-trace'].requests.map(request => ({
  name: request.name, milliseconds: request.milliseconds, statements: request.sql.length,
  fullFacetQueries: request.sql.filter(sql => sql.rows >= value.fixture.count && sql.columns === 2 && sql.sqlFeatures?.groupBy)
    .map(sql => ({ rows: sql.rows, milliseconds: sql.milliseconds, shape: sql.sqlShapeSha256 })),
}))
const comparison = { beforeLabel, afterLabel, supplementLabel, count: before.fixture.count, fixture: before.fixture.counts,
  calculationSignature: { equal: true, value: beforeSignature },
  openings: compare(openings(before), openings(after)),
  interactionReady: compare(interactions(before, 'readyMs'), interactions(after, 'readyMs')),
  frameP95: compare(interactions(before, 'p95FrameMs'), interactions(after, 'p95FrameMs')),
  script: compare(interactions(before, 'scriptMs'), interactions(after, 'scriptMs')),
  resources: { before: before.resources, after: after.resources, supplement: supplement?.resources },
  calculations: { before: before['sql-and-resources'].dispatcherCalculations, supplement: supplement?.['sql-and-resources'].dispatcherCalculations,
    after: after['sql-and-resources'].dispatcherCalculations },
  facets: { before: facets(before), supplement: supplement ? facets(supplement) : null, after: facets(after) },
  failures: { before: before.opening.failures, supplement: supplement?.opening.failures, after: after.opening.failures },
}
const path = resolve(root, `comparison-${before.fixture.count}.json`)
await writeFile(path, JSON.stringify(comparison, null, 2))
console.log(path)
console.log('Opening readiness medians, milliseconds:')
for (const row of comparison.openings) console.log(`${row.name}: ${Math.round(row.before?.median ?? NaN)} -> ${Math.round(row.after?.median ?? NaN)}`)
console.log('Failure phases:', JSON.stringify(Object.fromEntries(Object.entries(comparison.failures).map(([run, failures]) => [run, failures?.map(failure => failure.name)]))))
