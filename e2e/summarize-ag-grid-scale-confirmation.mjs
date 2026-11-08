import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('outputs/ag-grid-scale-2026-11-07')
const read = async (label, name) => JSON.parse(await readFile(resolve(root, label, name), 'utf8'))
const labels = ['confirmation-before', 'confirmation-after']
const sides = await Promise.all(labels.map(async label => ({
  runs: await read(label, 'confirmation.json'),
  gestures: await read(label, 'interactions.json'),
})))
const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  assert.ok(sorted.length)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const stats = values => ({ samples: values.length, median: median(values), min: Math.min(...values), max: Math.max(...values) })
const profile = name => name.replace(/:\d+$/, '')
const shape = sample => ({
  ...sample.interaction,
  domNodes: sample.domNodes,
  renderedGridRows: sample.renderedGridRows,
})
for (const key of ['count', 'browser', 'version', 'viewport', 'rounds', 'cpuThrottling']) {
  assert.deepEqual(sides[0].runs[key], sides[1].runs[key], key)
}
for (const side of sides) {
  assert.equal(side.runs.openings.length, 10)
  assert.equal(side.runs.program.length, 5)
  assert.equal(side.runs.geometry.length, 100)
  assert.equal(side.gestures.samples.length, 100)
  assert.deepEqual(side.gestures.errors, [])
}
assert.deepEqual(sides[0].runs.geometry, sides[1].runs.geometry, 'Same starting viewport, DOM and grid geometry')
const beforeSamples = new Map(sides[0].gestures.samples.map(sample => [sample.name, sample]))
for (const sample of sides[1].gestures.samples) {
  assert.ok(beforeSamples.has(sample.name), sample.name)
  assert.deepEqual(shape(beforeSamples.get(sample.name)), shape(sample), sample.name)
  assert.equal(sample.interaction.amplitude, 1600)
}
const profiles = [...new Set(sides[0].gestures.samples.map(sample => profile(sample.name)))]
const summary = {
  count: sides[0].runs.count,
  browser: sides[0].runs.version,
  geometryEqual: true,
  coldLnk: sides.map(side => stats(side.runs.openings.map(sample => sample.observedSummaryReadyMs))),
  heavyLineStamps: sides.map(side => ({
    readyMs: stats(side.runs.program.map(sample => sample.actionReadyMs)),
    calculationRpcMs: stats(side.runs.program.flatMap(sample => sample.requests
      .filter(request => request.name === 'getLineProgramCalculation_createServerFn_handler')
      .map(request => request.durationMs))),
  })),
  scroll: profiles.map(name => ({
    name,
    sides: sides.map(side => {
      const samples = side.gestures.samples.filter(sample => profile(sample.name) === name)
      assert.equal(samples.length, 20, name)
      const frames = samples.reduce((sum, sample) => sum + sample.frameCount, 0)
      const over33 = samples.reduce((sum, sample) => sum + sample.framesOver33Ms, 0)
      return {
        samples: samples.length, frames, over33, over33Percent: over33 / frames * 100,
        p95FrameMs: stats(samples.map(sample => sample.p95FrameMs)),
        maxFrameMs: Math.max(...samples.map(sample => sample.maxFrameMs)),
        scriptMs: stats(samples.map(sample => sample.scriptMs)),
        styleMs: stats(samples.map(sample => sample.styleMs)),
        layoutMs: stats(samples.map(sample => sample.layoutMs)),
        longTasks: samples.flatMap(sample => sample.longTasksMs),
        rpc: samples.reduce((sum, sample) => sum + sample.requests.length, 0),
        sql: samples.reduce((sum, sample) => sum + sample.sqlStatements, 0),
      }
    }),
  })),
}
await writeFile(resolve(root, 'confirmation-comparison.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({
  geometryEqual: summary.geometryEqual,
  coldLnk: summary.coldLnk,
  heavyLineStamps: summary.heavyLineStamps,
  scroll: summary.scroll.map(row => ({ name: row.name, sides: row.sides.map(side => ({
    over33Percent: side.over33Percent, medianP95Ms: side.p95FrameMs.median,
    maxFrameMs: side.maxFrameMs, scriptMs: side.scriptMs.median,
    longTasks: side.longTasks.length, rpc: side.rpc, sql: side.sql,
  })) })),
}, null, 2))
