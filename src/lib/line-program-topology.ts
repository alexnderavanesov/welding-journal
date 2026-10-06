import type { WeldRow } from './dispatcher-types'
import { encodeIdentityKey } from './identity-key'
import { formatRepeatedJointName, normalizeJointChainPart, parseJointChainName, parseRepeatedJointName } from './joint-chain'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'

export type ProgramExclusionReason = 'repair' | 'replaced' | 'incomplete-coil' | 'ineligible'
export type ProgramTopologyIssue = { rowId: number; message: string; code?: 'missing-replacement' }

export function programJointIdentity(row: WeldRow, joint = String(row.joint ?? '')) {
  return encodeIdentityKey([...([row.projectTitle, row.subtitleCode, row.line].map(value => String(value ?? '').trim().toLocaleLowerCase('ru'))), normalizeJointChainPart(joint)])
}

/** Complete line context is required: physical replacement is independent of a child's
 * current officiality, actuality, stamp or visibility. R/W is never a new connection,
 * including when the preceding record has been deleted.
 */
export function buildLineProgramTopology(
  input: readonly WeldRow[],
  full: boolean,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  const rows = [...new Map(input.map(row => [row.id, row])).values()].sort((a, b) => a.id - b.id)
  const primaryRows: WeldRow[] = []
  const excluded = new Map<number, ProgramExclusionReason>()
  const issues: ProgramTopologyIssue[] = []
  const roots = new Map<string, WeldRow[]>()
  const pairs = new Map<string, { anchor: WeldRow; parent: string; parentId?: number | null; sides: Map<number, WeldRow[]> }>()
  const byId = new Map(rows.map(row => [row.id, row]))
  const repairs: WeldRow[] = []
  for (const row of rows) {
    const joint = String(row.joint ?? '')
    const branch = parseRepeatedJointName(joint, settings)
    if (row.programChainState?.kind === 'repair' || !row.programChainState && branch.segments.length) {
      excluded.set(row.id, 'repair')
      repairs.push(row)
      continue
    }
    primaryRows.push(row)
    if (row.programChainState?.replacedByCoil) excluded.set(row.id, 'replaced')
    const key = programJointIdentity(row)
    const bucket = roots.get(key) ?? []
    bucket.push(row); roots.set(key, bucket)
    const parsed = parseJointChainName(joint, settings)
    const last = parsed.segments.at(-1)
    if (row.programChainState ? row.programChainState.kind !== 'coil' : last?.suffix !== 'Y') continue
    const parent = formatRepeatedJointName(parsed.base, parsed.segments.slice(0, -1), settings)
    const parentId = row.programChainState?.coilParentId
    const parentKey = row.programChainState ? `id:${parentId ?? `missing:${row.id}`}` : programJointIdentity(row, parent)
    const sideIndex = row.programChainState?.coilSide ?? last?.index ?? 0
    const pair = pairs.get(parentKey) ?? { anchor: row, parent, parentId, sides: new Map<number, WeldRow[]>() }
    const side = pair.sides.get(sideIndex) ?? []
    side.push(row); pair.sides.set(sideIndex, side); pairs.set(parentKey, pair)
  }
  for (const row of repairs) {
    const branch = parseRepeatedJointName(String(row.joint ?? ''), settings).base
    if (row.programChainState ? !byId.has(row.programChainState.physicalRootId ?? -1) : !roots.has(programJointIdentity(row, branch))) {
      issues.push({ rowId: row.id, message: `Не найден исходный стык ${branch}. Ремонт не участвует в процентном расчёте; проверьте целостность цепочки.` })
    }
    if (row.programChainState) {
      const seen = new Set([row.id])
      let sourceId = row.programChainState.sourceRowId
      while (sourceId != null) {
        if (seen.has(sourceId)) {
          issues.push({ rowId: row.id, message: `Обнаружен цикл в связях ${jointLabel(row)}. Проверьте историю цепочки.` }); break
        }
        seen.add(sourceId)
        const source = byId.get(sourceId)
        if (!source || programJointIdentity(source, '') !== programJointIdentity(row, '')) {
          issues.push({ rowId: row.id, message: `Не найден предшественник ${jointLabel(row)} в этой линии. История обязательного контроля неполна.` }); break
        }
        sourceId = source.programChainState?.sourceRowId ?? null
      }
    }
  }
  const parentsWithCoilRows = new Set<number>()
  for (const [key, pair] of pairs) {
    const parents = pair.parentId === undefined ? roots.get(key) ?? [] : pair.parentId == null ? [] : [byId.get(pair.parentId)].filter((row): row is WeldRow => !!row)
    for (const parent of parents) parentsWithCoilRows.add(parent.id)
    const first = pair.sides.get(1) ?? [], second = pair.sides.get(2) ?? []
    const completed = parents.some(parent => parent.programChainState?.replacedByCoil) ||
      first.length > 0 && second.length > 0 && (full || first.some(row => !!row.weldDate) && second.some(row => !!row.weldDate))
    if (completed) {
      for (const parent of parents) excluded.set(parent.id, 'replaced')
    } else {
      for (const side of pair.sides.values()) for (const row of side) excluded.set(row.id, 'incomplete-coil')
    }
    if (!first.length || !second.length) issues.push({ rowId: pair.anchor.id,
      message: `Катушка ${pair.parent} неполная. Проверьте обе стороны и сохранённое состояние замены.` })
    if (!parents.length) issues.push({ rowId: pair.anchor.id,
      message: `Не найден исходный стык катушки ${pair.parent}. Проверьте историю замены.` })
  }
  for (const row of primaryRows) {
    if (row.programChainState?.replacedByCoil && !parentsWithCoilRows.has(row.id)) issues.push({ rowId: row.id, code: 'missing-replacement',
      message: `Стык ${jointLabel(row)} сохранён как заменённый катушкой, но обе её стороны отсутствуют в этой линии. Проверьте историю замены; удаление записей не восстанавливает исходное соединение.` })
  }
  return { rows, primaryRows, excluded, issues, physicalRows: primaryRows.filter(row => !excluded.has(row.id)) }
}

const jointLabel = (row: WeldRow) => String(row.joint ?? row.id)
