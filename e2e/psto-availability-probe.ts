import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import pg from 'pg'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { weldJoints } from '../src/db/schema'
import { buildPstoWorkflowRowsWhere, getPstoWorkflowSummary } from '../src/server/psto-workflow-context'
import type { PstoWorkflowSummary } from '../src/server/weld-contracts'
import { withE2eDatabase } from './database'
import { asE2eOwner } from './with-owner-access'

// Diagnostic prototype only. Reuse the application's complete report/scope
// predicates; do not maintain another version of the PSTO business rules here.
export const availabilityCounts = {
  requestCandidates: 'requestCandidateCount',
  resultCandidates: 'resultCandidateCount',
  resultRegistry: 'resultRegistryCount',
  tvmtRequestCandidates: 'tvmtRequestCandidateCount',
  tvmtResultCandidates: 'tvmtResultCandidateCount',
} as const satisfies Record<string, keyof PstoWorkflowSummary>
export type PstoAvailabilityProbe = Record<keyof typeof availabilityCounts, boolean>
const summaryKeys = ['requestCandidateCount', 'requestRegistryCount', 'resultCandidateCount',
  'resultRegistryCount', 'tvmtRequestCandidateCount', 'tvmtResultCandidateCount'] as const

export function availabilityFromSummary(summary: PstoWorkflowSummary): PstoAvailabilityProbe {
  return Object.fromEntries(Object.entries(availabilityCounts).map(([scope, key]) => [scope, summary[key] > 0])) as PstoAvailabilityProbe
}

export function buildPstoAvailabilityProbeQuery() {
  const fields = (Object.keys(availabilityCounts) as (keyof PstoAvailabilityProbe)[]).map(scope =>
    sql`exists(select 1 from ${weldJoints} where ${buildPstoWorkflowRowsWhere({ scope })}) as ${sql.identifier(scope)}`)
  return new PgDialect().sqlToQuery(sql`select ${sql.join(fields, sql`, `)}`)
}

/** Capture the actual count query rather than approximating its FILTERs. The
 * patch is local to this serial test process and is restored before sampling. */
async function captureSummaryQuery() {
  const original = pg.Client.prototype.query
  const captured: { text: string; values: unknown[] }[] = []
  try {
    pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
      const input = args[0] as string | { text?: string; values?: unknown[]; rowMode?: string }
      const text = typeof input === 'string' ? input : input.text ?? ''
      if (/count\(\*\) filter/i.test(text) && text.includes('"weld_joints"')) {
        assert.equal(typeof input === 'string' ? undefined : input.rowMode, 'array',
          'Drizzle summary must use its positional six-field result mapping')
        const values = Array.isArray(args[1]) ? args[1] : typeof input === 'string' ? [] : input.values ?? []
        captured.push({ text, values: [...values] })
      }
      return (original as (...values: unknown[]) => unknown).apply(this, args)
    } as typeof original
    const counts = await asE2eOwner(getPstoWorkflowSummary, 'psto.view')()
    assert.equal(captured.length, 1, 'Exactly one actual summary count SELECT must be captured')
    return { counts, query: captured[0] }
  } finally {
    pg.Client.prototype.query = original
  }
}

export async function samplePstoAvailabilitySql() {
  const { counts, query: summary } = await captureSummaryQuery()
  const candidate = buildPstoAvailabilityProbeQuery()
  const expected = availabilityFromSummary(counts)
  return withE2eDatabase(async db => {
    const samples: { round: number; kind: 'summary' | 'availability'; elapsedMs: number }[] = []
    // These are same-connection, warm SQL measurements, not cold HTTP times.
    // Alternate order to avoid always favouring the second query's cache state.
    for (let round = 0; round < 4; round++) {
      for (const kind of round % 2 ? ['availability', 'summary'] as const : ['summary', 'availability'] as const) {
        const started = performance.now()
        if (kind === 'summary') {
          const result = await db.query({ ...summary, rowMode: 'array' })
          samples.push({ round, kind, elapsedMs: performance.now() - started })
          assert.equal(result.rows.length, 1)
          assert.equal(result.fields.length, summaryKeys.length)
          assert.deepEqual(result.rows[0].map(Number), summaryKeys.map(key => counts[key]))
        } else {
          const result = await db.query({ text: candidate.sql, values: candidate.params })
          samples.push({ round, kind, elapsedMs: performance.now() - started })
          assert.deepEqual(result.rows[0], expected)
        }
      }
    }
    const plans: Record<string, unknown> = {}
    if (process.env.PSTO_AVAILABILITY_EXPLAIN === '1') {
      for (const [name, text, values] of [
        ['summary', summary.text, summary.values], ['availability', candidate.sql, candidate.params],
      ] as const) {
        plans[name] = (await db.query({ text: `explain (analyze, buffers, format json) ${text}`, values: [...values] })).rows[0]['QUERY PLAN']
      }
    }
    return { counts, availability: expected, samples, plans,
      queries: { summary: { sha256: createHash('sha256').update(summary.text).digest('hex'), bytes: Buffer.byteLength(summary.text) },
        availability: { sha256: createHash('sha256').update(candidate.sql).digest('hex'), bytes: Buffer.byteLength(candidate.sql) } } }
  })
}
