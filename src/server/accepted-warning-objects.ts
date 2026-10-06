import { eq, sql } from 'drizzle-orm'
import { dispatcherAcceptedWarnings as warnings, linePrograms, weldJoints, welderStamps } from '@/db/schema'
import type { DispatcherTask } from '@/lib/dispatcher-types'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

/** Preserve PostgreSQL microseconds and avoid time-zone-dependent serialization. */
export const acceptedWarningVersionSql = sql<string>`extract(epoch from ${warnings.acceptedAt})::text`

/** Decision-only writes still participate in the dispatcher replacement lock order. */
export async function lockAcceptedWarningWrites(tx: Pick<SystemDocumentSequenceTransaction, 'execute'>) {
  // Compatible with ordinary writes, incompatible with a full index replacement.
  // Take this before owner row locks and before the dispatcher advisory lock.
  await tx.execute(sql`lock table ${weldJoints} in row exclusive mode`)
}

export async function lockAcceptedWarningOwners(tx: SystemDocumentSequenceTransaction, object: { lineProgramId?: number | null; weldJointId?: number | null; welderStampId?: number | null }) {
  if (object.lineProgramId) await tx.select({ id: linePrograms.id }).from(linePrograms).where(eq(linePrograms.id, object.lineProgramId)).for('key share')
  if (object.weldJointId) await tx.select({ id: weldJoints.id }).from(weldJoints).where(eq(weldJoints.id, object.weldJointId)).for('key share')
  if (object.welderStampId) await tx.select({ id: welderStamps.id }).from(welderStamps).where(eq(welderStamps.id, object.welderStampId)).for('key share')
}

/** Object ownership, not display-name matching. FKs remove decisions on actual deletion. */
export async function acceptedWarningObjectForTask(tx: SystemDocumentSequenceTransaction, task: DispatcherTask) {
  if (task.kind === 'welder-stamp-expiry') return { welderStampId: task.stamp.id }
  if (task.kind === 'percentage-line-control' || task.kind === 'line-consistency') {
    const [row] = await tx.select({ lineProgramId: weldJoints.lineProgramId }).from(weldJoints).where(eq(weldJoints.id, task.row.id)).limit(1)
    if (!row?.lineProgramId) throw new Error('У линии нет действующей программы. Обновите данные перед согласованием.')
    const stamp = 'stamp' in task ? task.stamp : ''
    const stamps = stamp ? await tx.select({ id: welderStamps.id }).from(welderStamps)
      .where(sql`lower(btrim(${welderStamps.naksStamp})) = ${stamp.trim().toLocaleLowerCase('ru')}`).limit(2) : []
    if (stamps.length > 1) throw new Error('Клеймо неоднозначно в справочнике. Уточните его перед согласованием.')
    return { lineProgramId: row.lineProgramId, welderStampId: stamps[0]?.id ?? null }
  }
  return { weldJointId: task.row.id }
}

/** Current object labels in both the list and its SQL search; no row-wise RPC. */
export const acceptedWarningContextSql = sql<string>`case
  when ${warnings.weldJointId} is not null then concat_ws(' · ',
    case when coalesce(${weldJoints.projectTitle}, '') <> '' then 'Проект: ' || ${weldJoints.projectTitle} end,
    case when coalesce(${weldJoints.subtitleCode}, '') <> '' then 'Шифр: ' || ${weldJoints.subtitleCode} end,
    'Линия: ' || coalesce(${weldJoints.line}, ''), 'Стык: ' || coalesce(${weldJoints.joint}, ${weldJoints.id}::text),
    case when ${warnings.kind} = 'early-coil' then substring(${warnings.context} from 'Катушка: .*$')
      when ${warnings.kind} = 'line-program-control' then substring(${warnings.context} from '(РК - УЗК|ПВК)$') end)
  when ${warnings.lineProgramId} is not null then concat_ws(' · ',
    case when ${linePrograms.projectTitle} <> '' then 'Проект: ' || ${linePrograms.projectTitle} end,
    case when ${linePrograms.subtitleCode} <> '' then 'Шифр: ' || ${linePrograms.subtitleCode} end,
    'Линия: ' || ${linePrograms.line},
    case when ${warnings.welderStampId} is not null then 'Клеймо: ' || ${welderStamps.naksStamp}
      else substring(${warnings.context} from 'Клеймо: [^·]*') end,
    case when ${warnings.kind} = 'line-consistency' then substring(${warnings.context} from 'Проверка: .*$') end)
  when ${warnings.welderStampId} is not null then concat_ws(' · ', 'Клеймо: ' || coalesce(${welderStamps.naksStamp}, ''),
    case when ${warnings.kind} = 'welder-stamp-expiry' then substring(${warnings.context} from 'Допуск: .*$') end)
  else coalesce(${warnings.context}, '') end`

export const acceptedWarningTitleSql = sql<string>`case when ${warnings.kind} = 'welder-stamp-expiry' and ${warnings.welderStampId} is not null
  then 'Клеймо ' || coalesce(${welderStamps.naksStamp}, '') || ': срок ' || case when ${warnings.key} like 'welder-stamp-expiry:dls:%' then 'ДЛС' else 'НАКС' end
  else ${warnings.title} end`
