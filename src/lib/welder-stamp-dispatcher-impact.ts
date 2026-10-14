import { normalizeStampForCompare } from './welder-stamp-compatibility-utils'
import { getAllWelderStampDlsPermits, getAllWelderStampNaksPermits } from './welder-stamp-permits'
import type { WelderStampNaksPermit, WelderStampRecord, WelderStampSuspensionRecord } from './welder-stamp-types'

export type WelderStampDispatcherImpact = {
  changed: boolean
  officialAliases: string[]
  /** Capture dependent decisions before these owners are deleted or renamed. */
  decisionOwnerIds: number[]
}

/** Compare the persisted snapshot with the prepared replacement, never the UI draft.
 * Card order and timestamps are irrelevant. Persisted metadata still changes
 * reminders, but only effective qualification changes invalidate joint tasks.
 */
export function getWelderStampDispatcherImpact(
  before: readonly WelderStampRecord[], after: readonly WelderStampRecord[],
): WelderStampDispatcherImpact {
  const previous = new Map(before.map(record => [record.id, record]))
  const next = new Map(after.map(record => [record.id, record]))
  const aliases = new Set<string>(), decisionOwnerIds: number[] = []
  let changed = false
  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    const old = previous.get(id), saved = next.get(id)
    if (old && saved && signature(cardProjection(old)) === signature(cardProjection(saved))) continue
    changed = true
    if (old && (!saved || old.naksStamp.trim() !== saved.naksStamp.trim())) decisionOwnerIds.push(id)
    if (!old || !saved || signature(qualificationProjection(old)) !== signature(qualificationProjection(saved))) {
      for (const record of [old, saved]) {
        const alias = normalizeStampForCompare(record?.naksStamp)
        if (alias) aliases.add(alias)
      }
    }
  }
  return { changed, officialAliases: [...aliases].sort(), decisionOwnerIds: decisionOwnerIds.sort((a, b) => a - b) }
}

export function getWelderStampSuspensionDispatcherImpact(
  before: readonly WelderStampSuspensionRecord[], after: readonly WelderStampSuspensionRecord[],
): WelderStampDispatcherImpact {
  const previous = new Map(before.map(record => [record.id, record]))
  const next = new Map(after.map(record => [record.id, record]))
  const aliases = new Set<string>()
  let changed = false
  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    const old = previous.get(id), saved = next.get(id)
    const projection = (record: WelderStampSuspensionRecord) => [record.naksStamp, record.suspendedFrom, record.suspendedTo]
    if (old && saved && signature(projection(old)) === signature(projection(saved))) continue
    changed = true
    for (const record of [old, saved]) {
      const alias = normalizeStampForCompare(record?.naksStamp)
      if (alias) aliases.add(alias)
    }
  }
  return { changed, officialAliases: [...aliases].sort(), decisionOwnerIds: [] }
}

function qualificationProjection(record: WelderStampRecord) {
  // Resolve meaningful permits and legacy fallback BEFORE dropping metadata:
  // a note-only NAKS suppresses fallback; a number-only DLS is still meaningful.
  // Keep order (alternative-method messages) and archived permits (historical
  // welds and missing-date checks). Generated fallback IDs are not dependencies.
  return [normalizeStampForCompare(record.naksStamp),
    getAllWelderStampNaksPermits(record).map(permitQualificationProjection),
    getAllWelderStampDlsPermits(record).map(permitQualificationProjection)]
}

function permitQualificationProjection(permit: WelderStampNaksPermit) {
  return [permit.weldType, permit.materialGroups, permit.diameterFrom, permit.diameterTo,
    permit.thicknessFrom, permit.thicknessTo, permit.validFrom, permit.validTo, permit.archived]
}

function cardProjection(record: WelderStampRecord) {
  // Do not use the reduced projection here: metadata edits must still persist
  // and refresh reminder identities/text and other registry-derived views.
  return [record.naksStamp, record.welderName, record.internalStamp, record.archived, record.archivedAt ?? '',
    record.weldType, record.materialGroups, record.diameterFrom, record.diameterTo,
    record.thicknessFrom, record.thicknessTo, record.validFrom, record.validTo,
    record.naksPermits, record.dlsPermits]
}

function signature(value: unknown): string {
  // JSON object property order must not turn a resubmitted snapshot into a change.
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
  })
}
