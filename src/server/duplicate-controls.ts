import { createServerFn } from '@tanstack/react-start'
import { asc, count, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { requireDb } from '@/db'
import { duplicateControls, weldJoints, type DuplicateControl, type NewDuplicateControl } from '@/db/schema'
import {
  DUPLICATE_CONTROL_PAGE_SIZE_OPTIONS,
  DUPLICATE_CONTROL_MASS_SELECTION_ERROR,
  DUPLICATE_CONTROL_MASS_SELECTION_LIMIT,
  DUPLICATE_CONTROL_METHODS,
  DUPLICATE_CONTROL_RESULTS,
  type DuplicateControlCandidatePageRequest,
  type DuplicateControlCandidatePageResult,
  type DuplicateControlMethod,
  type DuplicateControlRecord,
  type DuplicateControlRegistryPageRequest,
  type DuplicateControlRegistryPageResult,
  type DuplicateControlRegistryRecord,
  type DuplicateControlResult,
} from '@/lib/duplicate-control-types'
import { getDateInputValidationReason, parseDateLikeToIso } from '@/lib/date-format'
import {
  getDispatcherDirtyScopes,
  markDispatcherTaskIndexDirty,
} from '@/server/dispatcher-task-index-dirty'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import { assertSecurityScope } from '@/server/security-functions'
import { syncSystemDocumentsForWeldChangesInTransaction } from '@/server/system-document-index'
import { assertStoredEarlyCoilDecisionSourcesRemainValid } from '@/server/early-coil-decision-guard'
import { getNextTimestampVersion } from '@/server/timestamp-version'
import { loadWeldWorkflowSettingsFromTransaction } from '@/server/weld-workflow-settings'
import { getLnkRepairResultSaveReason } from '@/lib/lnk-result-rules'
import { formatSaveCheckBlockReason, type SaveCheckSettings } from '@/lib/save-check-settings'
import type { SystemIndexSettings } from '@/lib/system-index-settings'
import type { WeldInput } from '@/lib/weld-fields'
import { prepareReportRows } from '@/lib/use-report-rows'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { persistCalculatedFinalStatuses } from '@/server/final-status-persistence'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { ensureDispatcherTaskIndexFresh } from '@/server/dispatcher-task-index'
import {
  applyCurrentSystemWdi,
  loadServerOtherSettings,
  WELD_EFFECTIVE_OFFICIALITY,
  WELDING_JOURNAL_ORDER_BY,
} from '@/server/weld-server-shared'
import { buildNumberArrayMatch, compactWeldRowsForTransport } from '@/server/weld-request-utils'

export type DuplicateControlPayload = {
  id?: number
  expectedVersion?: string
  weldJointId: number
  method: DuplicateControlMethod
  result: DuplicateControlResult
  controlDate: string
  conclusion: string
  conclusionDate: string
}

const methodSet = new Set<string>(DUPLICATE_CONTROL_METHODS)
const resultSet = new Set<string>(DUPLICATE_CONTROL_RESULTS)
const DUPLICATE_CONTROL_INSERT_BATCH_SIZE = 500
const DUPLICATE_CONTROL_MAX_SAVE_RECORDS =
  DUPLICATE_CONTROL_MASS_SELECTION_LIMIT * DUPLICATE_CONTROL_METHODS.length

const DUPLICATE_CONTROL_UPDATE_FIELDS = [
  'weldJointId',
  'method',
  'result',
  'controlDate',
  'conclusion',
  'conclusionDate',
  'updatedAt',
] as const satisfies readonly (keyof NewDuplicateControl)[]

const DUPLICATE_CONTROL_COLUMN_NAMES: Record<(typeof DUPLICATE_CONTROL_UPDATE_FIELDS)[number], string> = {
  weldJointId: 'weld_joint_id',
  method: 'method',
  result: 'result',
  controlDate: 'control_date',
  conclusion: 'conclusion',
  conclusionDate: 'conclusion_date',
  updatedAt: 'updated_at',
}

const DUPLICATE_CONTROL_UPDATE_SET = Object.fromEntries(
  DUPLICATE_CONTROL_UPDATE_FIELDS.map((field) => [
    field,
    sql.raw(`excluded."${DUPLICATE_CONTROL_COLUMN_NAMES[field]}"`),
  ]),
) as Partial<Record<keyof NewDuplicateControl, SQL>>

const DUPLICATE_CONTROL_CANDIDATE_SELECT = {
  id: weldJoints.id,
  weldDate: weldJoints.weldDate,
  projectTitle: weldJoints.projectTitle,
  subtitleCode: weldJoints.subtitleCode,
  line: weldJoints.line,
  spool: weldJoints.spool,
  joint: weldJoints.joint,
  officiality: WELD_EFFECTIVE_OFFICIALITY.as('officiality'),
  connectionType: weldJoints.connectionType,
  d1: weldJoints.d1,
  d2: weldJoints.d2,
  t1: weldJoints.t1,
  t2: weldJoints.t2,
  wdi: weldJoints.wdi,
  finalStatus: weldJoints.finalStatus,
}

export const listDuplicateControlCandidatePage = createServerFn({ method: 'POST' })
  .validator((data: DuplicateControlCandidatePageRequest | undefined) =>
    normalizeDuplicateControlPageRequest(data),
  )
  .handler(async ({ data }): Promise<DuplicateControlCandidatePageResult> => {
    await assertSecurityScope('entry')
    return loadDuplicateControlCandidatePage(data)
  })

export const listDuplicateControlCandidateIds = createServerFn({ method: 'POST' })
  .validator((data: Pick<DuplicateControlCandidatePageRequest, 'search'> | undefined) => ({
    search: normalizeDuplicateControlSearch(data?.search),
  }))
  .handler(async ({ data }): Promise<number[]> => {
    await assertSecurityScope('entry')
    return loadDuplicateControlCandidateIds(data.search)
  })

export const listDuplicateControlCandidateRowsByIds = createServerFn({ method: 'POST' })
  .validator((data: { ids?: number[] } | undefined) => ({
    ids: Array.from(new Set((data?.ids ?? []).map(Number)))
      .filter((id) => Number.isInteger(id) && id > 0),
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    return loadDuplicateControlCandidateRowsByIds(data.ids)
  })

export const listDuplicateControlRegistryPage = createServerFn({ method: 'POST' })
  .validator((data: DuplicateControlRegistryPageRequest | undefined) =>
    normalizeDuplicateControlPageRequest(data),
  )
  .handler(async ({ data }): Promise<DuplicateControlRegistryPageResult> => {
    await assertSecurityScope('entry')
    return loadDuplicateControlRegistryPage(data)
  })

export async function loadDuplicateControlCandidatePage(
  input: DuplicateControlCandidatePageRequest | undefined,
): Promise<DuplicateControlCandidatePageResult> {
  const data = normalizeDuplicateControlPageRequest(input)
  await ensureDispatcherTaskIndexFresh()
  const db = requireDb()
  const where = buildDuplicateControlCandidateSearchWhere(data.search)
  const countQuery = data.page === 1
    ? db.select({ total: count() }).from(weldJoints).where(where)
    : Promise.resolve([])
  const [otherSettings, [countRow], fetchedRows] = await Promise.all([
    loadServerOtherSettings(),
    countQuery,
    db
      .select(DUPLICATE_CONTROL_CANDIDATE_SELECT)
      .from(weldJoints)
      .where(where)
      .orderBy(...WELDING_JOURNAL_ORDER_BY)
      .limit(data.pageSize + 1)
      .offset((data.page - 1) * data.pageSize),
  ])
  const pageRows = fetchedRows.slice(0, data.pageSize)
  const sourceRows = applyCurrentSystemWdi(pageRows, otherSettings)
  const rows = await attachDuplicateControlRelations(sourceRows)

  return {
    rows: compactWeldRowsForTransport(rows),
    ...(countRow ? { totalCount: Number(countRow.total) || 0 } : {}),
    page: data.page,
    pageSize: data.pageSize,
    hasMore: fetchedRows.length > data.pageSize,
  }
}

export async function loadDuplicateControlCandidateIds(search: unknown): Promise<number[]> {
  const normalizedSearch = normalizeDuplicateControlSearch(search)
  const rows = await buildDuplicateControlCandidateIdsQuery(requireDb(), normalizedSearch)
  assertDuplicateControlSelectionLimit(rows.length)
  return rows.map((row) => row.id)
}

export function buildDuplicateControlCandidateIdsQuery(
  db: Pick<ReturnType<typeof requireDb>, 'select'>,
  search: string,
) {
  return db
    .select({ id: weldJoints.id })
    .from(weldJoints)
    .where(buildDuplicateControlCandidateSearchWhere(search))
    .orderBy(...WELDING_JOURNAL_ORDER_BY)
    .limit(DUPLICATE_CONTROL_MASS_SELECTION_LIMIT + 1)
}

export function assertDuplicateControlSelectionLimit(count: number) {
  if (count > DUPLICATE_CONTROL_MASS_SELECTION_LIMIT) {
    throw new Error(DUPLICATE_CONTROL_MASS_SELECTION_ERROR)
  }
}

export function assertDuplicateControlSaveBatchLimit(recordCount: number) {
  if (recordCount > DUPLICATE_CONTROL_MAX_SAVE_RECORDS) {
    throw new Error('Слишком много записей дубль-контроля для одного сохранения. Уточните выбор стыков.')
  }
}

export async function loadDuplicateControlCandidateRowsByIds(ids: readonly number[]) {
  const normalizedIds = Array.from(new Set(ids.map(Number)))
    .filter((id) => Number.isInteger(id) && id > 0)
  assertDuplicateControlSelectionLimit(normalizedIds.length)
  if (normalizedIds.length === 0) return []
  await ensureDispatcherTaskIndexFresh()
  const [rows, otherSettings] = await Promise.all([
    requireDb()
      .select(DUPLICATE_CONTROL_CANDIDATE_SELECT)
      .from(weldJoints)
      .where(buildNumberArrayMatch(weldJoints.id, normalizedIds)),
    loadServerOtherSettings(),
  ])
  const orderById = new Map(normalizedIds.map((id, index) => [id, index]))
  rows.sort((left, right) => (
    (orderById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (orderById.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  ))
  return compactWeldRowsForTransport(
    await attachDuplicateControlRelations(applyCurrentSystemWdi(rows, otherSettings)),
  )
}

export async function loadDuplicateControlRegistryPage(
  input: DuplicateControlRegistryPageRequest | undefined,
): Promise<DuplicateControlRegistryPageResult> {
  const data = normalizeDuplicateControlPageRequest(input)
  const db = requireDb()
  const countQuery = data.page === 1
    ? db.select({ total: count() }).from(duplicateControls)
    : Promise.resolve([])
  const [countRows, fetchedRows] = await Promise.all([
    countQuery,
    db
      .select({
        id: duplicateControls.id,
        weldJointId: duplicateControls.weldJointId,
        method: duplicateControls.method,
        result: duplicateControls.result,
        controlDate: duplicateControls.controlDate,
        conclusion: duplicateControls.conclusion,
        conclusionDate: duplicateControls.conclusionDate,
        updatedAt: duplicateControls.updatedAt,
        projectTitle: weldJoints.projectTitle,
        subtitleCode: weldJoints.subtitleCode,
        line: weldJoints.line,
        spool: weldJoints.spool,
        joint: weldJoints.joint,
      })
      .from(duplicateControls)
      .innerJoin(weldJoints, eq(weldJoints.id, duplicateControls.weldJointId))
      .orderBy(asc(duplicateControls.weldJointId), asc(duplicateControls.id))
      .limit(data.pageSize + 1)
      .offset((data.page - 1) * data.pageSize),
  ])
  const countRow = countRows[0]
  return {
    rows: fetchedRows.slice(0, data.pageSize).map(toRegistryPayload),
    ...(countRow ? { totalCount: Number(countRow.total) || 0 } : {}),
    page: data.page,
    pageSize: data.pageSize,
    hasMore: fetchedRows.length > data.pageSize,
  }
}

export function normalizeDuplicateControlPageRequest(
  data: DuplicateControlCandidatePageRequest | DuplicateControlRegistryPageRequest | undefined,
) {
  const requestedPageSize = Math.floor(Number(data?.pageSize))
  const pageSize = DUPLICATE_CONTROL_PAGE_SIZE_OPTIONS.includes(
    requestedPageSize as (typeof DUPLICATE_CONTROL_PAGE_SIZE_OPTIONS)[number],
  )
    ? requestedPageSize as (typeof DUPLICATE_CONTROL_PAGE_SIZE_OPTIONS)[number]
    : 100
  return {
    search: normalizeDuplicateControlSearch(data && 'search' in data ? data.search : ''),
    page: Math.max(1, Math.floor(Number(data?.page)) || 1),
    pageSize,
  }
}

export function buildDuplicateControlCandidateSearchWhere(search: string) {
  if (!search) return sql`true`
  const pattern = `%${escapeLikePattern(search)}%`
  return or(
    ilike(weldJoints.projectTitle, pattern),
    ilike(weldJoints.subtitleCode, pattern),
    ilike(weldJoints.line, pattern),
    ilike(weldJoints.spool, pattern),
    ilike(weldJoints.joint, pattern),
  ) ?? sql`false`
}

function normalizeDuplicateControlSearch(value: unknown) {
  return String(value ?? '').trim().slice(0, 200)
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

export const saveDuplicateControl = createServerFn({ method: 'POST' })
  .validator((data: DuplicateControlPayload) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()
    const insertData = toDbInsert(data)
    return db.transaction(async (tx) => {
      await loadControlProcessSettingsFromTransaction(tx)
      const workflowSettings = await loadWeldWorkflowSettingsFromTransaction(tx)
      if (data.id) {
        const [reference] = await tx
          .select({ weldJointId: duplicateControls.weldJointId })
          .from(duplicateControls)
          .where(eq(duplicateControls.id, data.id))
          .limit(1)
        if (!reference) throw new Error(`Дубль-контроль ${data.id} не найден`)
        const lockedWeldRows = await lockWeldJointsForDuplicateControlChange(tx, [
          reference.weldJointId,
          insertData.weldJointId,
        ])
        assertDuplicateControlRepairAllowed(
          getLockedWeldJoint(lockedWeldRows, insertData.weldJointId),
          data,
          workflowSettings.saveCheckSettings,
          workflowSettings.systemIndexSettings,
        )
        const previous = await lockDuplicateControl(tx, data.id)
        if (!previous) throw new Error(`Дубль-контроль ${data.id} не найден`)
        assertDuplicateControlVersion(previous, data.expectedVersion)
        const [updated] = await tx
          .update(duplicateControls)
          .set({ ...insertData, updatedAt: getNextTimestampVersion(previous.updatedAt) })
          .where(eq(duplicateControls.id, data.id))
          .returning()
        if (!updated) throw new Error(`Дубль-контроль ${data.id} не найден`)
        const affectedWeldJointIds = getDuplicateControlAffectedWeldJointIds(
          previous.weldJointId,
          updated.weldJointId,
        )
        await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, affectedWeldJointIds)
        const touchedRows = await touchLnkProfile(tx, affectedWeldJointIds)
        await markDispatcherTaskIndexDirty(tx, {
          scopes: getDispatcherDirtyScopes(touchedRows, new Map()),
        })
        return toPayload(updated)
      }

      const lockedWeldRows = await lockWeldJointsForDuplicateControlChange(tx, [insertData.weldJointId])
      assertDuplicateControlRepairAllowed(
        getLockedWeldJoint(lockedWeldRows, insertData.weldJointId),
        data,
        workflowSettings.saveCheckSettings,
        workflowSettings.systemIndexSettings,
      )
      const [created] = await tx.insert(duplicateControls).values(insertData).returning()
      await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, [created.weldJointId])
      const touchedRows = await touchLnkProfile(tx, [created.weldJointId])
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes(touchedRows, new Map()),
      })
      return toPayload(created)
    })
  })

export const saveDuplicateControls = createServerFn({ method: 'POST' })
  .validator((data: { records: DuplicateControlPayload[] }) => ({
    records: Array.isArray(data?.records) ? data.records : [],
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    if (data.records.length === 0) return []
    assertDuplicateControlSaveBatchLimit(data.records.length)
    assertDuplicateControlSelectionLimit(new Set(data.records.map((record) => record.weldJointId)).size)
    const prepared = data.records.map((record, index) => ({ record, insertData: toDbInsert(record), index }))
    const existingIds = prepared.flatMap(({ record }) => record.id ? [Number(record.id)] : [])
    if (new Set(existingIds).size !== existingIds.length) {
      throw new Error('Один дубль-контроль нельзя изменить несколько раз за одно сохранение.')
    }
    const db = requireDb()
    return db.transaction(async (tx) => {
      await loadControlProcessSettingsFromTransaction(tx)
      const workflowSettings = await loadWeldWorkflowSettingsFromTransaction(tx)
      const saved: Array<DuplicateControlRecord | undefined> = Array(prepared.length)
      const affectedWeldJointIds: number[] = []
      const updates = prepared
        .filter(({ record }) => Boolean(record.id))
        .sort((left, right) => Number(left.record.id) - Number(right.record.id))
      const updateIds = updates.map(({ record }) => Number(record.id))
      const updateReferences: Array<{ id: number; weldJointId: number }> = updateIds.length > 0
        ? await tx
          .select({ id: duplicateControls.id, weldJointId: duplicateControls.weldJointId })
          .from(duplicateControls)
          .where(buildNumberArrayMatch(duplicateControls.id, updateIds))
        : []
      if (updateReferences.length !== updateIds.length) {
        throw new Error('Один или несколько дубль-контролей больше не существуют. Обновите отчет.')
      }
      const lockedWeldRows = await lockWeldJointsForDuplicateControlChange(tx, [
        ...updateReferences.map((record) => record.weldJointId),
        ...prepared.map(({ insertData }) => insertData.weldJointId),
      ])
      const lockedWeldRowsById = new Map(lockedWeldRows.map((row) => [row.id, row]))
      for (const { record, insertData } of prepared) {
        assertDuplicateControlRepairAllowed(
          getLockedWeldJoint(lockedWeldRowsById, insertData.weldJointId),
          record,
          workflowSettings.saveCheckSettings,
          workflowSettings.systemIndexSettings,
        )
      }
      const lockedControls: DuplicateControl[] = updateIds.length > 0
        ? await tx
          .select()
          .from(duplicateControls)
          .where(buildNumberArrayMatch(duplicateControls.id, updateIds))
          .orderBy(asc(duplicateControls.id))
          .for('update')
        : []
      if (lockedControls.length !== updateIds.length) {
        throw new Error('Один или несколько дубль-контролей больше не существуют. Обновите отчет.')
      }
      const lockedControlsById = new Map(lockedControls.map((control) => [control.id, control]))
      const updateWrites = updates.map(({ record, insertData, index }) => {
        const previous = lockedControlsById.get(record.id!)
        if (!previous) throw new Error(`Дубль-контроль ${record.id} не найден`)
        assertDuplicateControlVersion(previous, record.expectedVersion)
        return { index, insertData, previous }
      })
      for (const { index, previous, updated } of await persistDuplicateControlUpdates(tx, updateWrites)) {
        saved[index] = toPayload(updated)
        affectedWeldJointIds.push(previous.weldJointId, updated.weldJointId)
      }

      const creates = prepared.filter(({ record }) => !record.id)
      for (const batch of splitDuplicateControlInsertBatches(creates)) {
        const createdRows = await tx
          .insert(duplicateControls)
          .values(batch.map(({ insertData }) => insertData))
          .returning()
        if (createdRows.length !== batch.length) {
          throw new Error('Не удалось сохранить все позиции дубль-контроля. Ничего не сохранено.')
        }
        createdRows.forEach((created, batchIndex) => {
          const preparedRecord = batch[batchIndex]
          saved[preparedRecord.index] = toPayload(created)
          affectedWeldJointIds.push(created.weldJointId)
        })
      }
      await assertStoredEarlyCoilDecisionSourcesRemainValid(
        tx,
        getDuplicateControlAffectedWeldJointIds(...affectedWeldJointIds),
      )
      const touchedRows = await touchLnkProfile(
        tx,
        getDuplicateControlAffectedWeldJointIds(...affectedWeldJointIds),
      )
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes(touchedRows, new Map()),
      })
      return saved.filter((record): record is DuplicateControlRecord => Boolean(record))
    })
  })

export const deleteDuplicateControl = createServerFn({ method: 'POST' })
  .validator((data: { id: number; expectedVersion: string }) => ({
    id: Number(data?.id),
    expectedVersion: String(data?.expectedVersion ?? '').trim(),
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('delete')
    const db = requireDb()
    await db.transaction(async (tx) => {
      await loadControlProcessSettingsFromTransaction(tx)
      const [reference] = await tx
        .select({ weldJointId: duplicateControls.weldJointId })
        .from(duplicateControls)
        .where(eq(duplicateControls.id, data.id))
        .limit(1)
      if (!reference) throw new Error(`Дубль-контроль ${data.id} не найден`)
      await lockWeldJointsForDuplicateControlChange(tx, [reference.weldJointId])
      const previous = await lockDuplicateControl(tx, data.id)
      if (!previous) throw new Error(`Дубль-контроль ${data.id} не найден`)
      assertDuplicateControlVersion(previous, data.expectedVersion)
      const [deleted] = await tx
        .delete(duplicateControls)
        .where(eq(duplicateControls.id, data.id))
        .returning({ weldJointId: duplicateControls.weldJointId })
      if (deleted) {
        await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, [deleted.weldJointId])
        const touchedRows = await touchLnkProfile(tx, [deleted.weldJointId])
        await markDispatcherTaskIndexDirty(tx, {
          scopes: getDispatcherDirtyScopes(touchedRows, new Map()),
        })
      }
    })
    return { ok: true }
  })

function toDbInsert(record: DuplicateControlPayload): NewDuplicateControl {
  if (!Number.isInteger(record.weldJointId) || record.weldJointId <= 0) {
    throw new Error('Не выбран стык для дубль-контроля')
  }
  if (!methodSet.has(record.method)) throw new Error('Выберите метод дубль-контроля')
  if (!resultSet.has(record.result)) throw new Error('Выберите результат дубль-контроля')

  return {
    weldJointId: record.weldJointId,
    method: record.method,
    result: record.result,
    controlDate: normalizeDuplicateControlDate(record.controlDate, 'Дата контроля дубль-контроля'),
    conclusion: textOrNull(record.conclusion),
    conclusionDate: normalizeDuplicateControlDate(record.conclusionDate, 'Дата заключения дубль-контроля'),
  }
}

function toPayload(row: DuplicateControl): DuplicateControlRecord {
  return {
    id: row.id,
    version: row.updatedAt.toISOString(),
    weldJointId: row.weldJointId,
    method: row.method as DuplicateControlMethod,
    result: row.result as DuplicateControlResult,
    controlDate: row.controlDate ?? '',
    conclusion: row.conclusion ?? '',
    conclusionDate: row.conclusionDate ?? '',
  }
}

function toRegistryPayload(row: {
  id: number
  weldJointId: number
  method: string
  result: string
  controlDate: string | null
  conclusion: string | null
  conclusionDate: string | null
  updatedAt: Date
  projectTitle: string | null
  subtitleCode: string | null
  line: string | null
  spool: string | null
  joint: string | null
}): DuplicateControlRegistryRecord {
  return {
    id: row.id,
    version: row.updatedAt.toISOString(),
    weldJointId: row.weldJointId,
    method: row.method as DuplicateControlMethod,
    result: row.result as DuplicateControlResult,
    controlDate: row.controlDate ?? '',
    conclusion: row.conclusion ?? '',
    conclusionDate: row.conclusionDate ?? '',
    projectTitle: row.projectTitle ?? '',
    subtitleCode: row.subtitleCode ?? '',
    line: row.line ?? '',
    spool: row.spool ?? '',
    joint: row.joint ?? '',
  }
}

export function assertDuplicateControlVersion(
  row: Pick<DuplicateControl, 'updatedAt'>,
  expectedVersion: unknown,
) {
  if (
    !String(expectedVersion ?? '').trim() ||
    String(expectedVersion).trim() !== row.updatedAt.toISOString()
  ) {
    throw new Error(
      'Дубль-контроль уже изменен другим пользователем или в другом окне. Ничего не сохранено. Обновите отчет и повторите действие.',
    )
  }
}

function textOrNull(value: unknown) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

export function normalizeDuplicateControlDate(value: unknown, label = 'Дата дубль-контроля') {
  const text = String(value ?? '').trim()
  if (!text) return null
  const iso = parseDateLikeToIso(text)
  if (!iso) throw new Error(`Некорректная дата дубль-контроля: ${text}`)
  const reason = getDateInputValidationReason(iso, label)
  if (reason) throw new Error(reason)
  return iso
}

export function getDuplicateControlAffectedWeldJointIds(...values: number[]) {
  return [...new Set(values.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
}

export function splitDuplicateControlInsertBatches<T>(records: readonly T[]) {
  const batches: T[][] = []
  for (let start = 0; start < records.length; start += DUPLICATE_CONTROL_INSERT_BATCH_SIZE) {
    batches.push(records.slice(start, start + DUPLICATE_CONTROL_INSERT_BATCH_SIZE))
  }
  return batches
}

export type DuplicateControlUpdateWrite = {
  index: number
  insertData: NewDuplicateControl
  previous: DuplicateControl
}

export async function persistDuplicateControlUpdates(
  tx: Pick<Parameters<Parameters<ReturnType<typeof requireDb>['transaction']>[0]>[0], 'insert'>,
  writes: DuplicateControlUpdateWrite[],
) {
  const results: Array<DuplicateControlUpdateWrite & { updated: DuplicateControl }> = []
  for (const batch of splitDuplicateControlInsertBatches(writes)) {
    const updatedRows = await tx
      .insert(duplicateControls)
      .values(batch.map(({ insertData, previous }) => ({
        ...insertData,
        id: previous.id,
        createdAt: previous.createdAt,
        updatedAt: getNextTimestampVersion(previous.updatedAt),
      })))
      .onConflictDoUpdate({
        target: duplicateControls.id,
        set: DUPLICATE_CONTROL_UPDATE_SET,
      })
      .returning()
    if (updatedRows.length !== batch.length) {
      throw new Error('Не удалось изменить все позиции дубль-контроля. Ничего не сохранено.')
    }
    const updatedById = new Map(updatedRows.map((row) => [row.id, row]))
    for (const write of batch) {
      const updated = updatedById.get(write.previous.id)
      if (!updated) throw new Error(`Дубль-контроль ${write.previous.id} уже изменен. Обновите отчет.`)
      results.push({ ...write, updated })
    }
  }
  return results
}

async function lockDuplicateControl(
  tx: Parameters<Parameters<ReturnType<typeof requireDb>['transaction']>[0]>[0],
  id: number,
) {
  const [row] = await tx
    .select()
    .from(duplicateControls)
    .where(eq(duplicateControls.id, id))
    .for('update')
    .limit(1)
  return row ?? null
}

async function lockWeldJointsForDuplicateControlChange(
  tx: Parameters<Parameters<ReturnType<typeof requireDb>['transaction']>[0]>[0],
  weldJointIds: number[],
) {
  const ids = getDuplicateControlAffectedWeldJointIds(...weldJointIds).sort((left, right) => left - right)
  if (ids.length === 0) return []
  const rows = await tx
    .select()
    .from(weldJoints)
    .where(buildNumberArrayMatch(weldJoints.id, ids))
    .orderBy(asc(weldJoints.id))
    .for('update')
  if (rows.length !== ids.length) {
    throw new Error('Один или несколько стыков больше не существуют. Обновите отчет.')
  }
  return rows
}

function getLockedWeldJoint<T extends { id: number }>(
  rows: readonly T[] | ReadonlyMap<number, T>,
  weldJointId: number,
) {
  const row = Array.isArray(rows)
    ? (rows as readonly T[]).find((candidate) => candidate.id === weldJointId)
    : (rows as ReadonlyMap<number, T>).get(weldJointId)
  if (!row) throw new Error('Стык для дубль-контроля больше не существует. Обновите отчет.')
  return row
}

export function assertDuplicateControlRepairAllowed(
  row: WeldInput,
  control: Pick<DuplicateControlPayload, 'method' | 'result'>,
  saveCheckSettings: SaveCheckSettings,
  systemIndexSettings: SystemIndexSettings,
) {
  if (String(control.result ?? '').trim().toLowerCase() !== 'ремонт') return
  const reason = getLnkRepairResultSaveReason(
    row,
    `${control.method} (дубль)`,
    saveCheckSettings,
    systemIndexSettings,
  )
  if (reason) {
    throw new Error(`Сохранение невозможно: ${formatSaveCheckBlockReason('lnkResultRepairRules', reason)}`)
  }
}

async function touchLnkProfile(
  tx: Parameters<Parameters<ReturnType<typeof requireDb>['transaction']>[0]>[0],
  weldJointIds: number[],
) {
  const uniqueIds = [...new Set(weldJointIds)].sort((left, right) => left - right)
  if (uniqueIds.length === 0) return []
  const previousRows = await tx
    .select()
    .from(weldJoints)
    .where(buildNumberArrayMatch(weldJoints.id, uniqueIds))
  const now = new Date()
  const updatedRows = await tx
    .update(weldJoints)
    .set({
      lnkCreatedAt: sql`coalesce(${weldJoints.lnkCreatedAt}, ${now})`,
      lnkUpdatedAt: now,
      updatedAt: now,
    })
    .where(buildNumberArrayMatch(weldJoints.id, uniqueIds))
    .returning()
  await syncSystemDocumentsForWeldChangesInTransaction(
    tx,
    updatedRows,
    new Map(previousRows.map((row) => [row.id, row])),
  )
  await refreshWeldedFinalStatusesAfterDuplicateControlChange(tx, updatedRows)
  return updatedRows
}

export async function refreshWeldedFinalStatusesAfterDuplicateControlChange(
  tx: Parameters<Parameters<ReturnType<typeof requireDb>['transaction']>[0]>[0],
  rows: Array<typeof weldJoints.$inferSelect>,
) {
  // The same-name repair context only changes statuses of rows that have not
  // been welded yet. Limiting the synchronous refresh to welded rows keeps the
  // aggregate WDI exact without loading a global final-status context here.
  const weldedRows = rows.filter((row) => String(row.weldDate ?? '').trim().length > 0)
  if (weldedRows.length === 0) return 0
  const rowIds = weldedRows.map((row) => row.id)
  const rowsWithHeatTreatmentControls = await attachHeatTreatmentControlRelations(weldedRows, tx)
  const currentDuplicateControls = await tx
    .select()
    .from(duplicateControls)
    .where(buildNumberArrayMatch(duplicateControls.weldJointId, rowIds))
    .orderBy(asc(duplicateControls.weldJointId), asc(duplicateControls.id))
  const preparedRows = prepareReportRows(
    rowsWithHeatTreatmentControls,
    currentDuplicateControls.map(toPayload),
  )
  return persistCalculatedFinalStatuses(tx, weldedRows, preparedRows)
}
