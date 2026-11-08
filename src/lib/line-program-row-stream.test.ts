import { expect, it, vi } from 'vitest'
import { toJSON } from 'seroval'
import { packProgramRows, unpackProgramRows } from './line-program-row-payload'
import { createProgramRowsStream, readProgramRowsStream, loadProgramRows, PROGRAM_ROWS_PROTOCOL, type ProgramRowsPayload } from './line-program-row-stream'

// jsdom and Node's TextEncoder have separate Uint8Array realms. Keep hand-made
// fixtures in the same realm as the byte buffers allocated by our encoder.
const encode = (...records: unknown[]) => Uint8Array.from(new TextEncoder().encode(records.map(record => JSON.stringify(toJSON(record)) + '\n').join('')))
const header = (rows = 0) => ['header', 1, [['total', null], ['rows', rows], ['nullFields', 0], ['approvals', 0], ['approvedKeys', 0]]]
function wire(...records: unknown[]) {
  return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encode(...records)); controller.close() } })
}
function payload(rows: ProgramRowsPayload['rows']): ProgramRowsPayload {
  return { total: rows.length, ...packProgramRows(rows), approvals: [{ key: 'approval', rowId: 1, version: 'version-1' }], approvedKeys: ['approval'] }
}
function fragment(stream: ReadableStream<Uint8Array>, size: number) {
  const reader = stream.getReader()
  let bytes: Uint8Array = new Uint8Array(), offset = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset === bytes.length) {
        const next = await reader.read()
        if (next.done) { reader.releaseLock(); controller.close(); return }
        bytes = next.value; offset = 0
      }
      controller.enqueue(bytes.subarray(offset, offset + size)); offset = Math.min(bytes.length, offset + size)
    },
    async cancel(reason) { await reader.cancel(reason); reader.releaseLock() },
  })
}

it('preserves packed history, documents, versions and scalar types across UTF-8 chunk boundaries', async () => {
  const rows = [{ id: 1, joint: 'F1', rowVersion: '12345', rkRequest: null, t1: Number.NaN, d1: -0, d2: Infinity,
    weldingJournalNote: 'Я😀\\\n"\ud800'.repeat(5000), systemDocumentIds: { rkConclusion: 19 },
    preHeatTreatmentControls: [{ id: 10, weldJointId: 1, method: 'РК' as const, createdAt: new Date('2026-11-07T01:02:03.004Z') }],
    pstoRepeatCycles: [{ id: 20, weldJointId: 1, sequence: 2, updatedAt: new Date('2026-11-07T02:03:04.005Z'), tvmtResult: 'не годен' }],
    transportScalarProbe: { explicitUndefined: undefined, largeInteger: 9007199254740993n, zero: 0, flag: false, nil: null },
  }, { id: 2, joint: 'F2', rowVersion: '12346', rkRequest: null }]
  const original = payload(rows), result = await readProgramRowsStream(fragment(createProgramRowsStream(original), 17))
  expect(result).toStrictEqual(original)
  expect(unpackProgramRows(result).rows).toStrictEqual(rows)
  expect(Object.hasOwn(Reflect.get(result.rows[0], 'transportScalarProbe') as object, 'explicitUndefined')).toBe(true)
  expect(Object.hasOwn(result.rows[1], 'transportScalarProbe')).toBe(false)
})

it('serializes lazily, bounds queued byte chunks, and stops advancing on cancellation', async () => {
  let reads = 0
  const rows = Array.from({ length: 512 }, (_, id) => ({ id, joint: `F${id}`, get weldingJournalNote() { reads++; return `${id}-${'x'.repeat(4096)}` } }))
  // This fixture is already packed: do not invoke its getters in packProgramRows.
  const stream = createProgramRowsStream({ total: rows.length, rows, nullFields: [], approvals: [], approvedKeys: [] })
  expect(reads).toBe(0)
  const reader = stream.getReader(), first = await reader.read()
  expect(first.value!.byteLength).toBeLessThanOrEqual(64 * 1024)
  expect(reads).toBeGreaterThan(0)
  expect(reads).toBeLessThan(rows.length)
  await reader.cancel()
  const cancelledAt = reads
  await Promise.resolve(); await Promise.resolve()
  expect(reads).toBe(cancelledAt)
  reader.releaseLock()
})

it('publishes only after a complete footer and end of body, even when every row has arrived', async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>, published = false
  const stream = new ReadableStream<Uint8Array>({ start(controller) { source = controller } })
  const loading = readProgramRowsStream(stream).then(value => { published = true; return value })
  source.enqueue(encode(header(1), ['value', 'total', 1], ['items', 'rows', 0, [{ id: 1, joint: 'F1' }]]))
  await Promise.resolve(); await Promise.resolve()
  expect(published).toBe(false)
  source.enqueue(encode(['end']))
  await Promise.resolve(); await Promise.resolve()
  expect(published).toBe(false)
  source.close()
  expect((await loading).rows).toEqual([{ id: 1, joint: 'F1' }])
})

it('keeps two concurrently consumed snapshots independent', async () => {
  const first = payload(Array.from({ length: 70 }, (_, index) => ({ id: index + 1, joint: `A${index}`, rowVersion: `a-${index}` })))
  const second = payload(Array.from({ length: 80 }, (_, index) => ({ id: index + 100, joint: `B${index}`, rowVersion: `b-${index}` })))
  const results = await Promise.all([readProgramRowsStream(fragment(createProgramRowsStream(first), 31)), readProgramRowsStream(fragment(createProgramRowsStream(second), 47))])
  expect(results[0]).toStrictEqual(first)
  expect(results[1]).toStrictEqual(second)
})

it('rejects an upstream failure after the footer instead of publishing rows before EOF', async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>, published = false
  const stream = new ReadableStream<Uint8Array>({ start(controller) { source = controller } })
  const failure = new Error('response interrupted after footer')
  const loading = readProgramRowsStream(stream).then(value => { published = true; return value })
  const rejected = expect(loading).rejects.toBe(failure)
  source.enqueue(encode(header(), ['value', 'total', 0], ['end']))
  await Promise.resolve(); await Promise.resolve()
  expect(published).toBe(false)
  source.error(failure)
  await rejected
  expect(published).toBe(false)
})

it.each([
  ['missing footer', [header(), ['value', 'total', 0]]],
  ['missing row', [header(1), ['value', 'total', 1], ['end']]],
  ['wrong total', [header(), ['value', 'total', 1], ['end']]],
  ['duplicate row offset', [header(2), ['value', 'total', 2], ['items', 'rows', 0, [{ id: 1 }]], ['items', 'rows', 0, [{ id: 2 }]], ['end']]],
  ['unexpected version', [['header', 2, []]]],
  ['record after footer', [header(), ['value', 'total', 0], ['end'], ['end']]],
] as const)('rejects %s without publishing a partial snapshot', async (_name, records) => {
  await expect(readProgramRowsStream(wire(...records))).rejects.toThrow()
})

it('aborts the whole RPC and cancels its reader on a malformed record', async () => {
  let rpcSignal!: AbortSignal
  const cancelled = vi.fn(), parent = new AbortController()
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encode(['wrong'])) }, cancel: cancelled })
  await expect(loadProgramRows(async signal => { rpcSignal = signal; return { protocol: PROGRAM_ROWS_PROTOCOL, stream } }, parent.signal)).rejects.toThrow()
  expect(rpcSignal.aborted).toBe(true)
  expect(cancelled).toHaveBeenCalledOnce()
  expect(parent.signal.aborted).toBe(false)
})

it('forwards external cancellation while the response body is pending', async () => {
  const parent = new AbortController(), cancelled = vi.fn(), reason = new Error('left the program page')
  let rpcSignal!: AbortSignal
  const loading = loadProgramRows(async signal => {
    rpcSignal = signal
    return { protocol: PROGRAM_ROWS_PROTOCOL, stream: new ReadableStream<Uint8Array>({ cancel: cancelled }) }
  }, parent.signal)
  await Promise.resolve()
  parent.abort(reason)
  await expect(loading).rejects.toBe(reason)
  expect(rpcSignal.aborted).toBe(true)
  expect(cancelled).toHaveBeenCalledOnce()
})

it('cancels a returned body when the query was aborted before acquiring its reader', async () => {
  const parent = new AbortController(), cancelled = vi.fn(), reason = new Error('aborted before the response arrived')
  await expect(loadProgramRows(async () => {
    parent.abort(reason)
    return { protocol: PROGRAM_ROWS_PROTOCOL, stream: new ReadableStream<Uint8Array>({ cancel: cancelled }) }
  }, parent.signal)).rejects.toBe(reason)
  expect(cancelled).toHaveBeenCalledOnce()
})

it('keeps a complete older plain payload readable during a deployment transition', async () => {
  const original = payload([{ id: 1, joint: 'F1' }])
  expect(await loadProgramRows(async () => original)).toBe(original)
  const parent = new AbortController(), load = vi.fn(async () => original)
  parent.abort()
  await expect(loadProgramRows(load, parent.signal)).rejects.toThrow()
  expect(load).not.toHaveBeenCalled()
})
