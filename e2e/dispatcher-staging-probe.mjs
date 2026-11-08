// Only installed by the isolated audit server. No application endpoint/hooks.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'

export function installDispatcherStagingProbe(pg, countsFile) {
  assert.equal(process.env.DISPATCHER_LARGE_LINE_PROBE, '1')
  assert.equal(process.env.DATABASE_URL, 'postgresql://welding:welding@127.0.0.1:5432/welding_tracker_e2e')
  assert.equal(process.env.PORT, '3100')
  const file = countsFile.replace(/counts\.json$/, 'dispatcher-staging.json')
  const control = countsFile.replace(/counts\.json$/, 'dispatcher-staging-control.json')
  const attempts = [], active = new Map(), original = pg.Client.prototype.query
  const save = () => { writeFileSync(file + '.tmp', JSON.stringify({ attempts })); renameSync(file + '.tmp', file) }
  const instruction = () => existsSync(control) ? JSON.parse(readFileSync(control, 'utf8')) : {}
  let consumedPause, consumedFailure
  save()
  pg.Client.prototype.query = function (...args) {
    const text = typeof args[0] === 'string' ? args[0] : args[0]?.text ?? ''
    const starts = /create temporary table pg_temp\."dispatcher_task_index_stage"/.test(text)
    if (starts) {
      const record = { number: attempts.length + 1, started: performance.now(), wideReads: 0, wideRows: 0 }
      attempts.push(record); active.set(this, record); save()
    }
    const record = active.get(this)
    const wide = /^\s*select\b/i.test(text) && text.includes('"technology_card_number"') && /from\s+"weld_joints"\s+where\b/i.test(text) && /\bany\s*\(/i.test(text)
    const lock = /^\s*lock table "weld_joints" in exclusive mode/i.test(text)
    const finish = /^\s*(commit|rollback)\s*$/i.test(text)
    const publish = /^\s*delete from "dispatcher_task_pages"/i.test(text)
    if (!record || !(wide || lock || finish || publish)) return original.apply(this, args)
    assert(!args.some(value => typeof value === 'function'), 'Probe requires promise queries')
    const started = performance.now(), client = this
    return (async () => {
      const command = instruction()
      if (publish && command.fail && command.fail !== consumedFailure) {
        consumedFailure = command.fail
        throw new Error('EXPECTED_DISPATCHER_UI_PUBLICATION_FAILURE')
      }
      const reply = await original.apply(client, args)
      if (wide) {
        record.wideReads++; record.wideRows += reply.rowCount
        if (command.pause && command.pause !== consumedPause) {
          consumedPause = command.pause; record.paused = command.pause; save()
          const deadline = performance.now() + 45000
          while (instruction().pause === command.pause) {
            if (performance.now() > deadline) throw new Error('Dispatcher probe pause was not released')
            await setTimeout(25)
          }
          record.resumed = true
        }
      }
      if (lock) { record.lockRequested = started; record.lockAcquired = performance.now(); record.lockWaitMs = record.lockAcquired - started }
      if (finish) {
        record.end = performance.now(); record.outcome = text.trim().toLowerCase()
        record.elapsedMs = record.end - record.started
        if (record.lockAcquired) record.lockHeldMs = record.end - record.lockAcquired
        active.delete(client)
      }
      save()
      return reply
    })()
  }
}
