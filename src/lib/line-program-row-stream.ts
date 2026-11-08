import { fromJSON, toJSON } from 'seroval'
import type { RawStream } from '@tanstack/react-start'
import type { packProgramRows } from './line-program-row-payload'

export type ProgramRowsPayload = ReturnType<typeof packProgramRows> & {
  total: number
  approvals: { key: string; rowId: number; version: string }[]
  approvedKeys: string[]
}
export const PROGRAM_ROWS_PROTOCOL = 'line-program-rows-v1'
export type ProgramRowsWireResult = ProgramRowsPayload | {
  protocol: typeof PROGRAM_ROWS_PROTOCOL
  stream: ReadableStream<Uint8Array> | RawStream
}
const CHUNK_BYTES = 64 * 1024
const ITEMS_PER_RECORD = 64
const fields = new Set(['total', 'rows', 'nullFields', 'chainStates', 'emptyRepairRequirementIds', 'approvals', 'approvedKeys'])
const requiredFields = ['total', 'rows', 'nullFields', 'approvals', 'approvedKeys']
type Descriptor = [string, number | null]
const incomplete = () => new Error('Состав линии передан не полностью. Повторите загрузку.')

function* records(payload: ProgramRowsPayload): Generator<string> {
  const keys = Object.keys(payload)
  if (keys.some(key => !fields.has(key)) || requiredFields.some(key => !keys.includes(key))) throw incomplete()
  const entries = Object.entries(payload)
  const encode = (value: unknown) => JSON.stringify(toJSON(value)) + '\n'
  yield encode(['header', 1, entries.map(([key, value]) => [key, Array.isArray(value) ? value.length : null])])
  for (const [key, value] of entries) {
    if (!Array.isArray(value)) { yield encode(['value', key, value]); continue }
    for (let offset = 0; offset < value.length; offset += ITEMS_PER_RECORD) {
      yield encode(['items', key, offset, value.slice(offset, offset + ITEMS_PER_RECORD)])
    }
  }
  yield encode(['end'])
}

/** Call only after field redaction and the read transaction have completed.
 * One source chunk is admitted per pull. Seroval retains at most one record
 * (64 items), not a whole-line serialization tree or a queue of eager writes.
 * A single large history/value is preserved; its record is split into bytes.
 */
export function createProgramRowsStream(payload: ProgramRowsPayload): ReadableStream<Uint8Array> {
  let source: Generator<string> | undefined = records(payload), pending = '', offset = 0
  const encoder = new TextEncoder()
  const dispose = () => { source?.return(undefined); source = undefined; pending = ''; offset = 0 }
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      try {
        const bytes = new Uint8Array(CHUNK_BYTES)
        let written = 0, finished = false
        while (written < bytes.length) {
          if (offset === pending.length) {
            const next = source?.next()
            if (!next || next.done) { finished = true; break }
            pending = next.value; offset = 0
          }
          // Avoid copying the rest of a potentially large string, and never
          // split a UTF-16 surrogate pair before encodeInto sees it.
          let end = Math.min(pending.length, offset + CHUNK_BYTES)
          if (end < pending.length && /[\uD800-\uDBFF]/.test(pending[end - 1]) && /[\uDC00-\uDFFF]/.test(pending[end])) end--
          const encoded = encoder.encodeInto(pending.slice(offset, end), bytes.subarray(written))
          offset += encoded.read; written += encoded.written
          if (!encoded.read) break // Remaining bytes cannot hold the next code point.
        }
        if (written) controller.enqueue(bytes.subarray(0, written))
        if (finished) { dispose(); controller.close() }
      } catch (error) { dispose(); controller.error(error) }
    },
    cancel() { dispose() },
  }, { highWaterMark: CHUNK_BYTES, size: chunk => chunk.byteLength })
}

/** Assemble privately until both the footer and the HTTP body are complete.
 * UTF-8 chunks may split anywhere. Fragments are joined once per record, so a
 * large history does not repeatedly copy its growing, incomplete JSON string.
 */
export async function readProgramRowsStream(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<ProgramRowsPayload> {
  const reader = stream.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  const state = new Map<string, { length: number | null; offset: number; complete: boolean }>()
  const result: Record<string, unknown> = {}
  let header = false, footer = false, ended = false, fragments: string[] = []
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  const accept = (text: string) => {
    if (footer || !text) throw incomplete()
    const record: unknown = fromJSON(JSON.parse(text))
    if (!Array.isArray(record)) throw incomplete()
    if (!header) {
      if (record.length !== 3 || record[0] !== 'header' || record[1] !== 1 || !Array.isArray(record[2])) throw incomplete()
      for (const descriptor of record[2] as Descriptor[]) {
        if (!Array.isArray(descriptor) || descriptor.length !== 2) throw incomplete()
        const [key, length] = descriptor
        if (typeof key !== 'string' || !fields.has(key) || state.has(key)
          || (key === 'total' ? length !== null : !Number.isSafeInteger(length) || Number(length) < 0)) throw incomplete()
        state.set(key, { length, offset: 0, complete: length === 0 })
        if (length !== null) result[key] = []
      }
      if (requiredFields.some(key => !state.has(key))) throw incomplete()
      header = true; return
    }
    if (record[0] === 'end') {
      if (record.length !== 1 || [...state.values()].some(value => !value.complete)
        || !Number.isSafeInteger(result.total) || (result.total as number) < 0
        || (result.rows as unknown[]).length !== result.total) throw incomplete()
      footer = true; return
    }
    const key = record[1], field = typeof key === 'string' ? state.get(key) : undefined
    if (!field || field.complete) throw incomplete()
    if (record[0] === 'value' && record.length === 3 && field.length === null) {
      result[key] = record[2]; field.complete = true; return
    }
    if (record[0] !== 'items' || record.length !== 4 || field.length === null || record[2] !== field.offset
      || !Array.isArray(record[3]) || !record[3].length || record[3].length > ITEMS_PER_RECORD
      || field.offset + record[3].length > field.length) throw incomplete()
    for (const item of record[3]) (result[key] as unknown[]).push(item)
    field.offset += record[3].length; field.complete = field.offset === field.length
  }
  const consume = (text: string) => {
    let start = 0, end = text.indexOf('\n')
    while (end !== -1) {
      const piece = text.slice(start, end)
      accept(fragments.length ? [...fragments, piece].join('') : piece)
      fragments = []; start = end + 1; end = text.indexOf('\n', start)
    }
    if (start < text.length) fragments.push(text.slice(start))
  }
  try {
    signal?.throwIfAborted()
    while (true) {
      const next = await reader.read()
      signal?.throwIfAborted()
      if (next.done) { ended = true; break }
      if (!(next.value instanceof Uint8Array)) throw incomplete()
      consume(decoder.decode(next.value, { stream: true }))
    }
    consume(decoder.decode())
    if (!header || !footer || fragments.length) throw incomplete()
    return result as ProgramRowsPayload
  } finally {
    signal?.removeEventListener('abort', abort)
    if (!ended) void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Own the complete RPC signal, not only the decoded RawStream's local reader.
 * An invalid/truncated record aborts the HTTP response and stops server work.
 * Plain payloads remain readable during a client/server version transition.
 */
export async function loadProgramRows(load: (signal: AbortSignal) => Promise<ProgramRowsWireResult>, signal?: AbortSignal): Promise<ProgramRowsPayload> {
  const controller = new AbortController()
  let stream: ReadableStream<Uint8Array> | undefined
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  try {
    controller.signal.throwIfAborted()
    const payload = await load(controller.signal)
    if ('rows' in payload) { controller.signal.throwIfAborted(); return payload }
    // Start preserves RawStream in its function type/direct server calls;
    // the framed browser deserializer returns its ReadableStream instead.
    const received = payload.stream
    const candidate = received && 'getReader' in received ? received : received?.stream
    if (typeof candidate?.getReader === 'function') stream = candidate
    if (payload.protocol !== PROGRAM_ROWS_PROTOCOL || !stream) throw incomplete()
    return await readProgramRowsStream(stream, controller.signal)
  } catch (error) {
    controller.abort(error)
    if (stream && !stream.locked) void stream.cancel(error).catch(() => {})
    throw error
  }
  finally { signal?.removeEventListener('abort', abort) }
}
