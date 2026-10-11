import { createServerFn } from '@tanstack/react-start'
import { sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { appSettings } from '@/db/schema'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { assertCreationGrouping, normalizeDocumentGroupingCommand, type DocumentGroupingCommand } from '@/lib/document-grouping-command'
import { ALL_LNK_FIELD_METHODS } from '@/lib/lnk-report-config'
import { getSystemDocumentSplitSettingId } from '@/lib/system-document-splitting'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildSystemDocumentSummaries, SYSTEM_DOCUMENT_TYPES } from '@/lib/system-document-types'
import { readRequestConclusionSettings, type SystemDocumentSequenceTransaction } from './system-document-sequences'
import { assertSecurityScope } from './security-functions'

export const getDocumentGroupingDefaults = createServerFn({ method: 'GET' }).handler(async () => {
  await assertSecurityScope('entry')
  return readRequestConclusionSettings(requireDb())
})

/** Take before counters/rows. Settings writers use this same lock. No separate settings permission is granted. */
export async function lockDocumentGroupingPreference(tx: SystemDocumentSequenceTransaction, input?: DocumentGroupingCommand) {
  const command = normalizeDocumentGroupingCommand(input)
  if (command) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${PROJECT_SETTING_KEYS.requestConclusion}))`)
  return command
}

/** Called only inside a successfully validated document mutation's transaction. */
export async function rememberDocumentGrouping(tx: SystemDocumentSequenceTransaction, command?: DocumentGroupingCommand) {
  if (!command) return
  const settings = await readRequestConclusionSettings(tx)
  if (settings.splitModes[command.settingId] === command.mode) return
  const value = JSON.stringify({ ...settings, splitModes: { ...settings.splitModes, [command.settingId]: command.mode } })
  await tx.insert(appSettings).values({ key: PROJECT_SETTING_KEYS.requestConclusion, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: sql`greatest(now(), ${appSettings.updatedAt} + interval '1 millisecond')` } })
}

export function validatePrimaryCreationGrouping(command: DocumentGroupingCommand | undefined, records: Array<{ id?: number }>, previous: ReadonlyMap<number, unknown>) {
  if (!command) return false
  const pairs = command.settingId === 'pstoRequest' ? [{ name: 'pstoRequest', date: 'pstoRequestDate' }]
    : command.settingId === 'pstoConclusion' ? [{ name: 'heatTreatmentDiagram', date: 'pstoDate' }]
    : ALL_LNK_FIELD_METHODS.flatMap(method => [
      ...(getSystemDocumentSplitSettingId({ type: 'lnkRequest', methodCode: method.code === 'ТВМТ' ? 'ТВМТ' : undefined }) === command.settingId ? [{ name: method.requestKey, date: method.requestDateKey }] : []),
      ...(getSystemDocumentSplitSettingId({ type: 'lnkConclusion', methodCode: method.code }) === command.settingId ? [{ name: method.conclusionKey, date: method.conclusionDateKey }] : []),
    ])
  const byDate = new Map<string, Map<string, { name: string; rows: Map<number, WeldRow> }>>()
  for (const record of records) {
    const row = record as unknown as WeldRow & Record<string, unknown>
    const before = previous.get(Number(row.id)) as Record<string, unknown> | undefined
    for (const pair of pairs) {
      const name = String(row[pair.name] ?? '').trim(), date = String(row[pair.date] ?? '').slice(0, 10)
      if (!name || name === String(before?.[pair.name] ?? '').trim() && date === String(before?.[pair.date] ?? '').slice(0, 10)) continue
      const groups = byDate.get(date) ?? new Map()
      const key = name.toLocaleLowerCase('ru')
      const group = groups.get(key) ?? { name, rows: new Map() }
      group.rows.set(row.id, row); groups.set(key, group); byDate.set(date, groups)
    }
  }
  for (const groups of byDate.values()) assertCreationGrouping([...groups.values()].map(group => ({ name: group.name, rows: [...group.rows.values()] })), command.mode)
  return byDate.size > 0
}

export function primaryCreationReferences(command: DocumentGroupingCommand, records: Array<{ id?: number }>, previous: ReadonlyMap<number, unknown>) {
  const byId = new Map(records.map(record => [record.id, record as unknown as Record<string, unknown>]))
  return SYSTEM_DOCUMENT_TYPES.flatMap(type => buildSystemDocumentSummaries(records as WeldRow[], type))
    .filter(doc => {
      if (getSystemDocumentSplitSettingId(doc) !== command.settingId) return false
      const pairs = doc.type === 'pstoRequest' ? [['pstoRequest', 'pstoRequestDate']] : doc.type === 'pstoConclusion' ? [['heatTreatmentDiagram', 'pstoDate']]
        : ALL_LNK_FIELD_METHODS.filter(method => doc.type === 'lnkConclusion' ? method.code === doc.methodCode : (method.code === 'ТВМТ') === (doc.methodCode === 'ТВМТ'))
          .map(method => doc.type === 'lnkRequest' ? [method.requestKey, method.requestDateKey] : [method.conclusionKey, method.conclusionDateKey])
      return doc.rowIds.some(id => {
        const row = byId.get(id)!, before = previous.get(id) as Record<string, unknown> | undefined
        return pairs.some(([name, date]) => String(row[name] ?? '').trim() === doc.title && String(row[date] ?? '').slice(0, 10) === doc.date &&
          (String(before?.[name] ?? '').trim() !== doc.title || String(before?.[date] ?? '').slice(0, 10) !== doc.date))
      })
    })
}
