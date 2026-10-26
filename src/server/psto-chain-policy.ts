import { and, eq, isNull } from 'drizzle-orm'
import { linePrograms, pstoChainExceptions, type LineProgram } from '@/db/schema'
import type { WeldInput } from '@/lib/weld-fields'
import { getPstoLineIdentityKey, type PstoLineAssignmentState } from '@/lib/psto-line-assignment'
import type { PstoLinePolicy } from '@/lib/psto-chain-policy'
import { getPstoChainDecision, getPstoChainRoot, getPstoProgramState } from '@/lib/psto-chain-policy'
import type { SystemIndexSettings } from '@/lib/system-index-settings'
import { getLineProgramIdentityKey } from '@/lib/line-program'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { loadLineProgramsForIdentities, prepareLineProgramWeldRecords } from './line-program-registry'
import { buildNumberArrayMatch } from './weld-request-utils'

type Reader = Pick<SystemDocumentSequenceTransaction, 'select'>

/** Batched program reads and one active-decision read, never per joint. */
export async function overlayPstoProgramPolicies(db: Reader, rows: readonly WeldInput[], policies: Map<string, PstoLinePolicy>, knownPrograms?: ReadonlyMap<string, LineProgram>) {
  const programs = knownPrograms ?? await loadLineProgramsForIdentities(db, rows)
  if (!programs.size) return policies
  const exceptions = await db.select().from(pstoChainExceptions).where(and(
    buildNumberArrayMatch(pstoChainExceptions.lineProgramId, [...programs.values()].map(p => p.id)),
    isNull(pstoChainExceptions.closedAt),
  ))
  const byProgram = new Map<number, Map<string, typeof exceptions[number]>>()
  for (const exception of exceptions) {
    const group = byProgram.get(exception.lineProgramId) ?? new Map()
    group.set(exception.rootJoint, exception)
    byProgram.set(exception.lineProgramId, group)
  }
  for (const program of programs.values()) {
    const key = getPstoLineIdentityKey(program)
    const old = policies.get(key) ?? { rowCount: 0, assignedCount: 0 }
    policies.set(key, { ...old, programState: program.pstoAssignment,
      ...(program.pstoAssignment ? { cancellationDate: program.pstoCancellationDate ?? '', cancellationBasis: program.pstoCancellationBasis ?? '' } : {}),
      exceptions: byProgram.get(program.id) ?? new Map() })
  }
  return policies
}

/** Caller holds the line membership lock. Legacy state is captured BEFORE the
 * first exception changes any joint, so exceptions cannot redefine the baseline. */
export async function ensurePstoProgram(tx: SystemDocumentSequenceTransaction, rows: readonly WeldInput[], state: PstoLineAssignmentState) {
  if (!rows.length || state === 'mixed') throw new Error('Сначала задайте однозначное назначение ПСТО линии.')
  const key = getLineProgramIdentityKey(rows[0])
  let program = (await loadLineProgramsForIdentities(tx, [rows[0]])).get(key)
  if (!program) {
    const records = rows.map(row => ({ ...row }))
    await prepareLineProgramWeldRecords(tx, records)
    program = (await loadLineProgramsForIdentities(tx, [rows[0]])).get(key)
  }
  if (!program) throw new Error('Программа линии больше не найдена.')
  if (program.pstoAssignment) return program
  const dates = rows.map(row => String(row.pstoCancellationDate ?? '')).filter(Boolean).sort()
  const [saved] = await tx.update(linePrograms).set({ pstoAssignment: state,
    pstoCancellationDate: state === 'cancelled' ? dates.at(-1) || null : null,
    pstoCancellationBasis: state === 'cancelled' ? String(rows.find(row => row.pstoControlBasis)?.pstoControlBasis ?? '') || null : null,
    updatedAt: new Date(),
  }).where(eq(linePrograms.id, program.id)).returning()
  return saved
}

export async function setPstoProgram(tx: SystemDocumentSequenceTransaction, program: LineProgram, state: Exclude<PstoLineAssignmentState, 'mixed'>, cancellationDate = '', cancellationBasis = '') {
  await tx.update(linePrograms).set({ pstoAssignment: state,
    pstoCancellationDate: state === 'cancelled' ? cancellationDate || null : null,
    pstoCancellationBasis: state === 'cancelled' ? cancellationBasis || null : null, updatedAt: new Date(),
  }).where(eq(linePrograms.id, program.id))
  // Matching decisions cease to be exceptions and must never revive implicitly.
  await tx.delete(pstoChainExceptions)
    .where(and(eq(pstoChainExceptions.lineProgramId, program.id), isNull(pstoChainExceptions.closedAt), eq(pstoChainExceptions.required, state === 'assigned')))
}

export async function movePstoChainException(tx: SystemDocumentSequenceTransaction, source: WeldInput, target: WeldInput,
  targetRows: readonly WeldInput[], policies: ReadonlyMap<string, PstoLinePolicy>, settings: SystemIndexSettings) {
  const sourcePolicy = policies.get(getPstoLineIdentityKey(source))
  const exception = getPstoChainDecision(sourcePolicy, source.joint, settings)
  if (!exception) return new Map(policies)
  const targetPolicy = policies.get(getPstoLineIdentityKey(target))
  const targetState = getPstoProgramState(targetPolicy)
  if (targetState === 'mixed') throw new Error('Назначение ПСТО целевой линии противоречиво. Сначала уточните программу линии.')
  if (getPstoChainDecision(targetPolicy, target.joint, settings)) throw new Error('На целевой линии уже сохранено исключение для этого номера цепочки. Сначала проверьте его в «Программе ПСТО».')
  const program = await ensurePstoProgram(tx, targetRows.length ? targetRows : [target], targetState)
  const matches = exception.required === (targetState === 'assigned')
  await tx.delete(pstoChainExceptions).where(eq(pstoChainExceptions.id, exception.id))
  if (!matches) await tx.insert(pstoChainExceptions).values({ lineProgramId: program.id, rootJoint: getPstoChainRoot(target.joint, settings), required: exception.required, basis: exception.basis })
  return overlayPstoProgramPolicies(tx, [source, target], new Map(policies))
}
