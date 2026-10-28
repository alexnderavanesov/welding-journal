import assert from 'node:assert/strict'
import pg from 'pg'

/** Deliver one real SELECT only after another connection has committed. This
 * makes mixed snapshots reproducible without sleeps or mocking database rows.
 * Use only in the serial, isolated E2E runner; always restore the query method. */
export async function readAcrossCommittedWrite<T>(read: () => Promise<T>, matches: (sql: string) => boolean, write: () => Promise<unknown>, deferUntilWrite?: (sql: string) => boolean) {
  const original = pg.Client.prototype.query
  let intercepted = false, committed = false
  let resume!: () => void
  const written = new Promise<void>(resolve => { resume = resolve })
  const commit = async () => { try { await write(); committed = true } finally { resume() } }
  try {
    pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
      const statement = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string }).text ?? ''
      // A count and its page can be submitted concurrently. Hold only the
      // explicitly selected page read; never defer the writer's own statements.
      if (intercepted && !committed && deferUntilWrite?.(statement)) {
        return written.then(() => (original as (...values: unknown[]) => unknown).apply(this, args))
      }
      if (intercepted || !matches(statement)) return (original as (...values: unknown[]) => unknown).apply(this, args)
      intercepted = true
      const callback = args.at(-1)
      if (typeof callback === 'function') {
        args[args.length - 1] = (error: Error | null, result: unknown) => {
          if (error) { callback(error); return }
          void commit().then(() => callback(null, result), failure => callback(failure))
        }
        return (original as (...values: unknown[]) => unknown).apply(this, args)
      }
      return Promise.resolve((original as (...values: unknown[]) => unknown).apply(this, args)).then(async result => {
        await commit()
        return result
      })
    } as typeof original
    const result = await read()
    assert(intercepted && committed, 'The intended read and concurrent committed write must both occur')
    return result
  } finally {
    resume()
    pg.Client.prototype.query = original
  }
}
