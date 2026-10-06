import type { WeldRow } from './dispatcher-types'
import { normalizeControlAvailabilityStorageText } from './control-availability-values'

export const PROGRAM_APPROVAL_PREFIX = 'program-control:'
export type ProgramApprovalKind = 'common' | 'pvk'
const value = (input: unknown) => normalizeControlAvailabilityStorageText(input) ?? ''

/** A decision belongs to a joint and its methods, not a quota, name or welder. */
export function programApprovalKey(row: Partial<WeldRow> & { id: number }, kind: ProgramApprovalKind, duplicate: boolean) {
  const methods = kind === 'pvk' ? [value(row.hasPvk)] : [value(row.hasRk), value(row.hasUzk), row.layeredControlAssigned ? 'да' : '']
  return PROGRAM_APPROVAL_PREFIX + JSON.stringify([row.id, kind, duplicate, methods])
}

/** Converts only an existing saved decision, never creates approval from assignment/history. */
export function parseStoredProgramApproval(key: string) {
  try {
    const legacy = key.startsWith('line-program-excess:')
    if (!legacy && !key.startsWith(PROGRAM_APPROVAL_PREFIX)) return null
    const parts = JSON.parse(key.slice(legacy ? 'line-program-excess:'.length : PROGRAM_APPROVAL_PREFIX.length))
    if (!Array.isArray(parts)) return null
    const [id, kind, duplicate, methods] = legacy ? [parts[4], parts[2], parts[3], parts[7]] : parts
    if (!Number.isSafeInteger(id) || id <= 0 || !['common', 'pvk'].includes(kind) || typeof duplicate !== 'boolean' || !Array.isArray(methods)) return null
    const assignments = legacy ? (kind === 'pvk' ? [methods[2]] : [methods[0], methods[1], methods[3]]) : methods
    if (assignments.length !== (kind === 'pvk' ? 1 : 3) || assignments.some(item => !['', 'да', 'отменен', 'дополнительный'].includes(item))) return null
    return { rowId: id as number, kind: kind as ProgramApprovalKind, duplicate: duplicate as boolean,
      key: PROGRAM_APPROVAL_PREFIX + JSON.stringify([id, kind, duplicate, assignments]) }
  } catch { return null }
}
