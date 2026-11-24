import { and, asc, countDistinct, eq, isNull, ne, or, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { weldJoints, workClosures } from '@/db/schema'
import { closureDimensions, type ClosureDimension } from '@/lib/work-closure-columns'
import { compareClosureWorkTypes, preHeatWorkTypes, readClosureColumnFilters, withClosureColumnFilters, normalizeWorkClosure, replacedClosureFields, sameWorkClosure, workClosureTypeGroups, type WorkClosureChange, type WorkClosure } from '@/lib/work-closures'
import { buildPreHeatTreatmentAvailableWhere } from './pre-heat-treatment-policy'
import { workClosurePositionWhere } from './work-closure-query'
import { buildDispatcherTaskServerFilters } from '@/lib/dispatcher-task-row-codes'
import { lockWeldValidationSettings } from './weld-validation-settings-lock'
import { readServerDataLists } from './data-list-settings-policy'
import { requireContextPermission } from './access-payload'
import { assertSecurityScope } from './security-functions'
import { auditSql } from './audited-database'
import { invalidateDerivedCalculationCache } from './dispatcher-task-index-dirty'

function jointIds(values: number[]) {
  if (!Array.isArray(values) || !values.length || values.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Выберите стыки.')
  return [...new Set(values)]
}

export async function readClosures(values: number[]) {
  requireContextPermission('welding.view')
  requireContextPermission('closures.view')
  await assertSecurityScope('entry')
  const ids = jointIds(values)
  const db = requireDb()
  const [rows, { testTypes }, preHeatJoints] = await Promise.all([
    db.select().from(workClosures).where(sql`${workClosures.weldJointId} = any(${sql.param(ids)}::integer[])`)
      .orderBy(workClosures.weldJointId, workClosures.workType),
    readServerDataLists(db),
    db.select({ id: weldJoints.id }).from(weldJoints)
      .where(and(sql`${weldJoints.id} = any(${sql.param(ids)}::integer[])`, buildPreHeatTreatmentAvailableWhere())),
  ])
  return { rows, testTypes, preHeatIds: preHeatJoints.map(row => row.id) }
}

export async function readClosureValues() {
  requireContextPermission('welding.view')
  requireContextPermission('closures.view')
  await assertSecurityScope('entry')
  const db = requireDb()
  const distinctValues = async (column: typeof workClosures.rateCode | typeof workClosures.actNumber) => {
    const rows = await db.selectDistinct({ value: column }).from(workClosures).where(ne(column, '')).orderBy(column)
    return rows.map(row => row.value)
  }
  const [rateCode, actNumber] = await Promise.all([distinctValues(workClosures.rateCode), distinctValues(workClosures.actNumber)])
  return { rateCode, actNumber }
}

async function closureReportContext(columnFilters: Record<string, string>, dimension: ClosureDimension) {
  requireContextPermission('welding.view')
  requireContextPermission('closures.view')
  if (!closureDimensions.includes(dimension)) throw new Error('Неизвестный столбец закрытия работ.')
  const rest = withClosureColumnFilters(columnFilters, {})
  const filter = readClosureColumnFilters(columnFilters)
  const { journalReadContext, assertJournalContextRevision } = await import('./journal-grid')
  const context = await journalReadContext({ report: 'weldingJournal', columnFilters: buildDispatcherTaskServerFilters(rest),
    groupBy: [], route: [], start: 0, end: 1 })
  return { context, filter, rest, verify: () => assertJournalContextRevision(context) }
}

export async function readClosureFacet(columnFilters: Record<string, string>, dimension: ClosureDimension) {
  const { context, filter, rest, verify } = await closureReportContext(columnFilters, dimension)
  delete filter[dimension]
  if (dimension === 'rateCode') delete filter.rateAssigned
  if (dimension === 'workType') delete filter.noWorks
  if (filter.noWorks && dimension === 'actNumber') return { options: [], specialCount: 0 }
  const db = requireDb()
  const column = workClosures[dimension]
  const positions = workClosurePositionWhere(filter)
  const joints = countDistinct(weldJoints.id)
  const count = dimension === 'rateCode'
    ? sql`case when grouping(${column}) = 1 then ${joints} filter (where ${column} <> '') else ${joints} end`.mapWith(Number)
    : joints
  const query = db.select({ value: column, count }).from(weldJoints)
  const sameJoint = eq(workClosures.weldJointId, weldJoints.id)
  const joined = dimension === 'workType' ? query.leftJoin(workClosures, sameJoint) : query.innerJoin(workClosures, sameJoint)
  // The null group is a joint with no positions (work types), or the distinct subtotal (codes).
  // Keeping unmatched joints here also lets the user switch directly from a code/act to "no records".
  const rows = await joined.where(and(context.where, dimension === 'workType' && positions
    ? or(isNull(workClosures.weldJointId), positions) : positions))
    .groupBy(dimension === 'rateCode' ? sql`grouping sets ((${column}), ())` : column).orderBy(column)
  let specialCount = 0
  const options: { value: string; count: number }[] = []
  for (const row of rows) {
    if (row.value === null) specialCount = row.count
    else if (!filter.noWorks) options.push({ value: row.value, count: row.count })
  }
  if (dimension === 'workType') {
    if (!Object.keys(rest).length && !Object.keys(filter).length) {
      const [{ testTypes }, preHeatJoints] = await Promise.all([
        readServerDataLists(db),
        db.select({ id: weldJoints.id }).from(weldJoints).where(and(context.where, buildPreHeatTreatmentAvailableWhere())).limit(1),
      ])
      const used = new Set(options.map(option => option.value))
      for (const { options: types } of workClosureTypeGroups(testTypes, preHeatJoints.length > 0)) {
        for (const { value } of types) if (!used.has(value)) options.push({ value, count: 0 })
      }
    }
    options.sort((a, b) => compareClosureWorkTypes(a.value, b.value))
  }
  await verify()
  return { options, specialCount }
}

export async function readClosureSummary(columnFilters: Record<string, string>, dimension: ClosureDimension) {
  const { context, filter, verify } = await closureReportContext(columnFilters, dimension)
  if (filter.noWorks) return []
  const { actNumber, workType, rateCode } = workClosures
  const by = workClosures[dimension]
  const subtotal = sql<boolean>`grouping(${workType}, ${rateCode}, ${actNumber}) <> 0`
  const rows = await requireDb().select({ actNumber, workType, rateCode, subtotal, joints: countDistinct(workClosures.weldJointId) })
    .from(workClosures).innerJoin(weldJoints, eq(workClosures.weldJointId, weldJoints.id))
    .where(and(context.where, workClosurePositionWhere(filter)))
    .groupBy(sql`grouping sets ((${by}), (${workType}, ${rateCode}, ${actNumber}))`)
    .orderBy(by, sql`${subtotal} desc`, workType, rateCode, actNumber)
  await verify()
  return rows.sort((a, b) => {
    if (a[dimension] !== b[dimension]) {
      return dimension === 'workType' ? compareClosureWorkTypes(a.workType, b.workType) : a[dimension] < b[dimension] ? -1 : 1
    }
    return Number(b.subtotal) - Number(a.subtotal) || compareClosureWorkTypes(a.workType, b.workType)
  })
}

export async function writeClosures(changes: WorkClosureChange[], mode: 'card' | 'bulk', overwriteExisting = false) {
  requireContextPermission('welding.view')
  requireContextPermission('closures.edit')
  await assertSecurityScope('edit')
  if (!Array.isArray(changes)) throw new Error('Проверьте список работ.')
  const ids = jointIds(changes.map(change => change.weldJointId))
  if (mode === 'card' && ids.length !== 1) throw new Error('Карточка сохраняет один стык.')
  const unique = new Set<string>()
  const normalized = changes.map(change => {
    const before = change.before === null ? null : normalizeWorkClosure(change.before)
    const after = change.after === null ? null : normalizeWorkClosure(change.after)
    const key = [change.weldJointId, change.workType].join(':')
    if (unique.has(key) || !(before || after) || (before && before.workType !== change.workType) || (after && after.workType !== change.workType)) throw new Error('Проверьте виды работ в списке.')
    if (mode === 'bulk') {
      if (!after) throw new Error('Удалить работу можно в карточке стыка.')
      const replaced = replacedClosureFields(before, after)
      if (replaced.some(field => !after[field])) throw new Error('Очистить значение можно в карточке стыка.')
      if (replaced.length && !overwriteExisting) throw new Error('Для замены заполненных значений выберите «Перезаписать».')
    }
    unique.add(key)
    return { ...change, before, after }
  })
  return requireDb().transaction(async tx => {
    await lockWeldValidationSettings(tx)
    const locked = await tx.select({ id: weldJoints.id, preHeat: buildPreHeatTreatmentAvailableWhere() }).from(weldJoints)
      .where(sql`${weldJoints.id} = any(${sql.param(ids)}::integer[])`).orderBy(asc(weldJoints.id)).for('update')
    if (locked.length !== ids.length) throw new Error('Состав стыков изменился. Обновите журнал.')
    const scope = sql`${workClosures.weldJointId} = any(${sql.param(ids)}::integer[])`
    const readScope = () => tx.select().from(workClosures).where(scope).orderBy(workClosures.workType)
    const stored = await readScope()
    const current = new Map<string, WorkClosure>(stored.map(row => [[row.weldJointId, row.workType].join(':'), row]))
    const changed = normalized.filter(item => {
      const previous = current.get([item.weldJointId, item.workType].join(':')) ?? null
      if (sameWorkClosure(previous, item.after)) return false
      if (!sameWorkClosure(previous, item.before)) throw new Error('Закрытия изменились. Обновите данные и повторите сохранение.')
      return true
    })
    if (!changed.length) return { count: 0, rows: mode === 'card' ? stored : undefined }
    const preHeatIds = new Set(locked.filter(row => row.preHeat).map(row => row.id))
    if (changed.some(item => preHeatWorkTypes.has(item.workType) && !preHeatIds.has(item.weldJointId) && (mode === 'bulk' || !item.before))) {
      throw new Error('НК до ТО недоступен для выбранного стыка. Перечитайте данные и повторите сохранение.')
    }
    const newPositions = changed.filter(item => item.after && !item.before)
    if (newPositions.length) {
      const { testTypes } = await readServerDataLists(tx)
      const allowed = new Set(workClosureTypeGroups(testTypes, true).flatMap(group => group.options.map(option => option.value)))
      if (newPositions.some(item => !allowed.has(item.workType))) throw new Error('Выберите вид работы из актуального списка. Обновите данные и повторите сохранение.')
    }
    const rows = changed.map(({ weldJointId, workType, after }) => ({ id: weldJointId, work: workType, rate: after?.rateCode, act: after?.actNumber, remove: !after }))
    const input = sql`jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as entry(id integer, work text, rate text, act text, remove boolean)`
    await auditSql(tx, [{ table: workClosures, where: scope }], () => tx.execute(sql`
      with removed as (delete from ${workClosures} using ${input}
        where entry.remove and ${workClosures.weldJointId} = entry.id and ${workClosures.workType} = entry.work)
      insert into ${workClosures} (weld_joint_id, work_type, rate_code, act_number)
      select id, work, rate, act from ${input} where not remove
      on conflict (weld_joint_id, work_type) do update set rate_code = excluded.rate_code, act_number = excluded.act_number`))
    await invalidateDerivedCalculationCache(tx, { workClosuresOnly: true })
    return { count: changed.length, rows: mode === 'card' ? await readScope() : undefined }
  })
}
