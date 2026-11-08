import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('outputs/ag-grid-scale-2026-11-07')
const read = async (side, file) => JSON.parse(await readFile(resolve(root, `lnk-reverse-${side}`, file), 'utf8'))
const runs = Object.fromEntries(await Promise.all(['new', 'old'].map(async side => [side, {
  metadata: await read(side, 'confirmation.json'), gestures: await read(side, 'interactions.json'),
}])))
assert.ok(Date.parse(runs.new.metadata.startedAt) < Date.parse(runs.old.metadata.startedAt), 'Run NEW before OLD')
for (const key of ['profile', 'count', 'browser', 'version', 'viewport', 'rounds', 'cpuThrottling']) {
  assert.deepEqual(runs.new.metadata[key], runs.old.metadata[key], key)
}
assert.equal(runs.new.metadata.profile, 'lnk-flat-vertical-only')
assert.equal(runs.new.metadata.count, 50000)
assert.deepEqual(runs.new.metadata.geometry, runs.old.metadata.geometry, 'Identical starting geometry and DOM')
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  assert.ok(sorted.length)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const shape = sample => ({ name: sample.name, interaction: sample.interaction,
  domNodes: sample.domNodes, renderedGridRows: sample.renderedGridRows })
assert.deepEqual(runs.new.gestures.samples.map(shape), runs.old.gestures.samples.map(shape), 'Identical gestures')
const summarize = side => {
  const { metadata, gestures } = runs[side], samples = gestures.samples
  assert.equal(metadata.openings.length, 0)
  assert.equal(metadata.program.length, 0)
  assert.equal(samples.length, 20)
  assert.deepEqual(gestures.errors, [])
  for (const sample of samples) {
    assert.match(sample.name, /^lnk:flat:vertical:\d+$/)
    assert.equal(sample.interaction.ownerLabel, 'document.scrollingElement')
    assert.equal(sample.interaction.amplitude, 1600)
    assert.equal(sample.interaction.start, 0)
    assert.equal(sample.interaction.end, 0)
  }
  const frames = samples.reduce((sum, sample) => sum + sample.frameCount, 0)
  const over33 = samples.reduce((sum, sample) => sum + sample.framesOver33Ms, 0)
  return { samples: samples.length, frames, over33, over33Percent: over33 / frames * 100,
    medianP95Ms: median(samples.map(sample => sample.p95FrameMs)),
    maxFrameMs: Math.max(...samples.map(sample => sample.maxFrameMs)),
    medianGestureMs: median(samples.map(sample => sample.readyMs)),
    medianScriptMs: median(samples.map(sample => sample.scriptMs)),
    medianStyleMs: median(samples.map(sample => sample.styleMs)),
    medianLayoutMs: median(samples.map(sample => sample.layoutMs)),
    longTasks: samples.flatMap(sample => sample.longTasksMs),
    rpc: samples.flatMap(sample => sample.requests),
    sql: samples.reduce((sum, sample) => sum + sample.sqlStatements, 0),
    over33ByRound: samples.map(sample => sample.framesOver33Ms) }
}
const summary = { chronologicalOrder: ['new', 'old'], count: 50000,
  chromeVersion: runs.new.metadata.version, geometryEqual: true,
  old: summarize('old'), new: summarize('new') }
await writeFile(resolve(root, 'lnk-reverse-comparison.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
