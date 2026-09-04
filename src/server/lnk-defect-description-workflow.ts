import { createServerFn } from '@tanstack/react-start'
import { and, eq, sql } from 'drizzle-orm'

import { requireDb } from '@/db'
import { preHeatTreatmentControls, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  isRejectedLnkDefectResult,
  type LnkDefectDescriptionUpdate,
} from '@/lib/lnk-defect-description'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { isCancelledControlValue } from '@/lib/report-value-utils'
import { assertCurrentInteractiveWeldRowVersions } from '@/lib/weld-row-version'
import { attachPreHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import { assertSecurityScope } from '@/server/security-functions'
import { WELD_TABLE_RETURNING } from '@/server/weld-server-shared'

const MAX_DEFECT_DESCRIPTION_LENGTH = 4000
const SIMPLE_METHOD_CODES = new Set(['ВИК', 'УЗК', 'ПВК'])

export const updateLnkDefectDescription = createServerFn({ method: 'POST' })
  .validator(normalizeLnkDefectDescriptionUpdate)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()
    return db.transaction(async (tx) => {
      if (data.stage === 'beforeHeatTreatment') {
        const settings = await loadControlProcessSettingsFromTransaction(tx)
        if (!settings.preHeatTreatmentLnkEnabled) {
          throw new Error('НК до ТО выключен в настройках проекта. Существующая история доступна только для просмотра.')
        }
      }
      const [storedRow] = await tx
        .select(WELD_TABLE_RETURNING)
        .from(weldJoints)
        .where(eq(weldJoints.id, data.rowId))
        .limit(1)
        .for('update')
      if (!storedRow) throw new Error('Стык больше не существует. Обновите отчет ЛНК.')
      assertCurrentInteractiveWeldRowVersions({
        targetIds: [data.rowId],
        expectedVersions: [{ id: data.rowId, version: data.expectedVersion }],
        currentVersions: [{
          id: storedRow.id,
          line: storedRow.line,
          joint: storedRow.joint,
          version: storedRow.rowVersion,
        }],
      })

      const method = LNK_METHODS.find((candidate) => candidate.code === data.methodCode)
      if (!method || method.code === 'РК') throw new Error('Выбранный вид контроля не поддерживает это поле.')
      if (isCancelledControlValue(storedRow[method.enabledKey])) {
        throw new Error('Контроль отменен. Описание сохранено как история и доступно только для просмотра.')
      }

      const now = new Date()
      if (data.stage === 'primary') {
        if (!isRejectedLnkDefectResult(storedRow[method.resultKey])) {
          throw new Error('Описание дефектов можно менять только при результате «ремонт» или «вырез».')
        }
        const [updatedRow] = await tx
          .update(weldJoints)
          .set({
            ...getPrimaryDefectUpdate(data.methodCode, data.value),
            lnkCreatedAt: sql`coalesce(${weldJoints.lnkCreatedAt}, ${now})`,
            lnkUpdatedAt: now,
            updatedAt: now,
          })
          .where(eq(weldJoints.id, data.rowId))
          .returning(WELD_TABLE_RETURNING)
        return updatedRow as WeldRow
      }

      const [control] = await tx
        .select()
        .from(preHeatTreatmentControls)
        .where(and(
          eq(preHeatTreatmentControls.weldJointId, data.rowId),
          eq(preHeatTreatmentControls.method, data.methodCode),
        ))
        .limit(1)
        .for('update')
      if (!control) throw new Error('Позиция НК до ТО больше не существует. Обновите отчет ЛНК.')
      if (!isRejectedLnkDefectResult(control.result)) {
        throw new Error('Описание дефектов можно менять только при результате «ремонт» или «вырез».')
      }

      await tx
        .update(preHeatTreatmentControls)
        .set({ defectDescription: data.value, updatedAt: now })
        .where(eq(preHeatTreatmentControls.id, control.id))
      const [updatedRow] = await tx
        .update(weldJoints)
        .set({
          lnkCreatedAt: sql`coalesce(${weldJoints.lnkCreatedAt}, ${now})`,
          lnkUpdatedAt: now,
          updatedAt: now,
        })
        .where(eq(weldJoints.id, data.rowId))
        .returning(WELD_TABLE_RETURNING)
      const [result] = await attachPreHeatTreatmentControlRelations([updatedRow as WeldRow], tx)
      return result
    })
  })

export function normalizeLnkDefectDescriptionUpdate(
  value: LnkDefectDescriptionUpdate,
): LnkDefectDescriptionUpdate {
  const rowId = Number(value?.rowId)
  if (!Number.isInteger(rowId) || rowId <= 0) throw new Error('Некорректный номер стыка.')
  const methodCode = String(value?.methodCode ?? '').trim().toLocaleUpperCase('ru-RU')
  if (!SIMPLE_METHOD_CODES.has(methodCode)) {
    throw new Error('Описание дефектов доступно только для ВИК, УЗК и ПВК.')
  }
  if (value?.stage !== 'primary' && value?.stage !== 'beforeHeatTreatment') {
    throw new Error('Некорректный этап контроля.')
  }
  const description = String(value?.value ?? '').trim()
  if (description.length > MAX_DEFECT_DESCRIPTION_LENGTH) {
    throw new Error(`Описание дефектов не должно превышать ${MAX_DEFECT_DESCRIPTION_LENGTH} символов.`)
  }
  return {
    rowId,
    expectedVersion: String(value?.expectedVersion ?? '').trim(),
    methodCode,
    stage: value.stage,
    value: description || null,
  }
}

function getPrimaryDefectUpdate(methodCode: string, value: string | null) {
  if (methodCode === 'ВИК') return { vikDefectDescription: value }
  if (methodCode === 'УЗК') return { uzkDefectDescription: value }
  if (methodCode === 'ПВК') return { pvkDefectDescription: value }
  throw new Error('Выбранный вид контроля не поддерживает это поле.')
}
