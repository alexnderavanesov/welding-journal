import assert from 'node:assert/strict'
import { eq, sql } from 'drizzle-orm'
import { encodeIdentityKey } from '../src/lib/identity-key'
import { getLineProgramIdentityKey } from '../src/lib/line-program'
import { getPercentageLineNewWelderWarningKey } from '../src/lib/percentage-line-summary'

const url = new URL(process.env.DATABASE_URL ?? '')
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.pathname, '/welding_tracker_e2e')
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const [{ requireDb }, { linePrograms, weldJoints }, { saveLineProgramInTransaction, toLineProgramRecord }] = await Promise.all([
  import('../src/db/index'), import('../src/db/schema'), import('../src/server/line-program'),
])
const db = requireDb()
const pg = await import('pg')
const prototype = pg.default.Client.prototype
const originalQuery = prototype.query
let statements = 0
prototype.query = function (this: unknown, ...args: unknown[]) {
  statements++
  return (originalQuery as (...args: unknown[]) => unknown).apply(this, args)
} as typeof prototype.query
const counts: number[] = []
const rollback = new Error('test-only rollback')
try {
  for (const size of [1, 2000]) {
    await assert.rejects(db.transaction(async (tx) => {
      const identity = { projectTitle: `SQL rename ${size}`, subtitleCode: 'A:"Б', line: 'LINE:[1]' }
      const target = { projectTitle: `SQL renamed ${size}`, subtitleCode: 'B:"В', line: 'NEW:[2]' }
      const [stored] = await tx.insert(linePrograms).values({ ...identity, category: 'II', groupName: 'A', weldControlPercent: 10, pvkControlPercent: 10 }).returning()
      const request = { ...toLineProgramRecord(stored), ...target }
      await tx.execute(sql`insert into weld_joints (line_program_id, project_title, subtitle_code, line, joint, has_vik, has_rk, rk_result, rk_conclusion, psto_required, psto_result, officiality, revision_actuality, isometry, category, group_name, weld_control_percent, pvk_control_percent)
        select case when n=1 then null else ${stored.id}::integer end, ${identity.projectTitle}, ${identity.subtitleCode}, ${identity.line},
          case when n=2 then 'F1R1' when n=3 then 'F1W1' when n=4 then 'F1W2' else 'F'||n end,
          'да', 'да', 'ремонт', 'SAVED-CONCLUSION', 'да', 'годен', case when n%2=0 then 'нет' else 'да' end,
          case when n%2=0 then 'нет' else 'да' end, 'ISO-'||n, 'II', 'A', 10, 10 from generate_series(1, ${size}) n`)
      const before = (await tx.execute(sql`select to_jsonb(w) - array['project_title','subtitle_code','line','line_program_id','updated_at','welding_updated_at'] as data from weld_joints w where project_title=${identity.projectTitle} order by id`)).rows
      const firstId = (before[0].data as { id: number }).id
      await tx.execute(sql`insert into duplicate_controls (weld_joint_id, method, result, conclusion) values (${firstId}, 'ПВК', 'ремонт', 'DUP')`)
      await tx.execute(sql`insert into pre_heat_treatment_controls (weld_joint_id, method, result, conclusion_name) values (${firstId}, 'ВИК', 'годен', 'PRE')`)
      await tx.execute(sql`insert into psto_repeat_cycles (weld_joint_id, sequence, psto_result) values (${firstId}, 2, 'годен')`)
      const docs = await tx.execute(sql`insert into generated_documents (type, title, file_name, mime_type, row_count, source_metadata) values ('lnk-rk', 'SAVED-DOCUMENT', 'saved.pdf', 'application/pdf', 1, '{"history":"keep"}') returning id`)
      await tx.execute(sql`insert into generated_document_weld_joints (document_id, weld_joint_id) values (${docs.rows[0].id}, ${firstId})`)
      const history = async () => (await tx.execute(sql`select
        (select jsonb_agg(d) from duplicate_controls d where weld_joint_id=${firstId}) as duplicates,
        (select jsonb_agg(d) from pre_heat_treatment_controls d where weld_joint_id=${firstId}) as pre,
        (select jsonb_agg(d) from psto_repeat_cycles d where weld_joint_id=${firstId}) as cycles,
        (select jsonb_agg(d) from generated_documents d where id=${docs.rows[0].id}) as documents,
        (select jsonb_agg(d) from generated_document_weld_joints d where weld_joint_id=${firstId}) as links`)).rows
      const historyBefore = await history()
      const oldKey = getPercentageLineNewWelderWarningKey(encodeIdentityKey([getLineProgramIdentityKey(identity), 'k1']))
      const newKey = getPercentageLineNewWelderWarningKey(encodeIdentityKey([getLineProgramIdentityKey(target), 'k1']))
      await tx.execute(sql`insert into dispatcher_accepted_warnings (key, kind, context) values
        (${oldKey}, 'percentage-line-control', ${`Проект: ${identity.projectTitle} · Шифр: ${identity.subtitleCode} · Линия: ${identity.line} · Клеймо: K1`}),
        (${'early-coil:' + firstId}, 'early-coil', ${`Проект: ${identity.projectTitle} · Шифр: ${identity.subtitleCode} · Линия: ${identity.line} · Исходный стык: F1 · Катушка: F1W1 + F1W2`})`)
      const countBefore = statements
      const saved = await saveLineProgramInTransaction(tx, request)
      counts.push(statements - countBefore)
      assert.equal(saved.id, stored.id)
      assert.notEqual(saved.version, request.version)
      const after = (await tx.execute(sql`select to_jsonb(w) - array['project_title','subtitle_code','line','line_program_id','updated_at','welding_updated_at'] as data from weld_joints w where project_title=${target.projectTitle} order by id`)).rows
      assert.deepEqual(after, before, 'Only identity/registry/version fields may change')
      assert.deepEqual(await history(), historyBefore, 'Results, cycles and documents must remain byte-for-byte equal')
      assert.equal((await tx.execute(sql`select count(*)::integer as n from weld_joints where line_program_id=${saved.id}`)).rows[0].n, size)
      assert.equal((await tx.execute(sql`select key from dispatcher_accepted_warnings where key=${oldKey}`)).rows.length, 0)
      assert.equal((await tx.execute(sql`select key from dispatcher_accepted_warnings where key=${newKey}`)).rows.length, 1)
      const coil = (await tx.execute(sql`select context from dispatcher_accepted_warnings where key=${'early-coil:' + firstId}`)).rows[0]
      assert(String(coil.context).includes(`Линия: ${target.line} · Исходный стык: F1`))
      await assert.rejects(saveLineProgramInTransaction(tx, { ...request, line: 'STALE' }), /другим пользователем/)
      const [occupied] = await tx.insert(linePrograms).values({ projectTitle: 'OCCUPIED', subtitleCode: 'O', line: `BUSY-${size}` }).returning()
      await assert.rejects(saveLineProgramInTransaction(tx, { ...saved, projectTitle: ' occupied ', subtitleCode: 'o', line: occupied.line.toLowerCase() }), /уже существует/)
      await tx.insert(weldJoints).values({ projectTitle: 'LEGACY', subtitleCode: 'L', line: `BUSY-${size}`, joint: 'F1' })
      await assert.rejects(saveLineProgramInTransaction(tx, { ...saved, projectTitle: 'legacy', subtitleCode: 'l', line: occupied.line }), /уже есть стыки/)
      const recased = await saveLineProgramInTransaction(tx, { ...saved, line: saved.line.toLowerCase() })
      assert.equal((await tx.select().from(weldJoints).where(eq(weldJoints.id, firstId)))[0].line, recased.line)
      assert.equal((await tx.execute(sql`select key from dispatcher_accepted_warnings where key=${newKey}`)).rows.length, 1)
      assert.deepEqual(await history(), historyBefore)
      throw rollback
    }), (error) => error === rollback)
  }
  assert.equal(counts[0], counts[1], 'SQL count must not grow with the number of joints')
  const [concurrent] = await db.insert(linePrograms).values({ projectTitle: 'Concurrent rename test', subtitleCode: 'RACE', line: 'INITIAL' }).returning()
  try {
    const results = await Promise.allSettled(['FIRST', 'SECOND'].map((line) => db.transaction((tx) =>
      saveLineProgramInTransaction(tx, { ...toLineProgramRecord(concurrent), line }))))
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
    assert.match(rejected.reason.message, /другим пользователем/)
    const winner = results.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<ReturnType<typeof toLineProgramRecord>>
    assert.equal((await db.select().from(linePrograms).where(eq(linePrograms.id, concurrent.id)))[0].line, winner.value.line)
  } finally {
    await db.delete(linePrograms).where(eq(linePrograms.id, concurrent.id))
  }
  console.log(JSON.stringify({ rows: [1, 2000], queries: counts, preservedHistory: true, conflictsAndStaleVersions: true, concurrentRename: true }))
} finally {
  prototype.query = originalQuery
}
