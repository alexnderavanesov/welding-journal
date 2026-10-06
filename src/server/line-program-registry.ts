import { sql } from 'drizzle-orm'
import { linePrograms, type LineProgram } from '@/db/schema'
import type { WeldInput } from '@/lib/weld-fields'
import {
  getLineProgramConfigurationIssue, getLineProgramIdentityKey, getLineProgramMetadataConflicts,
  normalizeLineProgramIdentity, type LineProgramProperties,
} from '@/lib/line-program'
import { parseLineProgramPercent } from '@/lib/line-program-calculation'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import { lockWeldLineMemberships } from '@/server/weld-line-membership-lock'

type RegistryTransaction = SystemDocumentSequenceTransaction
const BATCH_SIZE = 500

export async function loadLineProgramsForIdentities(tx: Pick<RegistryTransaction, 'select'>, records: readonly WeldInput[]) {
  const identities = [...new Map(records.filter((r) => String(r.line ?? '').trim()).map((r) =>
    [getLineProgramIdentityKey(r), normalizeLineProgramIdentity(r)])).values()]
  const result = new Map<string, LineProgram>()
  for (let offset = 0; offset < identities.length; offset += BATCH_SIZE) {
    const values = sql.join(identities.slice(offset, offset + BATCH_SIZE).map((r) =>
      sql`(${r.projectTitle.toLocaleLowerCase('ru')}, ${r.subtitleCode.toLocaleLowerCase('ru')}, ${r.line.toLocaleLowerCase('ru')})`), sql`, `)
    const lines = await tx.select().from(linePrograms).where(sql`(
      lower(btrim(${linePrograms.projectTitle})), lower(btrim(${linePrograms.subtitleCode})), lower(btrim(${linePrograms.line}))
    ) in (${values})`)
    for (const line of lines) result.set(getLineProgramIdentityKey(line), line)
  }
  return result
}

/** Only called in a mutation transaction; reads never create or repair the registry. */
export async function prepareLineProgramWeldRecords(
  tx: RegistryTransaction,
  records: readonly WeldInput[],
  previousRows: ReadonlyMap<number, WeldInput> = new Map(),
) {
  if (!records.length) return
  // Unchanged membership/metadata needs no registry query or late line lock.
  // Interactive row locks and versions already serialize it with program edits.
  records = records.filter((record) => {
    record.hasVik = 'да'
    const previous = previousRows.get(Number(record.id))
    return !previous?.lineProgramId || getLineProgramIdentityKey(previous) !== getLineProgramIdentityKey(record) ||
      (['category', 'groupName', 'weldControlPercent', 'pvkControlPercent', 'lineProgramId'] as const).some((key) => record[key] !== previous[key])
  })
  if (!records.length) return
  await lockWeldLineMemberships(tx, records)
  const programs = await loadLineProgramsForIdentities(tx, records)
  const newGroups = new Map<string, WeldInput[]>()
  for (const record of records) {
    if (!String(record.line ?? '').trim()) continue
    const key = getLineProgramIdentityKey(record)
    if (programs.has(key)) continue
    const group = newGroups.get(key) ?? []
    group.push(record)
    newGroups.set(key, group)
  }
  const newValues = [...newGroups.values()].map((group) => {
    const properties: LineProgramProperties = { category: null, groupName: null, weldControlPercent: null, pvkControlPercent: null }
    const conflicts: string[] = []
    for (const field of ['category', 'groupName', 'weldControlPercent'] as const) {
      const values = [...new Set(group.map((r) => String(r[field] ?? '').trim()).filter(Boolean))]
      if (field === 'weldControlPercent') {
        const parsed = values.map(parseLineProgramPercent)
        if (parsed.some((v) => v === null) || new Set(parsed).size > 1) conflicts.push('базовый процент')
        properties.weldControlPercent = parsed[0] ?? null
      } else {
        if (new Set(values.map((v) => v.toLocaleLowerCase('ru'))).size > 1) conflicts.push(field === 'category' ? 'категория' : 'группа')
        properties[field] = values[0] ?? null
      }
    }
    if (conflicts.length) throw new Error(`Программа линии «${group[0].line}»: противоречивые поля — ${conflicts.join(', ')}. Ничего не сохранено.`)
    properties.pvkControlPercent = properties.weldControlPercent
    return { ...normalizeLineProgramIdentity(group[0]), ...properties, configurationIssue: getLineProgramConfigurationIssue(properties) }
  })
  for (let offset = 0; offset < newValues.length; offset += BATCH_SIZE) {
    const created = await tx.insert(linePrograms).values(newValues.slice(offset, offset + BATCH_SIZE)).returning()
    for (const line of created) programs.set(getLineProgramIdentityKey(line), line)
  }
  const issues: string[] = []
  for (const record of records) {
    const program = programs.get(getLineProgramIdentityKey(record))
    if (!program) continue
    const conflicts = getLineProgramMetadataConflicts(record, program, previousRows.get(Number(record.id)))
    if (conflicts.length) {
      const labels = { category: 'категория', groupName: 'группа', weldControlPercent: 'базовый процент' }
      issues.push(`Стык «${record.joint ?? record.id ?? '?'}», линия «${program.line}»: ${conflicts.map((f) => labels[f]).join(', ')} не совпадают с программой линии.`)
    }
  }
  if (issues.length) throw new Error(issues.join('\n'))
  for (const record of records) {
    record.hasVik = 'да'
    const program = programs.get(getLineProgramIdentityKey(record))
    if (!program) { record.lineProgramId = null; record.pvkControlPercent = null; continue }
    record.lineProgramId = program.id
    record.category = program.category
    record.groupName = program.groupName
    record.weldControlPercent = program.weldControlPercent
    record.pvkControlPercent = program.pvkControlPercent
  }
}
