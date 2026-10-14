import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import * as jointNames from './joint-name'
import type { ParsedJointName, ParsedJointNameSegment } from './joint-name'
import {
  getRepeatedJointNameFromParsed, parseJointChainName, parseRepeatedJointName,
  type JointChainSegment, type ParsedRepeatedJointName, type RepeatedJointSegment,
} from './joint-chain'
import { buildLineProgramTopology, type ProgramExclusionReason, type ProgramTopologyIssue } from './line-program-topology'
import { captureProgramChainStates, type ProgramChainState } from './line-program-chain-state'
import { DEFAULT_SYSTEM_INDEX_SETTINGS, loadSystemIndexSettings, type JointSystemSuffix, type SystemIndexSettings } from './system-index-settings'
import { compareReportRows } from './report-row-utils'
import { parseDateLikeToIso } from './date-format'

// Independent pre-optimization snapshots: do not replace these calls with the
// production parser/projection/topology. The capture snapshot deliberately
// includes the preexisting, agreed nondecreasing R/W predecessor correction.
const oldNormalizeJointName = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, '')
const oldNormalizePart = (value: unknown) => String(value ?? '').replace(/\s+/g, '').trim().toLowerCase()
const oldEscape = (value: string) => value.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&')

function oldJointPatterns(settings: SystemIndexSettings) {
  const segment = '[' + oldEscape(settings.repair) + oldEscape(settings.cutout) + oldEscape(settings.coil) + ']'
  return {
    prefix: new RegExp('^([' + oldEscape(settings.shopJoint) + oldEscape(settings.fieldJoint) + '](?:[A-Z])?\\d+)', 'i'),
    firstSegment: new RegExp(segment + '\\d+', 'i'),
    segments: new RegExp('(' + segment + ')(\\d+)', 'gi'),
  }
}

function oldSemanticSuffix(letter: string, settings: SystemIndexSettings): JointSystemSuffix | null {
  const normalized = String(letter ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1)
  const entry = Object.entries(settings).find(([, value]) => value === normalized)
  const suffixes: Partial<Record<string, JointSystemSuffix>> = { repair: 'R', cutout: 'W', coil: 'Y' }
  return entry ? suffixes[entry[0]] ?? null : null
}

function oldFormatName(base: string, segments: JointChainSegment[], settings: SystemIndexSettings) {
  const names = { R: settings.repair, W: settings.cutout, Y: settings.coil }
  return base + segments.map(segment => names[segment.suffix] + segment.index).join('')
}

function oldFindLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index])) return index
  return -1
}

function oldIdentity(row: WeldRow, joint = String(row.joint ?? '')) {
  return JSON.stringify([
    ...[row.projectTitle, row.subtitleCode, row.line].map(value => String(value ?? '').trim().toLocaleLowerCase('ru')),
    oldNormalizePart(joint),
  ])
}
const oldJointLabel = (row: WeldRow) => String(row.joint ?? row.id)

function oldCompareRows(left: WeldRow, right: WeldRow, settings: SystemIndexSettings) {
  const a = oldParseJointName(String(left.joint ?? ''), settings)
  const b = oldParseJointName(String(right.joint ?? ''), settings)
  const leftBase = oldNormalizePart(a.base), rightBase = oldNormalizePart(b.base)
  if (leftBase !== rightBase) return leftBase.localeCompare(rightBase, 'ru', { numeric: true })
  const suffixOrder = (suffix: string) => {
    const semantic = oldSemanticSuffix(suffix, settings) ?? suffix.toUpperCase()
    return semantic === 'R' ? 1 : semantic === 'W' ? 2 : semantic === 'Y' ? 3 : 10
  }
  for (let index = 0; index < Math.max(a.segments.length, b.segments.length); index += 1) {
    const first = a.segments[index], second = b.segments[index]
    if (!first && second) return -1
    if (first && !second) return 1
    if (!first || !second) continue
    const order = suffixOrder(first.suffix) - suffixOrder(second.suffix) ||
      first.suffix.localeCompare(second.suffix, 'ru', { numeric: true })
    if (order) return order
    if (first.index !== second.index) return first.index - second.index
  }
  if (oldNormalizePart(left.joint) === oldNormalizePart(right.joint)) {
    const unofficial = (row: WeldRow) => String(row.officiality ?? '').trim().toLowerCase() === 'неофициальный'
    const officiality = Number(!unofficial(left)) - Number(!unofficial(right))
    if (officiality) return officiality
    const leftDate = parseDateLikeToIso(left.weldDate), rightDate = parseDateLikeToIso(right.weldDate)
    if (leftDate !== rightDate) {
      if (!leftDate) return 1
      if (!rightDate) return -1
      return leftDate.localeCompare(rightDate)
    }
  }
  return compareReportRows(left, right)
}

function oldParseJointName(
  value: unknown,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
): ParsedJointName {
  const raw = oldNormalizeJointName(value)
  const patterns = oldJointPatterns(settings)
  const jointPrefixPattern = patterns.prefix
  const prefixMatch = raw.match(jointPrefixPattern)
  if (!prefixMatch) {
    return { raw, base: raw, segments: [], hasRequiredPrefix: false }
  }

  const prefix = prefixMatch[1].toUpperCase()
  const tail = raw.slice(prefixMatch[1].length)
  const firstSystemSegment = tail.search(patterns.firstSegment)
  const baseExtra = firstSystemSegment === -1 ? tail : tail.slice(0, firstSystemSegment)
  const systemTail = firstSystemSegment === -1 ? '' : tail.slice(firstSystemSegment)
  const segments = [...systemTail.matchAll(patterns.segments)]
    .map((match) => {
      const suffix = oldSemanticSuffix(match[1], settings)
      return suffix ? { suffix, index: Number(match[2]) || 0 } : null
    })
    .filter((segment): segment is ParsedJointNameSegment => Boolean(segment))

  return {
    raw,
    base: `${prefix}${baseExtra}`,
    segments,
    hasRequiredPrefix: true,
  }
}

function oldRepeatedJointName(
  joint: string,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
): ParsedRepeatedJointName {
  const parsed = oldParseJointName(joint, settings)
  const lastCoilIndex = oldFindLastIndex(parsed.segments, (segment) => segment.suffix === 'Y')
  const baseSegments = lastCoilIndex === -1 ? [] : parsed.segments.slice(0, lastCoilIndex + 1)
  const repairSegments = parsed.segments
    .slice(lastCoilIndex + 1)
    .filter((segment): segment is RepeatedJointSegment => segment.suffix === 'R' || segment.suffix === 'W')
  const base = oldFormatName(parsed.base, baseSegments, settings)
  const lastSegment = repairSegments.at(-1)
  return {
    base,
    segments: repairSegments,
    suffix: lastSegment?.suffix ?? null,
    index: lastSegment?.index ?? 0,
  }
}

function oldTopology(
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
    const branch = oldRepeatedJointName(joint, settings)
    if (row.programChainState?.kind === 'repair' || !row.programChainState && branch.segments.length) {
      excluded.set(row.id, 'repair')
      repairs.push(row)
      continue
    }
    primaryRows.push(row)
    if (row.programChainState?.replacedByCoil) excluded.set(row.id, 'replaced')
    const key = oldIdentity(row)
    const bucket = roots.get(key) ?? []
    bucket.push(row); roots.set(key, bucket)
    const parsed = oldParseJointName(joint, settings)
    const last = parsed.segments.at(-1)
    if (row.programChainState ? row.programChainState.kind !== 'coil' : last?.suffix !== 'Y') continue
    const parent = oldFormatName(parsed.base, parsed.segments.slice(0, -1), settings)
    const parentId = row.programChainState?.coilParentId
    const parentKey = row.programChainState ? `id:${parentId ?? `missing:${row.id}`}` : oldIdentity(row, parent)
    const sideIndex = row.programChainState?.coilSide ?? last?.index ?? 0
    const pair = pairs.get(parentKey) ?? { anchor: row, parent, parentId, sides: new Map<number, WeldRow[]>() }
    const side = pair.sides.get(sideIndex) ?? []
    side.push(row); pair.sides.set(sideIndex, side); pairs.set(parentKey, pair)
  }
  for (const row of repairs) {
    const branch = oldRepeatedJointName(String(row.joint ?? ''), settings).base
    if (row.programChainState ? !byId.has(row.programChainState.physicalRootId ?? -1) : !roots.has(oldIdentity(row, branch))) {
      issues.push({ rowId: row.id, message: `Не найден исходный стык ${branch}. Ремонт не участвует в процентном расчёте; проверьте целостность цепочки.` })
    }
    if (row.programChainState) {
      const seen = new Set([row.id])
      let sourceId = row.programChainState.sourceRowId
      while (sourceId != null) {
        if (seen.has(sourceId)) {
          issues.push({ rowId: row.id, message: `Обнаружен цикл в связях ${oldJointLabel(row)}. Проверьте историю цепочки.` }); break
        }
        seen.add(sourceId)
        const source = byId.get(sourceId)
        if (!source || oldIdentity(source, '') !== oldIdentity(row, '')) {
          issues.push({ rowId: row.id, message: `Не найден предшественник ${oldJointLabel(row)} в этой линии. История обязательного контроля неполна.` }); break
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
      message: `Стык ${oldJointLabel(row)} сохранён как заменённый катушкой, но обе её стороны отсутствуют в этой линии. Проверьте историю замены; удаление записей не восстанавливает исходное соединение.` })
  }
  return { rows, primaryRows, excluded, issues, physicalRows: primaryRows.filter(row => !excluded.has(row.id)) }
}

function oldCaptureStates(rows: readonly WeldRow[], settings: SystemIndexSettings = loadSystemIndexSettings()) {
  const byIdentity = new Map<string, WeldRow[]>()
  const branches = new Map<string, WeldRow[]>()
  const parsed = new Map(rows.map(row => [row.id, oldRepeatedJointName(String(row.joint ?? ''), settings)]))
  for (const row of rows) {
    const key = oldIdentity(row), bucket = byIdentity.get(key) ?? []
    bucket.push(row); byIdentity.set(key, bucket)
    const branchKey = oldIdentity(row, parsed.get(row.id)!.base), branch = branches.get(branchKey) ?? []
    branch.push(row); branches.set(branchKey, branch)
  }
  const unique = (key: string) => {
    const matches = byIdentity.get(key) ?? []
    const official = matches.filter(row => String(row.officiality ?? '').toLocaleLowerCase('ru') !== 'неофициальный')
    return official.length === 1 ? official[0] : matches.length === 1 ? matches[0] : undefined
  }
  const states = new Map<number, ProgramChainState>()
  for (const row of rows) {
    if (row.programChainState) { states.set(row.id, { ...row.programChainState }); continue }
    const branch = parsed.get(row.id)!
    const chain = oldParseJointName(String(row.joint ?? ''), settings)
    const coil = !branch.segments.length && chain.segments.at(-1)?.suffix === 'Y'
    const root = branch.segments.length ? unique(oldIdentity(row, branch.base)) : row
    const parentName = coil ? oldFormatName(chain.base, chain.segments.slice(0, -1), settings) : ''
    const parent = coil ? unique(oldIdentity(row, parentName)) : undefined
    const sourceBranch = branches.get(oldIdentity(row, coil ? parentName : branch.base)) ?? []
    const earlier = branch.segments.length ? sourceBranch.filter(candidate => {
      const parts = parsed.get(candidate.id)!.segments
      return candidate.id !== row.id && parts.length <= branch.segments.length &&
        // A repeated failure increments its existing suffix wherever it occurs:
        // W1R1 -> W2R1 and R1W1 -> R2W1 both keep the immediate predecessor.
        // All counters must be nondecreasing; sibling suffix paths remain separate.
        parts.every((part, i) => part.suffix === branch.segments[i].suffix &&
          part.index <= branch.segments[i].index) &&
        (parts.length < branch.segments.length || parts.some((part, i) => part.index < branch.segments[i].index))
    }) : coil ? sourceBranch : []
    const source = earlier.sort((a, b) => oldCompareRows(a, b, settings)).at(-1)
    states.set(row.id, { weldJointId: row.id, kind: branch.segments.length ? 'repair' : coil ? 'coil' : 'primary',
      physicalRootId: root?.id ?? null, sourceRowId: source?.id ?? null, coilParentId: parent?.id ?? null,
      coilSide: coil ? chain.segments.at(-1)!.index : null, replacedByCoil: false })
  }
  const weldedSides = new Map<number, Set<number>>()
  const weldedIds = new Map<number, number[]>()
  for (const row of rows) {
    const state = states.get(row.id)!
    if (state.kind !== 'coil' || state.coilParentId == null || !row.weldDate || state.coilSide == null) continue
    const sides = weldedSides.get(state.coilParentId) ?? new Set<number>()
    sides.add(state.coilSide); weldedSides.set(state.coilParentId, sides)
    const ids = weldedIds.get(state.coilParentId) ?? []
    ids.push(row.id); weldedIds.set(state.coilParentId, ids)
  }
  for (const [parentId, sides] of weldedSides) {
    const parent = states.get(parentId)
    if (parent && !parent.replacedByCoil && sides.has(1) && sides.has(2)) {
      parent.replacedByCoil = true
      parent.replacementCoilIds = weldedIds.get(parentId)!.sort((a, b) => a - b)
    }
  }
  return states
}

const row = (id: number, joint: string, patch: Partial<WeldRow> = {}): WeldRow => ({
  id, joint, projectTitle: 'P', subtitleCode: 'S', line: 'L',
  officiality: 'действующий', revisionActuality: 'актуальная', weldDate: '2026-09-01', ...patch,
})
const state = (id: number, patch: Partial<ProgramChainState> = {}): ProgramChainState => ({
  weldJointId: id, kind: 'primary', physicalRootId: id, sourceRowId: null,
  coilParentId: null, coilSide: null, replacedByCoil: false, ...patch,
})
const customSettings: SystemIndexSettings = {
  shopJoint: 'P', fieldJoint: 'J', repair: 'Q', cutout: 'T', coil: 'Z', allowLeadingLetterIndex: true,
}

function expectOldCalculation(rows: WeldRow[], settings = DEFAULT_SYSTEM_INDEX_SETTINGS) {
  const before = structuredClone(rows)
  for (const full of [false, true]) {
    const actual = buildLineProgramTopology(rows, full, settings)
    const expected = oldTopology(rows, full, settings)
    expect({ ...actual, excluded: [...actual.excluded] }).toEqual({ ...expected, excluded: [...expected.excluded] })
    actual.rows.forEach((value, index) => expect(value).toBe(expected.rows[index]))
  }
  expect([...captureProgramChainStates(rows, settings)]).toEqual([...oldCaptureStates(rows, settings)])
  expect(rows).toEqual(before)
}

afterEach(() => vi.restoreAllMocks())

describe('joint parser optimization against the previous algorithms', () => {
  it('preserves Unicode, legacy tails, leading zeroes and custom-index parsing', () => {
    const inputs: unknown[] = [undefined, null, 0, false, '', 'S1', 'f0002', 'SB05', 'F1A',
      'S1R', 'S1R0', 'S1R02W001', 'S1R2junkW1', 'S1R2Y1W1', 'S1Y1R2Y2W1',
      ' S\u00a001 R02\tW1\ufeff ', 'С1', 'S1Р1', 'Ｓ1', 'S١R2', 'S1\u200bR1',
      'İ1', 'ſ1R2', 'J1Q2T1', 'P1Q1Z1T2', 'S1R99999999999999999999999999999999999',
      { toString: () => ' S1Y1R2 ' }]
    for (const settings of [DEFAULT_SYSTEM_INDEX_SETTINGS, customSettings]) {
      for (const input of inputs) {
        const expected = oldParseJointName(input, settings)
        expect(jointNames.parseJointName(input, settings)).toEqual(expected)
        expect(parseJointChainName(String(input ?? ''), settings)).toEqual({
          base: expected.base, segments: expected.segments,
        })
        expect(parseRepeatedJointName(String(input ?? ''), settings)).toEqual(
          oldRepeatedJointName(String(input ?? ''), settings),
        )
        expect(getRepeatedJointNameFromParsed(jointNames.parseJointName(input, settings), settings)).toEqual(
          oldRepeatedJointName(String(input ?? ''), settings),
        )
      }
    }
    expect(parseRepeatedJointName('S1R2Y1W1', DEFAULT_SYSTEM_INDEX_SETTINGS)).toEqual({
      base: 'S1R2Y1', segments: [{ suffix: 'W', index: 1 }], suffix: 'W', index: 1,
    })
    // Reading legacy data still accepts a leading letter when manual entry is disabled.
    expect(jointNames.parseJointName('SB05', DEFAULT_SYSTEM_INDEX_SETTINGS).hasRequiredPrefix).toBe(true)
  })

  it('observes in-place settings changes and alternating settings objects', () => {
    const settings = { ...DEFAULT_SYSTEM_INDEX_SETTINGS }
    const inputs = ['S1R2W1Y2', 'F1Q2', 'P1Q1Z1T2', 'J1T1', 'PB05', 'P1+1', 'P1P1']
    const patches: Partial<SystemIndexSettings>[] = [
      { repair: 'Q' }, { cutout: 'T' }, { coil: 'Z' }, { shopJoint: 'P' }, { fieldJoint: 'J' },
      { allowLeadingLetterIndex: true }, { allowLeadingLetterIndex: false },
      // Direct callers can pass unnormalized or colliding settings; retain the old parser's result.
      { repair: '+' }, { repair: 'P' }, { ...DEFAULT_SYSTEM_INDEX_SETTINGS },
    ]
    for (const patch of patches) {
      Object.assign(settings, patch)
      for (const current of [settings, customSettings, DEFAULT_SYSTEM_INDEX_SETTINGS, settings]) {
        for (const input of inputs) {
          expect(jointNames.parseJointName(input, current)).toEqual(oldParseJointName(input, current))
          expect(parseRepeatedJointName(input, current)).toEqual(oldRepeatedJointName(input, current))
        }
      }
    }
  })

  it.each(['S1', 'S1legacy', 'not-a-joint', 'S1R2Y1W1R2'])('returns independent mutable arrays for %s', joint => {
    const settings = DEFAULT_SYSTEM_INDEX_SETTINGS
    const parsed = jointNames.parseJointName(joint, settings)
    const another = jointNames.parseJointName(joint, settings)
    expect(parsed.segments).not.toBe(another.segments)
    if (parsed.segments[0]) parsed.segments[0].index = 999
    parsed.segments.push({ suffix: 'R', index: 123 })
    expect(another).toEqual(oldParseJointName(joint, settings))
    expect(jointNames.parseJointName(joint, settings)).toEqual(oldParseJointName(joint, settings))

    const shared = jointNames.parseJointName(joint, settings)
    shared.segments.forEach(segment => Object.freeze(segment))
    Object.freeze(shared.segments)
    Object.freeze(shared)
    const first = getRepeatedJointNameFromParsed(shared, settings)
    const second = getRepeatedJointNameFromParsed(shared, settings)
    expect(first.segments).not.toBe(second.segments)
    expect(first.segments).not.toBe(shared.segments)
    if (first.segments[0]) first.segments[0].index = 999
    first.segments.push({ suffix: 'R', index: 123 })
    expect(shared).toEqual(oldParseJointName(joint, settings))
    expect(second).toEqual(oldRepeatedJointName(joint, settings))
    expect(getRepeatedJointNameFromParsed(shared, settings)).toEqual(oldRepeatedJointName(joint, settings))

    const publicResult = parseRepeatedJointName(joint, settings)
    if (publicResult.segments[0]) publicResult.segments[0].suffix = 'R'
    publicResult.segments.length = 0
    expect(parseRepeatedJointName(joint, settings)).toEqual(oldRepeatedJointName(joint, settings))
    const chain = parseJointChainName(joint, settings)
    if (chain.segments[0]) chain.segments[0].index = 999
    chain.segments.length = 0
    const expectedChain = oldParseJointName(joint, settings)
    expect(parseJointChainName(joint, settings)).toEqual({ base: expectedChain.base, segments: expectedChain.segments })
  })
})

describe('local parsed-name reuse preserves topology and captured state', () => {
  it('retains empty input and repeated references to the same row', () => {
    expectOldCalculation([])
    const root = row(1, 'S1'), repair = row(2, 'S1R1')
    expectOldCalculation([repair, root, repair, root])
  })

  const cases: Array<[string, WeldRow[]]> = [
    ['legacy mixed R/W/Y and repeated failures', [
      row(1, 'S1'), row(2, 'S1W1'), row(3, 'S1W1R1'), row(4, 'S1W2R1'),
      row(5, 'S1W2R1Y1'), row(6, 'S1W2R1Y2'), row(7, 'S1W2R1Y1R1'),
    ]],
    ['incomplete, missing and unwelded predecessors', [
      row(1, 'F1'), row(2, 'F1Y1'), row(3, 'F1Y2', { weldDate: null }),
      row(4, 'F9Y1'), row(5, 'F8R1'), row(6, 'F2Y1R2'),
    ]],
    ['official namesakes and whitespace without broad normalization', [
      row(1, 'S1', { officiality: 'неофициальный' }), row(2, 'S1'), row(3, 'S1R1'),
      row(4, 'S1', { line: 'L\u00a01' }), row(5, 'S1R1', { line: 'L 1' }),
      row(6, ' S2\u00a0Y1 '), row(7, 'S2Y2', { revisionActuality: 'не актуален' }),
      row(8, 'S2', { officiality: '\u00a0НЕОФИЦИАЛЬНЫЙ\ufeff' }),
    ]],
    ['stored identities override renamed joints and retain replacement', [
      row(1, 'renamed', { programChainState: state(1, { replacedByCoil: true, replacementCoilIds: [2, 3] }) }),
      row(2, 'S99', { programChainState: state(2, { kind: 'coil', coilParentId: 1, coilSide: 1 }) }),
      row(3, 'F7R9', { programChainState: state(3, { kind: 'coil', coilParentId: 1, coilSide: 2 }) }),
      row(4, 'legacy', { programChainState: state(4, { kind: 'repair', physicalRootId: 2, sourceRowId: 2 }) }),
      row(5, 'S8R1', { programChainState: state(5) }),
      row(6, 'S9', { programChainState: state(6, { replacedByCoil: true }) }),
    ]],
    ['stored cycles, moved sources and missing roots retain diagnostics', [
      row(1, 'S1R1', { programChainState: state(1, { kind: 'repair', physicalRootId: 99, sourceRowId: 2 }) }),
      row(2, 'S1R2', { programChainState: state(2, { kind: 'repair', physicalRootId: 99, sourceRowId: 1 }) }),
      row(3, 'S2R1', { programChainState: state(3, { kind: 'repair', physicalRootId: 4, sourceRowId: 4 }) }),
      row(4, 'S2', { line: 'moved', programChainState: state(4) }),
    ]],
    ['duplicate IDs with different names and stored-state presence', [
      row(1, 'S1'), row(2, 'S1Y1'), row(3, 'S1Y2'),
      row(2, 'F9R1'), row(3, 'F7', { programChainState: state(3, { replacedByCoil: true }) }),
      row(4, 'S1R2'), row(4, 'S1R1'), row(5, 'S1R3'),
    ]],
  ]

  it.each(cases)('matches the old algorithms for %s, including input order', (_name, rows) => {
    for (const input of [rows, [...rows].reverse(), [...rows.slice(1), rows[0]]]) {
      expectOldCalculation(input)
    }
  })

  it('retains the preexisting immediate predecessor for mixed suffix increments', () => {
    const rows = [row(1, 'S1'), row(2, 'S1W1'), row(3, 'S1W1R1'), row(4, 'S1W2R1')]
    expectOldCalculation(rows)
    expect(captureProgramChainStates(rows).get(4)?.sourceRowId).toBe(3)
  })

  it('keeps custom indexes, current settings and edited rows independent between calls', () => {
    const settings = { ...DEFAULT_SYSTEM_INDEX_SETTINGS }
    const rows = [row(1, 'P1'), row(2, 'P1Z1'), row(3, 'P1Z2'), row(4, 'P1Z1Q1'),
      row(5, 'J1'), row(6, 'J1Q1T1')]
    expectOldCalculation(rows, settings)
    Object.assign(settings, customSettings)
    expectOldCalculation(rows, settings)
    rows[2].weldDate = null
    rows[1].officiality = 'неофициальный'
    rows[3].rkResult = 'ремонт'
    rows[3].preHeatTreatmentLnkEnabled = false
    rows[3].preHeatTreatmentControls = [{ id: 1, weldJointId: 4, method: 'РК', result: 'вырез' }]
    expectOldCalculation(rows, settings)
    rows[3].rkResult = 'годен'
    rows[3].preHeatTreatmentLnkEnabled = true
    rows[3].preHeatTreatmentControls[0].result = 'годен'
    rows[1].joint = 'J9T2'
    rows[2].programChainState = state(3, { kind: 'repair', sourceRowId: 99 })
    expectOldCalculation(rows, settings)
    rows[2].programChainState.sourceRowId = 1
    settings.coil = 'Y'
    expectOldCalculation(rows, settings)
    Object.assign(settings, DEFAULT_SYSTEM_INDEX_SETTINGS)
    expectOldCalculation(rows, settings)
  })

  it('does not reuse a previous result or modify frozen input', () => {
    const rows = [row(1, 'S1'), row(2, 'S1Y1'), row(3, 'S1Y2'),
      row(4, 'S9', { programChainState: state(4, { replacedByCoil: true }) })]
    for (const value of rows) {
      if (value.programChainState) Object.freeze(value.programChainState)
      Object.freeze(value)
    }
    Object.freeze(rows)
    const topology = buildLineProgramTopology(rows, false)
    topology.rows.length = 0
    topology.primaryRows.length = 0
    topology.physicalRows.length = 0
    topology.excluded.clear()
    topology.issues.length = 0
    const states = captureProgramChainStates(rows)
    states.get(4)!.replacedByCoil = false
    states.get(1)!.replacementCoilIds!.push(999)
    states.clear()
    expectOldCalculation(rows)
  })

  it('parses each topology row once, including the deferred repair pass', () => {
    const parse = vi.spyOn(jointNames, 'parseJointName')
    const rows = [row(1, 'S1'), row(2, 'S1R1'), row(3, 'S1Y1')]
    buildLineProgramTopology(rows, false)
    expect(parse).toHaveBeenCalledTimes(rows.length)
  })

  it('reuses the initial parse when capturing distinct primary rows', () => {
    const parse = vi.spyOn(jointNames, 'parseJointName')
    const rows = [row(1, 'S1'), row(2, 'F2'), row(3, 'S3legacy')]
    captureProgramChainStates(rows)
    expect(parse).toHaveBeenCalledTimes(rows.length)
  })
})
