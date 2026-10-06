import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { requireDb } from '@/db'
import { linePrograms, weldJoints } from '@/db/schema'
import { loadLineProgramRows, loadProgramSystemIndexSettings } from './line-program'
import { assertSecurityScope } from './security-functions'
import { getLineProgramConfigurationIssue } from '@/lib/line-program'
import { getProgramImpactInput, calculateProgramCardImpact } from '@/lib/line-program-card-impact'
import { loadProgramApprovals } from './program-approval-lifecycle'
import { attachProgramRepairRequirements } from '@/lib/line-program-repair-requirements'
import type { WeldInput } from '@/lib/weld-fields'

/** Explicit read-only preview; no calls on field edits, no dispatcher refresh. */
export const getWeldLineProgramImpact = createServerFn({ method: 'POST' })
  .validator((data: WeldInput) => {
    if (!Number.isSafeInteger(data?.id) || Number(data.id) <= 0) throw new Error('Для расчёта нужен сохранённый стык.')
    return getProgramImpactInput(data)
  })
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    return requireDb().transaction(async db => {
      const [joint] = await db.select({ lineProgramId: weldJoints.lineProgramId }).from(weldJoints).where(eq(weldJoints.id, data.id!)).limit(1)
      if (!joint?.lineProgramId) throw new Error('У стыка нет настроенной программы линии.')
      const [stored] = await db.select().from(linePrograms).where(eq(linePrograms.id, joint.lineProgramId)).limit(1)
      if (!stored) throw new Error('Программа линии больше не существует.')
      const line = { ...stored, version: stored.updatedAt.toISOString(), configurationIssue: stored.configurationIssue ?? getLineProgramConfigurationIssue(stored) }
      const rows = await loadLineProgramRows(db, line)
      const accepted = new Set((await loadProgramApprovals(db, rows.map(row => row.id))).map(row => row.key))
      return calculateProgramCardImpact(attachProgramRepairRequirements(rows, accepted, await loadProgramSystemIndexSettings(db)), data, line, accepted)
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
  })
