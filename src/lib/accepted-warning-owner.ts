import { parseStoredProgramApproval } from './program-control-approval'
import { parseEarlyCoilDecisionKey } from './early-coil-decision'
import { getLineProgramIdentityKey, type LineProgramIdentity } from './line-program'

export type AcceptedWarningOwner =
  | { type: 'joint'; id: number }
  | { type: 'stamp'; id: number }
  | { type: 'line'; identity: LineProgramIdentity; stamp: string }
  | { type: 'joint-name'; identity: LineProgramIdentity; joint: string }

function firstJsonArray(key: string): unknown[] | null {
  const start = key.indexOf('[')
  let depth = 0, quoted = false, escaped = false
  for (let index = start; start >= 0 && index < key.length; index++) {
    const char = key[index]
    if (escaped) { escaped = false; continue }
    if (quoted && char === '\\') { escaped = true; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (quoted) continue
    if (char === '[') depth++
    if (char === ']' && --depth === 0) {
      try { const parts = JSON.parse(key.slice(start, index + 1)); return Array.isArray(parts) ? parts : null } catch { return null }
    }
  }
  return null
}

export function acceptedWarningOwner(warning: { key: string; kind: string; context: string | null }): AcceptedWarningOwner | null {
  const program = parseStoredProgramApproval(warning.key)
  if (program) return { type: 'joint', id: program.rowId }
  const coil = parseEarlyCoilDecisionKey(warning.key)
  if (coil) return { type: 'joint', id: coil.sourceRowId }
  if (warning.kind === 'welder-stamp-expiry') {
    const id = Number(warning.key.split(':')[2])
    return Number.isSafeInteger(id) && id > 0 ? { type: 'stamp', id } : null
  }
  if (warning.kind === 'percentage-line-control') {
    const parts = firstJsonArray(warning.key)
    if (parts?.length === 2 && typeof parts[0] === 'string' && typeof parts[1] === 'string') {
      try {
        const identity = JSON.parse(parts[0])
        if (Array.isArray(identity) && identity.length === 3 && identity.every(part => typeof part === 'string')) {
          return { type: 'line', identity: { projectTitle: identity[0], subtitleCode: identity[1], line: identity[2] }, stamp: parts[1] }
        }
      } catch { /* Older records may have a saved named context. */ }
    }
  }
  if (['create', 'coil', 'delete', 'rename', 'check'].includes(warning.kind)) {
    const idText = warning.key.match(/^(\d+):/)?.[1] ?? warning.key.match(/^rename-(?:obsolete|orphan-good):(\d+):/)?.[1]
      ?? warning.key.match(/^check-(?:chain|obsolete|obsolete-rename):.*:(\d+)$/)?.[1]
    if (idText && Number.isSafeInteger(Number(idText)) && Number(idText) > 0) return { type: 'joint', id: Number(idText) }
  }
  const parts = new Map((warning.context ?? '').split(' · ').flatMap(part => {
    const index = part.indexOf(':')
    return index > 0 ? [[part.slice(0, index).trim(), part.slice(index + 1).trim()]] : []
  }))
  const line = parts.get('Линия')
  if (!line) return null
  const identity = { projectTitle: parts.get('Проект') ?? '', subtitleCode: parts.get('Шифр') ?? '', line }
  if (['percentage-line-control', 'line-consistency'].includes(warning.kind)) return { type: 'line', identity, stamp: parts.get('Клеймо') ?? '' }
  const joint = parts.get('Стык')
  return joint ? { type: 'joint-name', identity, joint } : null
}

export const acceptedWarningLineKey = (owner: Extract<AcceptedWarningOwner, { identity: LineProgramIdentity }>) => getLineProgramIdentityKey(owner.identity)
