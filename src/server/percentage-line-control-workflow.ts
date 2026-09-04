import { requireDb } from '@/db'
import { weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildPercentageLineControlUpdateRows } from '@/lib/percentage-line-control-update'
import { normalizePstoLineIdentity } from '@/lib/psto-line-assignment'
import type { PercentageLineControlUpdateData } from '@/server/weld-contracts'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { assertSecurityScope } from '@/server/security-functions'
import { syncSystemDocumentsForWeldChangesInTransaction } from '@/server/system-document-index'
import { WELD_TABLE_RETURNING, updateWeldJointsInBatches } from '@/server/weld-persistence'
import { getDispatcherDirtyScopes } from '@/server/weld-mutations'
import {
  loadServerWeldValidationContext,
  prepareServerWeldRecords,
  validateServerWeldRecords,
} from '@/server/weld-save-validation'
import { lockWeldLineMemberships } from '@/server/weld-line-membership-lock'
import { assertExpectedInteractiveWeldVersions } from '@/server/weld-row-version'
import { and, asc, sql } from 'drizzle-orm'

export function normalizePercentageLineControlUpdateData(
  data: PercentageLineControlUpdateData,
): PercentageLineControlUpdateData {
  const identity = normalizePstoLineIdentity(data ?? {})
  const action = data?.action
  if (action !== 'assign' && action !== 'cancel') {
    throw new Error('Неизвестное действие с процентной линией.')
  }
  return {
    ...identity,
    stamp: String(data?.stamp ?? '').trim(),
    action,
    method: data?.method,
    targets: (Array.isArray(data?.targets) ? data.targets : []).map((target) => ({
      id: Number(target?.id),
      version: String(target?.version ?? '').trim(),
    })),
  }
}

export async function updatePercentageLineControls({
  data: rawData,
}: {
  data: PercentageLineControlUpdateData
}) {
  await assertSecurityScope('edit')
  const data = normalizePercentageLineControlUpdateData(rawData)
  if (!data.line || !data.stamp || data.targets.length === 0) {
    throw new Error('Не удалось определить линию, клеймо или выбранные стыки.')
  }

  const db = requireDb()
  return db.transaction(async (tx) => {
    await loadControlProcessSettingsFromTransaction(tx)
    await lockWeldLineMemberships(tx, [data])

    const storedRows = await tx
      .select(WELD_TABLE_RETURNING)
      .from(weldJoints)
      .where(and(
        normalizedTextEquals(weldJoints.projectTitle, data.projectTitle),
        normalizedTextEquals(weldJoints.subtitleCode, data.subtitleCode),
        normalizedTextEquals(weldJoints.line, data.line),
      ))
      .orderBy(asc(weldJoints.id))
      .for('update')
    if (storedRows.length === 0) {
      throw new Error('Процентная линия больше не найдена. Обновите статистику и повторите действие.')
    }

    const rowsWithHeatTreatment = await attachHeatTreatmentControlRelations(storedRows, tx)
    const hydratedRows = await attachDuplicateControlRelations(rowsWithHeatTreatment, tx)
    const validationContext = await loadServerWeldValidationContext(tx, storedRows)
    const records = buildPercentageLineControlUpdateRows({
      action: data.action,
      method: data.method,
      rows: hydratedRows,
      scope: data,
      systemIndexSettings: validationContext.systemIndexSettings,
      targetIds: data.targets.map((target) => target.id),
    })
    assertExpectedInteractiveWeldVersions(
      records.map((row) => row.id),
      data.targets,
      storedRows,
    )

    const previousRows = new Map(hydratedRows.map((row) => [row.id, row]))
    prepareServerWeldRecords({ records, previousRows, context: validationContext })
    validateServerWeldRecords({ records, previousRows, context: validationContext })
    const updatedRows = await updateWeldJointsInBatches(tx, records, previousRows)
    await syncSystemDocumentsForWeldChangesInTransaction(tx, updatedRows, previousRows)
    await markDispatcherTaskIndexDirty(tx, {
      scopes: getDispatcherDirtyScopes(records, previousRows),
    })
    return updatedRows
  })
}

function normalizedTextEquals(
  column: typeof weldJoints.projectTitle | typeof weldJoints.subtitleCode | typeof weldJoints.line,
  value: string,
) {
  return sql`lower(btrim(coalesce(${column}, ''))) = ${value.trim().toLocaleLowerCase('ru-RU')}`
}
