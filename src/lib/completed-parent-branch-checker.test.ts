import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import type { WeldInput } from './weld-fields'
import { DEFAULT_SYSTEM_INDEX_SETTINGS, type SystemIndexSettings } from './system-index-settings'
import * as consistency from './repeated-joint-consistency-tasks'
import { buildRepeatedJointTasks } from './repeated-joint-tasks'

const row = (id: number, joint: string, values: Partial<WeldRow> = {}): WeldRow => ({
  id, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint,
  officiality: 'действующий', revisionActuality: 'актуальная',
  weldDate: '2026-07-01', finalStatus: 'не годен',
  connectionType: 'СШ', category: 'II', groupName: 'A', weldControlPercent: 10, pvkControlPercent: 0,
  ...values,
})
const good = (joint = 'F1', values: Partial<WeldRow> = {}) => row(2, joint, { finalStatus: 'годен', ...values })
const custom: SystemIndexSettings = { ...DEFAULT_SYSTEM_INDEX_SETTINGS, repair: 'P', cutout: 'C', coil: 'K' }

afterEach(() => vi.restoreAllMocks())

describe('completed parent branch: independent truth cases, not new business rules', () => {
  const cases: { name: string; source: WeldRow; candidates: WeldRow[]; expected: boolean; settings?: SystemIndexSettings; sourceJoint?: string }[] = [
    { name: 'no candidate', source: row(1, 'F1Y1'), candidates: [], expected: false },
    { name: 'non-coil source', source: row(1, 'F1R1W1'), candidates: [good()], expected: false },
    { name: 'blank source override', source: row(1, 'F1Y1'), sourceJoint: ' ', candidates: [good()], expected: false },
    { name: 'good root', source: row(1, 'F1Y1'), candidates: [good()], expected: true },
    { name: 'good R/W parent continuation', source: row(1, 'F1Y1R1W1'), candidates: [good('F1R1W1')], expected: true },
    { name: 'same coil branch', source: row(1, 'F1Y1R1'), candidates: [good('F1Y1W1')], expected: false },
    { name: 'good sibling coil is not a parent branch', source: row(1, 'F1Y1'), candidates: [good('F1Y2')], expected: false },
    { name: 'good outer coil is not a non-Y branch', source: row(1, 'F1Y1Y1'), candidates: [good('F1Y1R1')], expected: false },
    { name: 'nested coil with good root continuation', source: row(1, 'F1Y1Y1R1'), candidates: [good('F1W1R1')], expected: true },
    { name: 'unofficial good parent', source: row(1, 'F1Y1'), candidates: [good('F1', { officiality: ' НеОфИцИаЛьНыЙ ' })], expected: false },
    { name: 'null officiality remains eligible', source: row(1, 'F1Y1'), candidates: [good('F1', { officiality: null })], expected: true },
    { name: 'obsolete good parent remains eligible', source: row(1, 'F1Y1'), candidates: [good('F1', { revisionActuality: 'не актуален' })], expected: true },
    { name: 'helper does not add a source officiality filter', source: row(1, 'F1Y1', { officiality: 'неофициальный' }), candidates: [good()], expected: true },
    { name: 'good facts without a stored good status are insufficient', source: row(1, 'F1Y1'), candidates: [good('F1', { finalStatus: null, vikResult: 'годен', rkResult: 'годен' })], expected: false },
    { name: 'stored good status is not recomputed from rejected facts', source: row(1, 'F1Y1'), candidates: [good('F1', { rkResult: 'вырез' })], expected: true },
    { name: 'waiting status', source: row(1, 'F1Y1'), candidates: [good('F1', { finalStatus: 'ожидает НК' })], expected: false },
    { name: 'case and outer whitespace in good status', source: row(1, 'F1Y1'), candidates: [good('F1', { finalStatus: ' ГОДЕН ' })], expected: true },
    { name: 'moved candidate line', source: row(1, 'F1Y1'), candidates: [good('F1', { line: 'other' })], expected: false },
    { name: 'different project', source: row(1, 'F1Y1'), candidates: [good('F1', { projectTitle: 'other' })], expected: false },
    { name: 'different subtitle', source: row(1, 'F1Y1'), candidates: [good('F1', { subtitleCode: 'other' })], expected: false },
    { name: 'different root', source: row(1, 'F1Y1'), candidates: [good('F2')], expected: false },
    { name: 'blank candidate name', source: row(1, 'F1Y1'), candidates: [good(' ')], expected: false },
    { name: 'identity compacts internal whitespace and case', source: row(1, 'F 1Y1', { projectTitle: 'P P', line: 'L L' }), candidates: [good('f1r1', { projectTitle: ' pp ', line: 'll' })], expected: true },
    { name: 'source override, not current row name', source: row(1, 'F2'), sourceJoint: 'F1Y1', candidates: [good()], expected: true },
    { name: 'custom R/W/Y letters', source: row(1, 'F1K1P1'), candidates: [good('F1P1C1')], settings: custom, expected: true },
    { name: 'custom coil candidate stays excluded', source: row(1, 'F1K1'), candidates: [good('F1K2P1')], settings: custom, expected: false },
  ]
  it.each(cases)('$name', ({ source, sourceJoint = String(source.joint), candidates, expected, settings = DEFAULT_SYSTEM_INDEX_SETTINGS }) => {
    const rows = [source, ...candidates]
    const before = structuredClone(rows)
    const check = consistency.createCompletedParentBranchChecker(rows, settings)
    // Explicit answers above guard the assumptions; the unchanged public linear
    // predicate is an additional equivalence oracle, not the source of answers.
    expect(consistency.hasCompletedParentBranch(rows, source, sourceJoint, settings)).toBe(expected)
    expect(check(source, sourceJoint)).toBe(expected)
    expect(check(source, sourceJoint)).toBe(expected)
    expect(rows).toEqual(before)
  })

  it('matches the old predicate for a deterministic mixed/moved/settings matrix in both row orders', () => {
    for (const settings of [DEFAULT_SYSTEM_INDEX_SETTINGS, custom]) {
      const { repair: r, cutout: w, coil: y } = settings
      const names = ['F1', `F1${r}1`, `F1${r}1${w}1`, `F1${y}1`, `F1${y}2${r}1`, `F1${y}1${y}2${w}1`, 'F2', '']
      const rows = names.flatMap((name, nameIndex) => ['годен', 'не годен', '', 'ожидает НК'].flatMap((status, statusIndex) =>
        [null, 'неофициальный'].map((officiality, index) => row(nameIndex * 8 + statusIndex * 2 + index, name,
          { finalStatus: status, officiality, line: nameIndex % 3 ? 'L' : 'moved', revisionActuality: index ? null : 'не актуален' }))))
      for (const values of [rows, [...rows].reverse()]) {
        const check = consistency.createCompletedParentBranchChecker(values, settings)
        for (const source of rows) for (const name of names) {
          expect(check(source, name)).toBe(consistency.hasCompletedParentBranch(values, source, name, settings))
        }
      }
    }
  })

  it('does not share an index across new invocations or change the public one-off API', () => {
    const source = row(1, 'F1Y1'), candidate = good()
    const rows = [source, candidate]
    expect(consistency.createCompletedParentBranchChecker(rows)(source, 'F1Y1')).toBe(true)
    candidate.finalStatus = 'не годен'
    expect(consistency.createCompletedParentBranchChecker(rows)(source, 'F1Y1')).toBe(false)
    expect(consistency.hasCompletedParentBranch(rows, source, 'F1Y1')).toBe(false)
    candidate.finalStatus = 'годен'
    candidate.line = 'moved'
    expect(consistency.createCompletedParentBranchChecker(rows)(source, 'F1Y1')).toBe(false)
  })
})

describe('bounded completed-parent candidate scanning', () => {
  it.each([200, 1000])('reads each candidate status once for %i eligible Y queries', size => {
    let statusReads = 0
    const rows = Array.from({ length: size }, (_, index): WeldRow => ({ ...row(index + 1, `F${index + 1}Y1`),
      get finalStatus() { statusReads++; return 'не годен' },
    }))
    const check = consistency.createCompletedParentBranchChecker(rows)
    expect(statusReads).toBe(0)
    expect(check(rows[0], 'F1R1')).toBe(false)
    expect(check(rows[0], '')).toBe(false)
    expect(statusReads).toBe(0) // No candidate scan for non-Y sources.
    for (const source of rows) expect(check(source, String(source.joint))).toBe(false)
    // N candidate reads plus N source object spreads (same source identity guard).
    expect(statusReads).toBe(size * 2)
  })
})

describe('builder integration', () => {
  it('uses one checker per invocation, preserving full task payload and order against the old scan', () => {
    const rows = [row(1, 'S30', { rkResult: 'вырез' }), row(2, 'S30W1', { rkResult: 'вырез' }),
      row(3, 'S30W2', { rkResult: 'вырез' }), row(4, 'S30Y1', { rkResult: 'ремонт' }),
      row(5, 'S30Y2'), row(6, 'S30Y1R1', { rkResult: 'ремонт' })]
    const before = structuredClone(rows)
    const original = consistency.createCompletedParentBranchChecker
    const checks: ReturnType<typeof vi.fn<(row: WeldInput, sourceJoint: string) => boolean>>[] = []
    const factory = vi.spyOn(consistency, 'createCompletedParentBranchChecker').mockImplementation((values, settings) => {
      const check = vi.fn(original(values, settings)); checks.push(check); return check
    })
    const actual = buildRepeatedJointTasks(rows)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(checks[0].mock.calls.some(([, name]) => name.includes('Y'))).toBe(true)
    factory.mockImplementation((values, settings) => (source, name) =>
      consistency.hasCompletedParentBranch([...values], source, name, settings))
    expect(actual).toEqual(buildRepeatedJointTasks(rows))
    expect(rows).toEqual(before)
    expect(factory).toHaveBeenCalledTimes(2)
  })
})
