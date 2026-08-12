import { createServerFn } from '@tanstack/react-start'
import { eq, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  appSettings,
  weldJoints,
} from '@/db/schema'
import { DEFAULT_OTHER_SETTINGS, normalizeOtherSettings } from '@/lib/other-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import {
  buildWdiRecalculationPlan,
  getWdiCalculationSignature,
  type WdiRecalculationPreview,
  type WdiRecalculationRow,
} from '@/lib/wdi-recalculation'
import { invalidateDerivedCalculationCache } from '@/server/dispatcher-task-index-dirty'
import { assertSecurityScope } from '@/server/security-functions'

export type RecalculateWdiInput = {
  calculationSignature: string
  sourceSignature: string
}

const WDI_UPDATE_BATCH_SIZE = 500

export const previewWdiRecalculation = createServerFn({ method: 'GET' }).handler(async () => {
  await assertSecurityScope('entry')
  const db = requireDb()
  const [settings, rows] = await Promise.all([
    loadWdiSettings(db),
    loadWdiRows(db),
  ])
  return toPublicPreview(buildWdiRecalculationPlan(rows, settings), rows)
})

export const recalculateWdi = createServerFn({ method: 'POST' })
  .validator((data: RecalculateWdiInput) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('settings')
    return requireDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${PROJECT_SETTING_KEYS.other}))`)
      await tx.execute(sql`
        lock table "weld_joints", "generated_documents", "generated_document_weld_joints"
        in share row exclusive mode
      `)
      const settings = await loadWdiSettings(tx, true)
      if (getWdiCalculationSignature(settings) !== data.calculationSignature) {
        throw new Error('Настройки WDI изменились после предпросмотра. Обновите проверку и повторите пересчет.')
      }

      const rows = await loadWdiRows(tx, true)
      if (getWdiSourceSignature(rows) !== data.sourceSignature) {
        throw new Error('Стыки изменились после предпросмотра. Обновите проверку и повторите пересчет.')
      }
      const plan = buildWdiRecalculationPlan(rows, settings)
      for (let offset = 0; offset < plan.changes.length; offset += WDI_UPDATE_BATCH_SIZE) {
        const batch = plan.changes.slice(offset, offset + WDI_UPDATE_BATCH_SIZE)
        const values = sql.join(
          batch.map((change) => sql`(${change.id}::integer, ${change.wdi}::numeric)`),
          sql`, `,
        )
        await tx.execute(sql`
          update "weld_joints" as weld
          set
            "wdi" = recalculated.wdi::numeric,
            "welding_updated_at" = now(),
            "updated_at" = now()
          from (values ${values}) as recalculated(id, wdi)
          where weld."id" = recalculated.id
        `)
      }

      if (plan.changes.length > 0) {
        await tx.execute(sql`
          with totals as (
            select
              document."id" as document_id,
              coalesce(sum(weld."wdi"), 0)::numeric as wdi_total
            from "generated_documents" as document
            left join "generated_document_weld_joints" as assignment
              on assignment."document_id" = document."id"
            left join "weld_joints" as weld
              on weld."id" = assignment."weld_joint_id"
            group by document."id"
          )
          update "generated_documents" as document
          set
            "wdi_total" = totals.wdi_total,
            "updated_at" = now()
          from totals
          where document."id" = totals."document_id"
            and document."wdi_total" is distinct from totals.wdi_total
        `)
        await invalidateDerivedCalculationCache(tx)
      }

      return { updated: plan.changed }
    })
  })

type WdiDb = Pick<ReturnType<typeof requireDb>, 'select'>

async function loadWdiSettings(db: WdiDb, lock = false) {
  let query = db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PROJECT_SETTING_KEYS.other))
    .limit(1)
  if (lock) query = query.for('update') as typeof query
  const [setting] = await query
  if (!setting?.value) return DEFAULT_OTHER_SETTINGS
  try {
    return normalizeOtherSettings(JSON.parse(setting.value))
  } catch {
    return DEFAULT_OTHER_SETTINGS
  }
}

async function loadWdiRows(db: WdiDb, lock = false): Promise<WdiRecalculationRow[]> {
  let query = db
    .select({
      id: weldJoints.id,
      projectTitle: weldJoints.projectTitle,
      subtitleCode: weldJoints.subtitleCode,
      line: weldJoints.line,
      joint: weldJoints.joint,
      connectionType: weldJoints.connectionType,
      d1: weldJoints.d1,
      d2: weldJoints.d2,
      t1: weldJoints.t1,
      t2: weldJoints.t2,
      wdi: weldJoints.wdi,
    })
    .from(weldJoints)
    .orderBy(weldJoints.id)
  if (lock) query = query.for('update') as typeof query
  return query as Promise<WdiRecalculationRow[]>
}

function toPublicPreview(
  plan: ReturnType<typeof buildWdiRecalculationPlan>,
  rows: WdiRecalculationRow[],
): WdiRecalculationPreview {
  const { changes: _changes, ...preview } = plan
  return { ...preview, sourceSignature: getWdiSourceSignature(rows) }
}

function getWdiSourceSignature(rows: WdiRecalculationRow[]) {
  const serialized = JSON.stringify(rows)
  let first = 2166136261
  let second = 2246822519
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index)
    first = Math.imul(first ^ code, 16777619)
    second = Math.imul(second ^ code, 3266489917)
  }
  return `${serialized.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`
}
