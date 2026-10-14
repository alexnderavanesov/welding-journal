import { eq, sql } from 'drizzle-orm'
import { appSettings, specialists } from '@/db/schema'
import { SPECIALIST_DEFAULTS_SETTING_KEY, parseSpecialistDefaults, availableSpecialistDefaults } from '@/lib/specialist-defaults'
import { getSpecialistDocumentProfile, resolveDocumentSpecialists, type SpecialistSelection } from '@/lib/document-specialists'
import { buildNumberArrayMatch } from './weld-request-utils'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

async function readDefaults(tx: Pick<SystemDocumentSequenceTransaction, 'select'>) {
  const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SPECIALIST_DEFAULTS_SETTING_KEY))
  return parseSpecialistDefaults(row?.value)
}

export async function readSpecialistDefaults(tx: Pick<SystemDocumentSequenceTransaction, 'select'>) {
  const defaults = await readDefaults(tx)
  const ids = [...new Set(Object.values(defaults).flatMap(pair => [pair.first, pair.second]).filter((id): id is number => typeof id === 'number'))]
  // At most twelve IDs for six methods; no query per role or document.
  const records = ids.length ? await tx.select().from(specialists).where(buildNumberArrayMatch(specialists.id, ids)) : []
  return { specialistDefaults: availableSpecialistDefaults(defaults, records), specialistDefaultRecords: records.filter(record => !record.archived) }
}

/** Uses the document-grouping settings lock and the successful creation transaction. */
export async function rememberSpecialistDefaults(tx: SystemDocumentSequenceTransaction, key: string, pair?: SpecialistSelection) {
  if (!pair) return
  const profile = getSpecialistDocumentProfile(key)
  if (!profile) throw new Error('Этот документ не поддерживает специалистов.')
  const ids = [...new Set([pair.first, pair.second].filter((id): id is number => typeof id === 'number'))].sort((a, b) => a - b)
  const records = ids.length ? await tx.select().from(specialists).where(buildNumberArrayMatch(specialists.id, ids)).orderBy(specialists.id).for('share') : []
  resolveDocumentSpecialists(null, pair, new Map(records.map(record => [record.id, record])), profile)
  const defaults = await readDefaults(tx)
  const common = { first: pair.first ?? null, second: pair.second ?? null }
  if (JSON.stringify(defaults[key as keyof typeof defaults]) === JSON.stringify(common)) return
  const value = JSON.stringify({ ...defaults, [key]: common })
  await tx.insert(appSettings).values({ key: SPECIALIST_DEFAULTS_SETTING_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: sql`greatest(now(), ${appSettings.updatedAt} + interval '1 millisecond')` } })
}
