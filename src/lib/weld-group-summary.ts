import type { WeldRow } from './dispatcher-types'
import { parseRepeatedJointName } from './joint-chain'
import { programJointIdentity } from './line-program-topology'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'
import { buildFinalStatusRowsContext, calculateFinalStatusInRows, normalizeFinalStatus } from './weld-status'
import { formatDisplayDate, parseDateLikeToIso } from './date-format'
import { journalNumericValue } from './welding-journal-grid-state'
import { createHeatTreatmentGroupSummarizer, type WeldGroupStageSummary } from './weld-group-stage-summary'
import { createLnkGroupSummarizer, type LnkGroupResultField } from './weld-group-lnk-summary'

export type WeldGroupSummary = {
  rows: readonly WeldRow[]
  lines: number
  joints: number
  wdi: number | null
  missingWdi: number
  weldDate: string
  missingDates: number
  projectTitle: string
  subtitleCode: string
  status: string
  rejected: number
  errors: number
  partialChains: number
  pstoResult?: WeldGroupStageSummary
  tvmtResult?: WeldGroupStageSummary
  lnkResults?: Record<LnkGroupResultField, WeldGroupStageSummary>
}

const text = (value: unknown) => String(value ?? '').trim()
const waiting = ['ожидает сварку', 'ожидает ремонт', 'ожидает заявку', 'ожидает НК'] as const

/** A summary of the supplied group, not of hidden rows or an entire server query.
 * Resolve identity once per loaded batch; aggregate once per group, never per cell.
 * Saved IDs take precedence over names; legacy continuations are explicit evidence.
 */
export function createWeldGroupSummarizer(input: readonly WeldRow[], settings: SystemIndexSettings = loadSystemIndexSettings(), options: { heatTreatment?: boolean; lnk?: boolean } = {}) {
  const rows = [...new Map(input.map(row => [row.id, row])).values()]
  const createStageSummary = options.heatTreatment ? createHeatTreatmentGroupSummarizer(rows) : undefined
  const createLnkSummary = options.lnk ? createLnkGroupSummarizer(rows) : undefined
  const byId = new Map(rows.map(row => [row.id, row]))
  let context: ReturnType<typeof buildFinalStatusRowsContext> | undefined
  const statuses = new Map(rows.map(row => [row.id, normalizeFinalStatus(row.finalStatus)
    ?? calculateFinalStatusInRows(row, rows, context ??= buildFinalStatusRowsContext(rows))]))
  const keys = new Map<number, string>()
  const roots = new Map<string, WeldRow>()
  for (const row of rows) {
    const state = row.programChainState
    // Persisted physical IDs already resolve identity. Parsing legacy names
    // for these rows cannot affect the result and dominates large plain groups.
    const branch = state ? undefined : parseRepeatedJointName(text(row.joint), settings)
    const key = state ? state.physicalRootId == null ? `unknown:${row.id}` : `id:${state.physicalRootId}`
      : `legacy:${programJointIdentity(row, branch!.base)}`
    keys.set(row.id, key)
    if (state ? state.physicalRootId === row.id : !branch!.segments.length) {
      const previous = roots.get(key)
      if (!previous || text(previous.officiality).toLocaleLowerCase('ru') === 'неофициальный') roots.set(key, row)
    }
  }
  // An official namesake can be the continuation of an unofficial original.
  // Only explicit links join these otherwise separate persisted physical IDs.
  const aliases = new Map<string, string>()
  for (const row of rows) {
    const next = row.chainContinuation
    if (next?.kind !== 'official-joint' || next.targetRowIds.length !== 1) continue
    const target = byId.get(next.targetRowIds[0])
    if (target && programJointIdentity(row) === programJointIdentity(target)) aliases.set(keys.get(row.id)!, keys.get(target.id)!)
  }
  const resolvedAliases = new Map<string, string>()
  const resolve = (key: string) => {
    const seen = new Set<string>()
    while (aliases.has(key) && !seen.has(key) && !resolvedAliases.has(key)) { seen.add(key); key = aliases.get(key)! }
    const root = resolvedAliases.get(key) ?? key
    // Compress paths: a long namesake history must not retrace all successors
    // once per record. Cycles still fail the endpoint/completeness checks below.
    for (const visited of seen) resolvedAliases.set(visited, root)
    return root
  }
  for (const [id, key] of keys) keys.set(id, resolve(key))
  const replaced = new Set<string>()
  for (const row of rows) {
    if (row.groupPhysicalRoot?.replaced || row.programChainState?.replacedByCoil) replaced.add(keys.get(row.id)!)
    const next = row.chainContinuation
    if (next?.kind === 'coil' && next.targetRowIds.length === 2 && next.targetRowIds.every(id => byId.get(id)?.weldDate)) replaced.add(keys.get(row.id)!)
  }

  return (members: readonly WeldRow[]): WeldGroupSummary => {
    const group = [...new Map(members.map(row => [row.id, byId.get(row.id) ?? row])).values()]
    const ids = new Set(group.map(row => row.id))
    const linkedTargets = new Set(group.flatMap(row => row.chainContinuation?.targetRowIds ?? []))
    const branches = new Map<string, WeldRow[]>()
    let firstDate: string | undefined, lastDate: string | undefined, dateCount = 0
    const lines = new Set<string>()
    const stages = createStageSummary?.()
    const lnkStages = createLnkSummary?.()
    let errors = 0
    for (const row of group) {
      stages?.addHistory(row)
      lnkStages?.addHistory(row)
      if (statuses.get(row.id) === 'ошибка') errors++ // History errors must never be hidden by a good successor.
      if (text(row.line)) lines.add(programJointIdentity(row, ''))
      const date = parseDateLikeToIso(row.weldDate)
      if (date) {
        dateCount++
        if (firstDate === undefined || date < firstDate) firstDate = date
        if (lastDate === undefined || date > lastDate) lastDate = date
      }
      const key = keys.get(row.id)!
      if (replaced.has(key)) continue
      const branch = branches.get(key) ?? []
      branch.push(row); branches.set(key, branch)
    }
    let rejected = 0, partialChains = 0, missingWdi = 0, knownWdi = 0, cents = 0
    const currentStatuses = new Set<string>()
    for (const [key, branch] of branches) {
      const root = roots.get(key)
      const savedRoot = branch.find(row => row.groupPhysicalRoot && `id:${row.groupPhysicalRoot.id}` === key)?.groupPhysicalRoot
      const wdi = savedRoot ? savedRoot.wdi : root ? journalNumericValue(root.wdi) : null
      if (wdi == null) missingWdi++
      else { knownWdi++; cents += Math.round(wdi * 100) }
      let partial = key.startsWith('unknown:') || savedRoot?.exists === false || !root && !savedRoot
      const predecessors = new Set<number>()
      for (const row of branch) {
        const state = row.programChainState
        if (state?.kind === 'repair') {
          const source = state.sourceRowId == null ? undefined : byId.get(state.sourceRowId)
          if (!source || !ids.has(source.id) || keys.get(source.id) !== key || programJointIdentity(source, '') !== programJointIdentity(row, '')) partial = true
          else if (statuses.get(source.id) === 'не годен') predecessors.add(source.id)
          else partial = true
        }
        const next = row.chainContinuation
        if (next) {
          if (next.targetRowIds.length !== (next.kind === 'coil' ? 2 : 1) || next.targetRowIds.some(id => !ids.has(id))) partial = true
          if (next.kind !== 'coil' && next.targetRowIds.length === 1 && ids.has(next.targetRowIds[0])) {
            const target = byId.get(next.targetRowIds[0])!
            if (keys.get(target.id) !== key || programJointIdentity(target, '') !== programJointIdentity(row, '') || statuses.get(row.id) !== 'не годен') partial = true
            else predecessors.add(row.id)
          }
        }
        if (!state && parseRepeatedJointName(text(row.joint), settings).segments.length && !linkedTargets.has(row.id)) partial = true
      }
      const leaves = branch.filter(row => !predecessors.has(row.id))
      if (leaves.length !== 1) partial = true
      if (partial) partialChains++
      stages?.addBranch(leaves, partial)
      lnkStages?.addBranch(leaves, partial)
      let hasRejection = false
      for (const row of leaves) {
        const status = statuses.get(row.id) ?? 'ошибка'
        currentStatuses.add(status)
        if (status === 'не годен') hasRejection = true
      }
      if (hasRejection) rejected++
    }
    const status = errors ? 'ошибка' : waiting.find(status => currentStatuses.has(status))
      ?? (rejected ? 'не годен' : partialChains ? 'неполная цепочка' : branches.size ? 'годен' : group.length ? 'заменены катушкой' : '—')
    const common = (field: 'projectTitle' | 'subtitleCode') => {
      const values = new Set(group.map(row => text(row[field])))
      return values.size === 1 ? values.values().next().value || '—' : '—'
    }
    return { rows: group, lines: lines.size, joints: branches.size, wdi: knownWdi ? cents / 100 : null, missingWdi,
      weldDate: !firstDate ? '—' : firstDate === lastDate ? formatDisplayDate(firstDate) : `${formatDisplayDate(firstDate)} — ${formatDisplayDate(lastDate!)}`,
      missingDates: group.length - dateCount, projectTitle: common('projectTitle'), subtitleCode: common('subtitleCode'),
      status, rejected, errors, partialChains, ...stages?.finish(group.length),
      ...(lnkStages ? { lnkResults: lnkStages.finish(group.length) } : {}) }
  }
}
