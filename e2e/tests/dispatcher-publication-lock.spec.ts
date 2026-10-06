import { expect, test } from '@playwright/test'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import pg from 'pg'
import { lockWeldJointWritesForDispatcherReplacement } from '../../src/server/dispatcher-task-index'
import { E2E_DATABASE_URL } from '../database'

function publicationLock(client: pg.Client) {
  return lockWeldJointWritesForDispatcherReplacement({ execute(statement: SQL) {
    const query = new PgDialect().sqlToQuery(statement)
    return client.query(query.sql, query.params)
  } } as never)
}

for (const first of ['publisher', 'writer'] as const) {
  test(`пересчёт и изменение стыка не блокируют друг друга циклически: первым ${first}`, async () => {
    const publisher = new pg.Client({ connectionString: E2E_DATABASE_URL })
    const writer = new pg.Client({ connectionString: E2E_DATABASE_URL })
    const observer = new pg.Client({ connectionString: E2E_DATABASE_URL })
    let pending: Promise<unknown> | undefined
    await Promise.all([publisher.connect(), writer.connect(), observer.connect()])
    try {
      await publisher.query('begin'); await writer.query('begin')
      await publisher.query("set local statement_timeout='5s'")
      await writer.query("set local statement_timeout='5s'")
      const pid = async (client: pg.Client) => Number((await client.query('select pg_backend_pid() as pid')).rows[0].pid)
      const publisherPid = await pid(publisher), writerPid = await pid(writer)
      const waitForLock = async (id: number) => expect.poll(async () => Number((await observer.query(
        "select count(*) from pg_locks where pid=$1 and locktype='relation' and not granted", [id],
      )).rows[0].count), { timeout: 2000 }).toBeGreaterThan(0)
      if (first === 'publisher') {
        await publicationLock(publisher)
        pending = (async () => {
          await writer.query('select id from weld_joints where id=1 for update')
          await writer.query('update weld_joints set final_status=final_status where id=1')
        })()
        void pending.catch(() => {})
        await waitForLock(writerPid)
        // Reading reports must stay possible during publication.
        expect((await observer.query('select id from weld_joints where id=1')).rowCount).toBe(1)
        await publisher.query('update weld_joints set final_status=final_status where id=1')
        await publisher.query('rollback')
        await pending
      } else {
        await writer.query('select id from weld_joints where id=1 for update')
        pending = publicationLock(publisher)
        void pending.catch(() => {})
        await waitForLock(publisherPid)
        // The queued publisher must not prevent an existing writer upgrading
        // its ROW SHARE lock to ROW EXCLUSIVE and finishing its transaction.
        await writer.query('update weld_joints set final_status=final_status where id=1')
        await writer.query('rollback')
        await pending
        await publisher.query('update weld_joints set final_status=final_status where id=1')
      }
    } finally {
      await Promise.allSettled([publisher.query('rollback'), writer.query('rollback')])
      await pending?.catch(() => {})
      await Promise.all([publisher.end(), writer.end(), observer.end()])
    }
  })
}
