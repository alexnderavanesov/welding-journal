import { sql } from 'drizzle-orm'
import { dispatcherAcceptedWarnings, weldJoints } from '@/db/schema'
import { getLineProgramIdentityKey, type LineProgramIdentity } from '@/lib/line-program'
import { DISPATCHER_INDEX_LOCK_ID } from '@/server/dispatcher-task-index-constants'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'

export function lineProgramWeldWhere(line: LineProgramIdentity) {
  return sql`lower(btrim(coalesce(${weldJoints.projectTitle}, ''))) = ${line.projectTitle.toLocaleLowerCase('ru')}
    and lower(btrim(coalesce(${weldJoints.subtitleCode}, ''))) = ${line.subtitleCode.toLocaleLowerCase('ru')}
    and lower(btrim(coalesce(${weldJoints.line}, ''))) = ${line.line.toLocaleLowerCase('ru')}`
}

function contextPrefix(line: LineProgramIdentity) {
  return [line.projectTitle && `Проект: ${line.projectTitle}`, line.subtitleCode && `Шифр: ${line.subtitleCode}`, `Линия: ${line.line}`].filter(Boolean).join(' · ')
}

/** Row IDs and document links never change. Only line-keyed accepted decisions need rekeying. */
export async function renameLineProgramDecisions(tx: SystemDocumentSequenceTransaction, previous: LineProgramIdentity, next: LineProgramIdentity) {
  // Serialize against acceptance/revocation and index refresh, after the bulk weld update.
  await tx.execute(sql`select pg_advisory_xact_lock(${DISPATCHER_INDEX_LOCK_ID})`)
  // The summary key is JSON [encodedLineIdentity, stamp], followed by an optional issue suffix.
  // Match the complete first JSON element, not a substring of a project/line/stamp name.
  const oldToken = `[${JSON.stringify(getLineProgramIdentityKey(previous))},`
  const newToken = `[${JSON.stringify(getLineProgramIdentityKey(next))},`
  const percentageMatch = sql`kind = 'percentage-line-control' and strpos(key, ${oldToken}) > 0`
  if (oldToken !== newToken) {
    const conflicts = await tx.execute(sql`select 1 from ${dispatcherAcceptedWarnings} source
      join ${dispatcherAcceptedWarnings} target on target.key = replace(source.key, ${oldToken}, ${newToken})
      where source.kind = 'percentage-line-control' and strpos(source.key, ${oldToken}) > 0 limit 1`)
    if (conflicts.rows.length) throw new Error('Для нового названия уже сохранены решения диспетчера другой линии. Выберите другую связку проекта, шифра и линии.')
  }
  const oldContext = contextPrefix(previous)
  const newContext = contextPrefix(next)
  await tx.execute(sql`update ${dispatcherAcceptedWarnings} set
    key = case when ${percentageMatch} then replace(key, ${oldToken}, ${newToken}) else key end,
    context = case when left(context, length(${oldContext}) + 3) = ${oldContext + ' · '}
      then ${newContext} || substring(context from length(${oldContext}) + 1) else context end
    where (${percentageMatch}) or (kind = 'line-program-control' and left(context, length(${oldContext}) + 3) = ${oldContext + ' · '}) or (kind = 'early-coil' and exists (
      select 1 from ${weldJoints} where ${lineProgramWeldWhere(next)}
        and key = 'early-coil:' || ${weldJoints.id}::text
    ))`)
}
