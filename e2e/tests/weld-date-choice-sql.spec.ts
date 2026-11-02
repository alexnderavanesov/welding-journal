import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { withE2eDatabase } from '../database'
import { booleanDates, booleanStyles, checkBooleanOracle } from '../weld-date-choice-oracle'

test.use({ trace: 'off', video: 'off' })

test('physical weld-date choices preserve boolean semantics across DateStyle and NULL', async ({}, info) => {
  test.setTimeout(60000)
  const checks: object[] = []
  let complete = false
  try {
    // The normal E2E runner owns this disposable database. The shared helper
    // fixes its connection to 127.0.0.1:5432/welding_tracker_e2e.
    await withE2eDatabase(async client => {
      await client.query('begin isolation level repeatable read read only')
      try {
        const identity = (await client.query(`select current_database() as database,
          current_setting('transaction_read_only') as read_only`)).rows[0]
        expect(identity).toEqual({ database: 'welding_tracker_e2e', read_only: 'on' })
        // Fixed VALUES only: no fixture/table writes, HTTP capture or load run.
        // No SQL-shape callback: formatting/planning changes may preserve the
        // required behavior and must not break this ordinary regression.
        await checkBooleanOracle(client, checks)
        expect(checks).toHaveLength(768)
      } finally {
        // Restores every transaction-local DateStyle, also after assertion or
        // SQL failure. There is no persistent session-setting change.
        await client.query('rollback')
      }
    })
    complete = true
  } finally {
    await writeFile(info.outputPath('weld-date-choice-boolean.json'), JSON.stringify({
      complete, fixture: '14 fixed VALUES rows; no table fixtures', dates: booleanDates, styles: booleanStyles,
      semantics: ['value', 'NOT', 'AND TRUE', 'AND FALSE', 'AND NULL', 'OR TRUE', 'OR FALSE', 'OR NULL'],
      comparison: 'Actual production predicate versus independent expected booleans and frozen original/C5 expressions; no SQL-byte equality required.',
      checks,
    }))
  }
})
