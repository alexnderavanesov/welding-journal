import { createServerFn } from '@tanstack/react-start'
import { asc } from 'drizzle-orm'
import { requireDb } from '@/db'
import { linePrograms } from '@/db/schema'
import { buildLineProgramReport, type ProgramReportLine } from '@/lib/line-program-report'
import { buildLineProgramDisplay } from '@/lib/line-program-display'
import { getProgramRemovalHints, projectProgramExcess } from '@/lib/line-program-excess'
import { summarizeLineProgram } from '@/lib/line-program-overview'
import { loadLineProgramCalculations, toLineProgramRecord } from './line-program'
import { assertSecurityScope } from './security-functions'
import { buildNumberArrayMatch } from './weld-request-utils'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { loadLineProgramWelderNames } from './line-program-welder-names'

export type ProgramReportRequest = { ids: number[]; mode: 'lines' | 'stamps'; context: string }
export const getLineProgramReport = createServerFn({ method: 'POST' })
  .validator((input: ProgramReportRequest) => {
    if (!Array.isArray(input.ids) || input.ids.length > 200_000 || input.ids.some(id => !Number.isSafeInteger(id) || id <= 0) || !['lines', 'stamps'].includes(input.mode)) throw new Error('Некорректный список линий для сводки.')
    return { ...input, ids: [...new Set(input.ids)], context: String(input.context ?? '').slice(0, 500) }
  })
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    return requireDb().transaction(tx => loadLineProgramReport(tx, data), { isolationLevel: 'repeatable read', accessMode: 'read only' })
  })

export async function loadLineProgramReport(tx: Pick<SystemDocumentSequenceTransaction, 'select'>, data: ProgramReportRequest) {
  const lines = data.ids.length ? await tx.select().from(linePrograms).where(buildNumberArrayMatch(linePrograms.id, data.ids)).orderBy(asc(linePrograms.projectTitle), asc(linePrograms.subtitleCode), asc(linePrograms.line), asc(linePrograms.id)) : []
  if (lines.length !== data.ids.length) throw new Error('Часть линий удалена. Обновите программу и сформируйте сводку заново.')
  const { calculations, accepted, systemIndexSettings } = await loadLineProgramCalculations(tx, lines.map(toLineProgramRecord))
  const result: ProgramReportLine[] = calculations.map(({ line, rows, calculations }) => {
    const configured = !line.configurationIssue && line.weldControlPercent != null && line.pvkControlPercent != null
    const removalHints = configured ? getProgramRemovalHints(line.id, rows, calculations, accepted) : undefined
    return { line,
      overview: summarizeLineProgram(rows, line, accepted, calculations, systemIndexSettings, removalHints),
      stamps: data.mode === 'stamps' && configured
        ? buildLineProgramDisplay(rows, projectProgramExcess(line.id, rows, calculations, accepted), line.weldControlPercent!, line.pvkControlPercent!, removalHints).stampRows : [],
    }
  })
  if (data.mode === 'stamps') {
    const names = await loadLineProgramWelderNames(tx, [...new Set(result.flatMap(item => item.stamps.map(stamp => stamp.stamp)))])
    for (const item of result) for (const stamp of item.stamps) stamp.welderName = names.get(stamp.stamp.trim().toUpperCase()) ?? ''
  }
  return buildLineProgramReport(result, data.mode, data.context)
}
