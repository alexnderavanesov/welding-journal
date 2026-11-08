import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { readAgGridScaleCalculationSignature } from './ag-grid-scale-fixture'

// Optional read-only capture for an already running, runner-owned fixture.
// Run only outside timed samples. Does not seed, mutate, or drop any database.
const [label, rows] = process.argv.slice(2)
assert(/^[\w-]+$/.test(label ?? ''), 'Expected output label')
assert(['50000', '250000'].includes(rows), 'Expected explicit scale')
const signature = await readAgGridScaleCalculationSignature()
assert.equal(signature.joints, Number(rows))
assert(signature.pageCount > 0)
assert.equal(signature.declaredTaskCount, signature.actualTaskCount)
assert.equal(signature.invalidTaskIdentityCount, 0)
assert.equal(signature.pageCountMismatchCount, 0)
assert.equal(signature.pageSequenceErrorCount, 0)
await writeFile(resolve('outputs/ag-grid-scale-2026-11-07', label, 'calculation-signature.json'), JSON.stringify(signature, null, 2))
console.log(JSON.stringify(signature))
