import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { requireDb } from '@/db'
import {
  dispatcherAcceptedWarnings,
  generatedDocumentWeldJoints,
  weldJoints,
  type WeldJoint,
} from '@/db/schema'
import { evaluateEarlyCoilCandidate, isSafeEarlyCoilReplacementRow } from '@/lib/early-coil-candidate'
import {
  EARLY_COIL_DECISION_KIND,
  getEarlyCoilDecisionKey,
  parseEarlyCoilDecisionKey,
} from '@/lib/early-coil-decision'
import { getCoilJointNames, normalizeJointChainPart, parseRepeatedJointName } from '@/lib/joint-chain'
import { getCoilParentBranchJoint } from '@/lib/joint-chain-transitions'
import { getJointChainRows } from '@/lib/repeated-joint-row-utils'
import { buildRepeatedJointDraft } from '@/lib/repeated-joint-draft'
import type { WeldRow } from '@/lib/dispatcher-types'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { assertSecurityScope } from '@/server/security-functions'
import {
  removeHeatTreatmentSourcedDocumentPositionsForWeldsInTransaction,
  syncSystemDocumentsForWeldChangesInTransaction,
} from '@/server/system-document-index'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import {
  deleteEmptyGeneratedDocuments,
  getDispatcherDirtyScopes,
  insertWeldJointsInBatches,
} from '@/server/weld-mutations'
import {
  loadServerWeldValidationContext,
  prepareServerWeldRecords,
  validateServerWeldRecords,
} from '@/server/weld-save-validation'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'

type EarlyCoilTransaction = SystemDocumentSequenceTransaction

export type CreateEarlyCoilDecisionResult = {
  createdRows: WeldJoint[]
  deletedRowIds: number[]
  decisionKey: string
  sourceJoint: string
  targetJoints: [string, string]
}

export type RevokeEarlyCoilDecisionResult = {
  handled: boolean
  deletedRowIds: number[]
}

export const createEarlyCoilDecision = createServerFn({ method: 'POST' })
  .validator((data: { sourceRowId: number }) => ({
    sourceRowId: Math.floor(Number(data?.sourceRowId) || 0),
  }))
  .handler(async ({ data }): Promise<CreateEarlyCoilDecisionResult> => {
    await assertSecurityScope('edit')
    if (!Number.isInteger(data.sourceRowId) || data.sourceRowId <= 0) {
      throw new Error('Не передан исходный стык для досрочной катушки.')
    }

    return requireDb().transaction(async (tx) => {
      const sourceRow = await lockWeldJoint(tx, data.sourceRowId)
      if (!sourceRow) throw new Error('Исходный стык больше не существует. Обновите журнал.')

      const decisionKey = getEarlyCoilDecisionKey(sourceRow.id)
      const [existingDecision] = await tx
        .select({ key: dispatcherAcceptedWarnings.key })
        .from(dispatcherAcceptedWarnings)
        .where(eq(dispatcherAcceptedWarnings.key, decisionKey))
        .for('update')
        .limit(1)
      if (existingDecision) {
        throw new Error('Решение о досрочной врезке этой катушки уже принято. Обновите журнал.')
      }

      const scopeRows = await lockWeldJointScope(tx, sourceRow)
      const hydratedScopeRows = await hydrateRows(tx, scopeRows)
      const systemContext = await loadServerWeldValidationContext(tx)
      const chainRows = getJointChainRows(
        hydratedScopeRows,
        sourceRow,
        systemContext.systemIndexSettings,
      )
      const documentedRowIds = await loadDocumentedRowIds(tx, chainRows.map((row) => row.id))
      const hydratedSource = chainRows.find((row) => row.id === sourceRow.id)
      if (!hydratedSource) throw new Error('Не удалось определить цепочку исходного стыка.')

      const evaluation = evaluateEarlyCoilCandidate(chainRows, hydratedSource, {
        documentedRowIds,
        systemIndexSettings: systemContext.systemIndexSettings,
      })
      if (!evaluation.candidate) throw new Error(evaluation.reason)
      const candidate = evaluation.candidate
      const deletedRowIds = candidate.replacementRow ? [candidate.replacementRow.id] : []
      const previousRows = new Map<number, WeldJoint>()
      if (candidate.replacementRow) {
        previousRows.set(candidate.replacementRow.id, candidate.replacementRow as unknown as WeldJoint)
        await removeHeatTreatmentSourcedDocumentPositionsForWeldsInTransaction({
          tx,
          weldJointIds: deletedRowIds,
        })
        await tx.delete(weldJoints).where(eq(weldJoints.id, candidate.replacementRow.id))
      }

      const drafts = candidate.targetJoints.map((targetJoint) =>
        buildRepeatedJointDraft(candidate.sourceRow, targetJoint),
      )
      prepareServerWeldRecords({ records: drafts, previousRows: new Map(), context: systemContext })
      validateServerWeldRecords({
        records: drafts,
        previousRows: new Map(),
        context: systemContext,
        allowSystemJointNames: true,
      })
      const createdRows = await insertWeldJointsInBatches(tx, drafts)
      await syncSystemDocumentsForWeldChangesInTransaction(tx, createdRows, previousRows)
      if (deletedRowIds.length > 0) await deleteEmptyGeneratedDocuments(tx)

      await tx.insert(dispatcherAcceptedWarnings).values({
        key: decisionKey,
        kind: EARLY_COIL_DECISION_KIND,
        code: 'ДЗ-09',
        title: `Досрочная врезка катушки ${candidate.targetJoints.join(' + ')}`,
        context: buildDecisionContext(candidate.sourceRow, candidate.sourceJoint, candidate.targetJoints),
      })
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes(drafts, previousRows),
      })

      return {
        createdRows,
        deletedRowIds,
        decisionKey,
        sourceJoint: candidate.sourceJoint,
        targetJoints: candidate.targetJoints,
      }
    })
  })

export async function revokeEarlyCoilDecisionInTransaction(
  tx: EarlyCoilTransaction,
  key: string,
): Promise<RevokeEarlyCoilDecisionResult> {
  const parsedDecision = parseEarlyCoilDecisionKey(key)
  if (!parsedDecision) return { handled: false, deletedRowIds: [] }

  const [storedDecision] = await tx
    .select({ key: dispatcherAcceptedWarnings.key })
    .from(dispatcherAcceptedWarnings)
    .where(eq(dispatcherAcceptedWarnings.key, key))
    .for('update')
    .limit(1)
  if (!storedDecision) return { handled: true, deletedRowIds: [] }

  const sourceRow = await lockWeldJoint(tx, parsedDecision.sourceRowId)
  if (!sourceRow) {
    await tx.delete(dispatcherAcceptedWarnings).where(eq(dispatcherAcceptedWarnings.key, key))
    await markDispatcherTaskIndexDirty(tx)
    return { handled: true, deletedRowIds: [] }
  }

  const scopeRows = await lockWeldJointScope(tx, sourceRow)
  const hydratedRows = await hydrateRows(tx, scopeRows)
  const validationContext = await loadServerWeldValidationContext(tx)
  const chainRows = getJointChainRows(hydratedRows, sourceRow, validationContext.systemIndexSettings)
  const hydratedSource = chainRows.find((row) => row.id === sourceRow.id) ?? (sourceRow as WeldRow)
  const branchJoint = parseRepeatedJointName(
    String(hydratedSource.joint ?? ''),
    validationContext.systemIndexSettings,
  ).base
  const targetJoints = getCoilJointNames(branchJoint, validationContext.systemIndexSettings)
  const targetJointKeys = new Set(targetJoints.map(normalizeJointChainPart))
  const targetRows = chainRows.filter((row) => targetJointKeys.has(normalizeJointChainPart(row.joint)))
  const documentedRowIds = await loadDocumentedRowIds(tx, targetRows.map((row) => row.id))

  if (targetRows.length === 1) {
    throw new Error(
      `Нельзя отменить решение: пара стыков катушки ${targetJoints.join(' + ')} неполна. Восстановите отсутствующий стык перед отменой.`,
    )
  }

  for (const targetJoint of targetJoints) {
    const matchingRows = targetRows.filter(
      (row) => normalizeJointChainPart(row.joint) === normalizeJointChainPart(targetJoint),
    )
    if (matchingRows.length > 1) {
      throw new Error(`Нельзя отменить решение: найдено несколько стыков ${targetJoint}. Сначала устраните дубль цепочки.`)
    }
  }

  for (const targetRow of targetRows) {
    if (!isSafeEarlyCoilReplacementRow(targetRow, documentedRowIds)) {
      throw new Error(
        `Нельзя отменить решение: стык ${String(targetRow.joint ?? '').trim() || targetRow.id} уже содержит данные, историю, изменения или документы.`,
      )
    }
    if (hasDescendantBranch(chainRows, targetRow, validationContext.systemIndexSettings)) {
      throw new Error(
        `Нельзя отменить решение: от стыка ${String(targetRow.joint ?? '').trim() || targetRow.id} уже продолжена цепочка.`,
      )
    }
  }

  const deletedRowIds = targetRows.map((row) => row.id)
  const previousRows = new Map(targetRows.map((row) => [row.id, row as unknown as WeldJoint]))
  if (deletedRowIds.length > 0) {
    await removeHeatTreatmentSourcedDocumentPositionsForWeldsInTransaction({
      tx,
      weldJointIds: deletedRowIds,
    })
    await tx.delete(weldJoints).where(inArray(weldJoints.id, deletedRowIds))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, [], previousRows)
    await deleteEmptyGeneratedDocuments(tx)
  }
  await tx.delete(dispatcherAcceptedWarnings).where(eq(dispatcherAcceptedWarnings.key, key))
  await markDispatcherTaskIndexDirty(tx, {
    scopes: getDispatcherDirtyScopes([sourceRow], previousRows),
  })
  return { handled: true, deletedRowIds }
}

async function lockWeldJoint(tx: EarlyCoilTransaction, id: number) {
  const [row] = await tx
    .select()
    .from(weldJoints)
    .where(eq(weldJoints.id, id))
    .for('update')
    .limit(1)
  return row ?? null
}

async function lockWeldJointScope(tx: EarlyCoilTransaction, sourceRow: WeldJoint) {
  return tx
    .select()
    .from(weldJoints)
    .where(and(
      normalizedTextEquals(weldJoints.projectTitle, sourceRow.projectTitle),
      normalizedTextEquals(weldJoints.subtitleCode, sourceRow.subtitleCode),
      normalizedTextEquals(weldJoints.line, sourceRow.line),
    ))
    .for('update')
}

async function hydrateRows(tx: EarlyCoilTransaction, rows: WeldJoint[]) {
  return attachDuplicateControlRelations(
    await attachHeatTreatmentControlRelations(rows as WeldRow[], tx),
    tx,
  )
}

async function loadDocumentedRowIds(tx: EarlyCoilTransaction, rowIds: number[]) {
  if (rowIds.length === 0) return new Set<number>()
  const links = await tx
    .select({ weldJointId: generatedDocumentWeldJoints.weldJointId })
    .from(generatedDocumentWeldJoints)
    .where(inArray(generatedDocumentWeldJoints.weldJointId, rowIds))
  return new Set(links.map((link) => link.weldJointId))
}

function normalizedTextEquals(
  column: typeof weldJoints.projectTitle | typeof weldJoints.subtitleCode | typeof weldJoints.line,
  value: unknown,
) {
  return sql`lower(btrim(coalesce(${column}, ''))) = ${String(value ?? '').trim().toLocaleLowerCase('ru-RU')}`
}

function buildDecisionContext(
  row: WeldRow,
  sourceJoint: string,
  targetJoints: readonly string[],
) {
  return [
    row.projectTitle ? `Проект: ${row.projectTitle}` : '',
    row.subtitleCode ? `Шифр: ${row.subtitleCode}` : '',
    row.line ? `Линия: ${row.line}` : '',
    `Исходный стык: ${sourceJoint}`,
    `Катушка: ${targetJoints.join(' + ')}`,
  ].filter(Boolean).join(' · ')
}

function hasDescendantBranch(
  rows: readonly WeldRow[],
  targetRow: WeldRow,
  settings: Parameters<typeof parseRepeatedJointName>[1],
) {
  const targetBranch = normalizeJointChainPart(targetRow.joint)
  return rows.some((row) => {
    if (row.id === targetRow.id) return false
    let branch = parseRepeatedJointName(String(row.joint ?? ''), settings).base
    while (branch) {
      if (normalizeJointChainPart(branch) === targetBranch) return true
      branch = getCoilParentBranchJoint(branch, settings) ?? ''
    }
    return false
  })
}
