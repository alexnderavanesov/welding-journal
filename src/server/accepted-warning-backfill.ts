import { and, asc, gt, isNull, sql } from 'drizzle-orm'
import { dispatcherAcceptedWarnings as warnings, linePrograms, welderStamps, weldJoints } from '@/db/schema'
import { acceptedWarningOwner, acceptedWarningLineKey } from '@/lib/accepted-warning-owner'
import { getLineProgramIdentityKey } from '@/lib/line-program'
import { parseStoredProgramApproval, programApprovalKey } from '@/lib/program-control-approval'
import { buildNumberArrayMatch, buildTextArrayMatch } from './weld-request-utils'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { markDispatcherTaskIndexDirty } from './dispatcher-task-index-dirty'

/** Explicit maintenance only, never on page reads. Caller must use one transaction. */
export async function backfillAcceptedWarningObjects(tx: SystemDocumentSequenceTransaction, apply = false) {
  const report = { examined: 0, linked: 0, removedOrphans: 0, removedObsolete: 0, unresolved: [] as string[] }
  // Registries are small; joint histories are loaded only in bounded batches by owner.
  const lines = await tx.select().from(linePrograms)
  const stamps = await tx.select().from(welderStamps)
  const linesByKey = new Map(lines.map(line => [getLineProgramIdentityKey(line), line]))
  const stampIds = new Set(stamps.map(stamp => stamp.id))
  const stampsByName = new Map<string, number[]>()
  for (const stamp of stamps) {
    const key = (stamp.naksStamp ?? '').trim().toLocaleLowerCase('ru')
    stampsByName.set(key, [...(stampsByName.get(key) ?? []), stamp.id])
  }
  let cursor = ''
  for (;;) {
    const batch = await tx.select().from(warnings).where(and(
      gt(warnings.key, cursor), isNull(warnings.weldJointId), isNull(warnings.lineProgramId), isNull(warnings.welderStampId),
    )).orderBy(asc(warnings.key)).limit(500)
    if (!batch.length) break
    cursor = batch.at(-1)!.key
    report.examined += batch.length
    const owners = batch.map(acceptedWarningOwner)
    const jointIds = owners.flatMap(owner => owner?.type === 'joint' ? [owner.id] : [])
    const namedOwners = owners.flatMap(owner => owner?.type === 'joint-name' ? [owner] : [])
    const missingLines = [...new Map(owners.flatMap(owner => owner?.type === 'line' && !linesByKey.has(acceptedWarningLineKey(owner))
      ? [[acceptedWarningLineKey(owner), owner.identity] as const] : [])).values()]
    const joints = jointIds.length ? await tx.select().from(weldJoints).where(buildNumberArrayMatch(weldJoints.id, jointIds)) : []
    const byId = new Map(joints.map(row => [row.id, row]))
    // Names are only a legacy fallback; ambiguity is reported, never guessed.
    const normalizedLine = sql`lower(btrim(coalesce(${weldJoints.projectTitle}, ''))), lower(btrim(coalesce(${weldJoints.subtitleCode}, ''))), lower(btrim(coalesce(${weldJoints.line}, '')))`
    const namedRows = namedOwners.length ? await tx.select({ id: weldJoints.id, projectTitle: weldJoints.projectTitle, subtitleCode: weldJoints.subtitleCode, line: weldJoints.line, joint: weldJoints.joint }).from(weldJoints).where(sql`
      (${normalizedLine}, lower(btrim(coalesce(${weldJoints.joint}, '')))) in
      (${sql.join(namedOwners.map(({ identity: line, joint }) => sql`(${line.projectTitle.trim().toLocaleLowerCase('ru')}, ${line.subtitleCode.trim().toLocaleLowerCase('ru')}, ${line.line.trim().toLocaleLowerCase('ru')}, ${joint.trim().toLocaleLowerCase('ru')})`), sql`, `)})`) : []
    // Do not load every joint on each registered line for every page of decisions.
    // Only check missing registry identities, returning identities rather than histories.
    const occupied = missingLines.length ? await tx.selectDistinct({ projectTitle: weldJoints.projectTitle, subtitleCode: weldJoints.subtitleCode, line: weldJoints.line }).from(weldJoints).where(sql`
      (${normalizedLine}) in (${sql.join(missingLines.map(line => sql`(${line.projectTitle.trim().toLocaleLowerCase('ru')}, ${line.subtitleCode.trim().toLocaleLowerCase('ru')}, ${line.line.trim().toLocaleLowerCase('ru')})`), sql`, `)})`) : []
    const names = new Map<string, number[]>(), occupiedLines = new Set(occupied.map(getLineProgramIdentityKey))
    for (const row of namedRows) {
      const lineKey = getLineProgramIdentityKey(row)
      const key = JSON.stringify([lineKey, (row.joint ?? '').trim().toLocaleLowerCase('ru')])
      names.set(key, [...(names.get(key) ?? []), row.id])
    }
    const deleteKeys: string[] = []
    const converted = new Map<string, typeof warnings.$inferInsert>()
    for (let index = 0; index < batch.length; index++) {
      const warning = batch[index], owner = owners[index]
      if (!owner) { report.unresolved.push(warning.key); continue }
      let object: { weldJointId?: number; lineProgramId?: number; welderStampId?: number } | null = null
      if (owner.type === 'joint') object = byId.has(owner.id) ? { weldJointId: owner.id } : null
      if (owner.type === 'stamp') object = stampIds.has(owner.id) ? { welderStampId: owner.id } : null
      if (owner.type === 'joint-name') {
        const matches = names.get(JSON.stringify([acceptedWarningLineKey(owner), owner.joint.trim().toLocaleLowerCase('ru')])) ?? []
        if (matches.length > 1) { report.unresolved.push(warning.key); continue }
        object = matches.length ? { weldJointId: matches[0] } : null
      }
      if (owner.type === 'line') {
        const lineKey = acceptedWarningLineKey(owner), line = linesByKey.get(lineKey)
        if (!line && occupiedLines.has(lineKey)) { report.unresolved.push(warning.key); continue }
        const matchingStamps = owner.stamp ? stampsByName.get(owner.stamp.trim().toLocaleLowerCase('ru')) ?? [] : []
        if (matchingStamps.length > 1) { report.unresolved.push(warning.key); continue }
        // A missing legacy stamp could mean deletion or incomplete old registry data.
        // Do not silently turn its decision into an unrelated line-only approval.
        if (line && owner.stamp && !matchingStamps.length) { report.unresolved.push(warning.key); continue }
        object = line ? { lineProgramId: line.id, ...(matchingStamps.length ? { welderStampId: matchingStamps[0] } : {}) } : null
      }
      if (!object) { deleteKeys.push(warning.key); report.removedOrphans++; continue }
      const program = parseStoredProgramApproval(warning.key)
      if (program && program.key !== programApprovalKey(byId.get(program.rowId)!, program.kind, program.duplicate)) {
        deleteKeys.push(warning.key); report.removedObsolete++; continue
      }
      const key = program?.key ?? warning.key
      const existing = converted.get(key)
      if (!existing || existing.acceptedAt! > warning.acceptedAt) converted.set(key, { ...warning, ...object, key })
      if (key !== warning.key) deleteKeys.push(warning.key)
      report.linked++
    }
    if (apply) {
      if (deleteKeys.length) await tx.delete(warnings).where(buildTextArrayMatch(warnings.key, deleteKeys))
      if (converted.size) await tx.insert(warnings).values([...converted.values()]).onConflictDoUpdate({ target: warnings.key, set: {
        weldJointId: sql`excluded.weld_joint_id`, lineProgramId: sql`excluded.line_program_id`, welderStampId: sql`excluded.welder_stamp_id`,
        acceptedAt: sql`least(${warnings.acceptedAt}, excluded.accepted_at)`,
      } })
    }
  }
  if (apply && report.unresolved.length) throw new Error(`Не удалось однозначно связать ${report.unresolved.length} исключений. Перенос отменён; сначала запустите предпросмотр.`)
  // This one-time conversion changes the meaning of stored keys; a prior refresh
  // must not leave DZ-27 cached after the approvals have been transferred.
  if (apply && report.linked + report.removedOrphans + report.removedObsolete > 0) await markDispatcherTaskIndexDirty(tx)
  return report
}
