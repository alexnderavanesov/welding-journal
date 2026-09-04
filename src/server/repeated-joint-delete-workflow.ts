import { requireDb } from '@/db'
import { dispatcherAcceptedWarnings, weldJoints } from '@/db/schema'
import type { RepeatedJointDeleteTask, WeldRow } from '@/lib/dispatcher-types'
import {
  EARLY_COIL_DECISION_KIND,
  getEarlyCoilDecisionSourceRowIds,
} from '@/lib/early-coil-decision'
import { normalizePstoLineIdentity, normalizePstoLineIdentityPart } from '@/lib/psto-line-assignment'
import { buildRepeatedJointTasks } from '@/lib/repeated-joint-tasks'
import type { RepeatedJointDeleteData } from '@/server/weld-contracts'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { deleteLockedWeldRowsInTransaction } from '@/server/weld-mutations'
import { WELD_TABLE_RETURNING } from '@/server/weld-persistence'
import { assertSecurityScope } from '@/server/security-functions'
import { loadServerWeldValidationContext } from '@/server/weld-save-validation'
import { lockWeldLineMemberships } from '@/server/weld-line-membership-lock'
import { assertExpectedInteractiveWeldVersions } from '@/server/weld-row-version'
import { and, asc, eq, sql } from 'drizzle-orm'

export function findCurrentObsoleteRepeatedJointDeleteTask({
  data,
  earlyCoilDecisionSourceRowIds,
  rows,
  validationContext,
}: {
  data: RepeatedJointDeleteData
  earlyCoilDecisionSourceRowIds: ReadonlySet<number>
  rows: WeldRow[]
  validationContext: Pick<
    Awaited<ReturnType<typeof loadServerWeldValidationContext>>,
    'dataListSettings' | 'systemIndexSettings' | 'welderStamps' | 'welderStampSuspensions'
  >
}): RepeatedJointDeleteTask {
  const task = buildRepeatedJointTasks(
    rows,
    validationContext.welderStamps,
    validationContext.welderStampSuspensions,
    {
      dataListSettings: validationContext.dataListSettings,
      earlyCoilDecisionSourceRowIds,
      systemIndexSettings: validationContext.systemIndexSettings,
    },
  ).find((candidate): candidate is RepeatedJointDeleteTask => (
    candidate.kind === 'delete' &&
    candidate.key === data.taskKey &&
    candidate.row.id === data.target.id
  ))
  if (!task) {
    throw new Error(
      'Задача на удаление уже изменилась или больше не актуальна. Ничего не удалено. Обновите диспетчер и проверьте цепочку.',
    )
  }
  return task
}

export async function deleteObsoleteRepeatedJoint({ data: rawData }: { data: RepeatedJointDeleteData }) {
  await assertSecurityScope('delete')
  const data = normalizeRequest(rawData)
  const db = requireDb()

  return db.transaction(async (tx) => {
    await loadControlProcessSettingsFromTransaction(tx)
    const [identityRow] = await tx
      .select({
        projectTitle: weldJoints.projectTitle,
        subtitleCode: weldJoints.subtitleCode,
        line: weldJoints.line,
      })
      .from(weldJoints)
      .where(eq(weldJoints.id, data.target.id))
      .limit(1)
    if (!identityRow) throwStaleDeleteTask()

    const identity = normalizePstoLineIdentity(identityRow)
    await lockWeldLineMemberships(tx, [identity])
    const storedRows = await tx
      .select(WELD_TABLE_RETURNING)
      .from(weldJoints)
      .where(and(
        normalizedTextEquals(weldJoints.projectTitle, identity.projectTitle),
        normalizedTextEquals(weldJoints.subtitleCode, identity.subtitleCode),
        normalizedTextEquals(weldJoints.line, identity.line),
      ))
      .orderBy(asc(weldJoints.id))
      .for('update')
    const targetRow = storedRows.find((row) => row.id === data.target.id)
    if (!targetRow) throwStaleDeleteTask()
    assertExpectedInteractiveWeldVersions([targetRow.id], [data.target], [targetRow])

    const hydratedRows = await attachDuplicateControlRelations(
      await attachHeatTreatmentControlRelations(storedRows, tx),
      tx,
    ) as WeldRow[]
    const validationContext = await loadServerWeldValidationContext(tx, storedRows)
    const acceptedEarlyCoilRows = await tx
      .select({ key: dispatcherAcceptedWarnings.key })
      .from(dispatcherAcceptedWarnings)
      .where(eq(dispatcherAcceptedWarnings.kind, EARLY_COIL_DECISION_KIND))
    findCurrentObsoleteRepeatedJointDeleteTask({
      data,
      earlyCoilDecisionSourceRowIds: getEarlyCoilDecisionSourceRowIds(
        acceptedEarlyCoilRows.map((row) => row.key),
      ),
      rows: hydratedRows,
      validationContext,
    })

    await deleteLockedWeldRowsInTransaction(tx, [targetRow])
    return { ok: true }
  })
}

function normalizeRequest(data: RepeatedJointDeleteData): RepeatedJointDeleteData {
  const normalized = {
    taskKey: String(data?.taskKey ?? '').trim(),
    target: {
      id: Number(data?.target?.id),
      version: String(data?.target?.version ?? '').trim(),
    },
  }
  if (
    !normalized.taskKey ||
    !Number.isInteger(normalized.target.id) ||
    normalized.target.id <= 0 ||
    !normalized.target.version
  ) throwStaleDeleteTask()
  return normalized
}

function normalizedTextEquals(
  column: typeof weldJoints.projectTitle | typeof weldJoints.subtitleCode | typeof weldJoints.line,
  value: string,
) {
  return sql`lower(btrim(coalesce(${column}, ''))) = ${normalizePstoLineIdentityPart(value)}`
}

function throwStaleDeleteTask(): never {
  throw new Error(
    'Задача на удаление уже изменилась или больше не актуальна. Ничего не удалено. Обновите диспетчер и проверьте цепочку.',
  )
}
