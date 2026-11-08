import { sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { weldJoints } from '@/db/schema'
import { FIELD_BY_KEY } from '@/lib/weld-fields'
import { JOURNAL_INLINE_FIELDS, normalizeJournalCellEdits, type JournalCellEdit } from '@/lib/journal-inline-edit'
import { assertSubmittedWeldFields } from './access-payload'
import { auditSql } from './audit-functions'
import { lockAndAssertInteractiveWeldVersions } from './weld-row-version'
import { lockWeldLineMembershipsForWeldIds, haveSameWeldLineMemberships } from './weld-line-membership-lock'
import { getProfileTimestampUpdates, WELD_BATCH_PROFILE_TIMESTAMP_KEYS } from './weld-persistence'
import { getDispatcherDirtyScopes, markDispatcherTaskIndexDirty } from './dispatcher-task-index-dirty'
import { syncSystemDocumentsForWeldChangesInTransaction } from './system-document-index'
import { buildNumberArrayMatch } from './weld-request-utils'
import { lockLayeredControlDocumentsForWeldChange } from './layered-control-documents'

/** Only the eleven free-entry journal fields. Never normalize or resave the
 * remaining record: legacy parameters and control history are not this edit.
 * Permission/security gates belong to both public journal entry points. */
export async function writeJournalCells(edits: JournalCellEdit[]) {
  const { records, expectedVersions } = normalizeJournalCellEdits(edits)
  const ids = records.map(row => Number(row.id))
  return requireDb().transaction(async tx => {
    // Settings changes/rebuilds acquire this lock before locking joint rows.
    await lockLayeredControlDocumentsForWeldChange(tx)
    const identities = await lockWeldLineMembershipsForWeldIds(tx, ids)
    const stored = await lockAndAssertInteractiveWeldVersions(tx, ids, expectedVersions)
    if (!haveSameWeldLineMemberships(identities, stored)) throw new Error('Состав линии изменился. Обновите журнал; ничего не сохранено.')
    const previous = new Map(stored.map(row => [row.id, row]))
    const now = new Date()
    const payload = records.map(({ id, ...values }) => {
      const before = previous.get(Number(id))!
      assertSubmittedWeldFields(values, before, 'welding')
      return { id, values, timestamps: getProfileTimestampUpdates({ ...before, ...values }, before, now) }
    })
    // Identifiers come solely from the server whitelist/schema. Values are one
    // JSON parameter, so neither text content nor range size becomes SQL code.
    const fields = [...JOURNAL_INLINE_FIELDS].filter(key => records.some(row => Object.hasOwn(row, key)))
    const assignments = fields.map(key => {
      const column = sql.identifier(FIELD_BY_KEY.get(key)!.dbName)
      const type = sql.raw(FIELD_BY_KEY.get(key)!.kind === 'number' ? 'numeric' : 'text')
      return sql`${column} = case when patch."values" ? ${key} then (patch."values" ->> ${key})::${type} else target.${column} end`
    })
    for (const key of WELD_BATCH_PROFILE_TIMESTAMP_KEYS) {
      const column = sql.identifier(weldJoints[key].name)
      assignments.push(key === 'updatedAt' ? sql`${column} = ${now}` :
        sql`${column} = case when patch.timestamps ? ${key} then (patch.timestamps ->> ${key})::timestamptz else target.${column} end`)
    }
    const changed = await auditSql(tx, [{ table: weldJoints, where: buildNumberArrayMatch(weldJoints.id, ids) }], () => tx.execute<{ id: number }>(sql`
      update ${weldJoints} as target set ${sql.join(assignments, sql`, `)}
      from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as patch(id integer, "values" jsonb, timestamps jsonb)
      where target.id = patch.id returning target.id
    `))
    if (changed.rows.length !== records.length) throw new Error('Состав диапазона изменился. Ничего не сохранено.')
    const updated = payload.map(row => ({ ...previous.get(Number(row.id))!, ...row.values, ...row.timestamps, updatedAt: now }))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, updated, previous, { journalFieldsOnly: true })
    await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(updated, previous) })
    return { count: changed.rows.length }
  })
}
