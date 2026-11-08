import { assertWelderStampArchiveDatesAreUnused } from './welder-stamps'
import { describe, expect, it } from 'vitest'
import type { Permission } from '@/lib/access-permissions'
import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { buildPreHeatTreatmentRequestWrites, buildPreHeatTreatmentResultWrite, buildPreHeatTreatmentResultCorrectionWrite } from '@/lib/pre-heat-treatment-control-updates'
import { buildRepeatPstoResultCycle } from '@/lib/psto-repeat-cycle-updates'
import { applyPstoCycleCorrection } from '@/lib/psto-cycle-corrections'
import { assertNoNewLnkChronologyIssues, getLnkChronologyIssueIdentity, getLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { assertNoNewPstoChronologyIssues } from '@/lib/psto-chronology-checks'
import { formatAccessValidationMessage } from './access-validation-message'
import { accessContext } from './access-store'

const base = { id: 1, joint: 'F1', weldDate: '2026-10-11', pstoRequired: 'да', hasVik: 'да', preHeatTreatmentMode: 'allPsto' as const } as WeldRow
const control = { id: 1, weldJointId: 1, method: 'ВИК' as const, requestName: 'V-1', requestDate: '2026-10-01', result: 'ожидает НК' }
const formatMessage = formatAccessValidationMessage
function asViewer<T>(area: 'lnk' | 'psto', owner: boolean, run: () => T) {
  const permissions: Permission[] = [`${area}.view`, `${area}.edit`]
  return accessContext.run({ identity: { id: 'test', name: 'Test', email: '', title: '', role: owner ? 'owner' : 'user', permissions, revision: 1 },
    operation: 'test', operationId: 'test', area, permissions }, run)
}
function message(run: () => unknown) { try { run(); return '' } catch (error) { return (error as Error).message } }

for (const owner of [false, true]) describe(owner ? 'owner' : 'limited user', () => {
  const cases: Array<{ name: string; area: 'lnk' | 'psto'; run: () => unknown }> = [
    { name: 'pre-TO request', area: 'lnk', run: () => buildPreHeatTreatmentRequestWrites({ row: base,
      methodCodes: ['ВИК'], requestName: 'V-1', requestDate: '2026-10-01', formatMessage }) },
    { name: 'pre-TO result', area: 'lnk', run: () => buildPreHeatTreatmentResultWrite({ row: { ...base, preHeatTreatmentControls: [control] },
      methodCode: 'ВИК', result: 'годен', conclusionName: 'C-1', controlDate: '2026-10-05', formatMessage }) },
    { name: 'pre-TO correction', area: 'lnk', run: () => buildPreHeatTreatmentResultCorrectionWrite({ row: { ...base, preHeatTreatmentControls: [control] },
      control, result: 'годен', conclusionName: 'C-1', controlDate: '2026-10-05', formatMessage }) },
    { name: 'repeat PSTO result', area: 'psto', run: () => buildRepeatPstoResultCycle({ row: { ...base, preHeatTreatmentMode: 'selected' as const,
      pstoRepeatCycles: [{ id: 2, weldJointId: 1, sequence: 2, pstoRequest: 'P-2', pstoRequestDate: '2026-10-01' }] },
      diagramName: 'D-2', pstoDate: '2026-10-05', formatMessage }) },
    { name: 'PSTO correction', area: 'psto', run: () => applyPstoCycleCorrection({ ...base, preHeatTreatmentMode: 'selected' as const,
      pstoRequest: 'P-1', pstoRequestDate: '2026-10-12' }, { sequence: 1, stage: 'pstoRequest', action: 'update',
      name: 'P-1', date: '2026-10-01' }, DEFAULT_SAVE_CHECK_SETTINGS, formatMessage) },
    { name: 'PSTO document date validation', area: 'psto', run: () => assertNoNewPstoChronologyIssues(
      [{ ...base, pstoRequest: 'P-1', pstoRequestDate: '2026-10-01' }], [base], DEFAULT_SAVE_CHECK_SETTINGS, formatMessage) },
    { name: 'LNK document date validation', area: 'lnk', run: () => assertNoNewLnkChronologyIssues(
      [{ ...base, vikRequest: 'V-1', vikRequestDate: '2026-10-01' }], [base], DEFAULT_SAVE_CHECK_SETTINGS,
      { formatValidationMessage: formatMessage }) },
  ]
  for (const item of cases) it(`${item.name}: preserves rejection and protects weld date`, () => {
    const error = asViewer(item.area, owner, () => message(item.run))
    expect(error).toContain('раньше даты сварки')
    expect(error.includes('11.10.2026')).toBe(owner)
    expect(error).not.toContain('2026-10-11')
  })
  it('pre-TO request protects the hidden PSTO boundary', () => {
    const error = asViewer('lnk', owner, () => message(() => buildPreHeatTreatmentRequestWrites({
      row: { ...base, weldDate: '2026-10-01', pstoDate: '2026-10-11' }, methodCodes: ['ВИК'],
      requestName: 'V-1', requestDate: '2026-10-20', formatMessage,
    })))
    expect(error).toContain('позже даты ПСТО')
    expect(error.includes('11.10.2026')).toBe(owner)
  })
  it('PSTO correction protects a hidden LNK date', () => {
    const row = { ...base, weldDate: '2026-10-01', pstoRequest: 'P-1', pstoRequestDate: '2026-10-01', pstoDate: '2026-10-12',
      pstoResult: 'проведено', heatTreatmentDiagram: 'D-1',
      preHeatTreatmentControls: [{ ...control, result: 'годен', conclusionName: 'C-1', conclusionDate: '2026-10-11' }] }
    const error = asViewer('psto', owner, () => message(() => applyPstoCycleCorrection(row,
      { sequence: 1, stage: 'pstoResult', action: 'update', name: 'D-1', date: '2026-10-10' }, DEFAULT_SAVE_CHECK_SETTINGS, formatMessage)))
    expect(error).toContain('позже даты ПСТО')
    expect(error.includes('11.10.2026')).toBe(owner)
  })
})

it('formatting does not change historical issue identities or tolerate a new invalid date', () => {
  const previous = { ...base, vikRequest: 'V-1', vikRequestDate: '2026-10-01' }
  const identities = () => getLnkChronologyIssues([previous]).map(getLnkChronologyIssueIdentity)
  const before = identities()
  asViewer('lnk', false, () => {
    expect(() => assertNoNewLnkChronologyIssues([{ ...previous, isometry: 'ISO-2' }], [previous], DEFAULT_SAVE_CHECK_SETTINGS,
      { formatValidationMessage: formatMessage })).not.toThrow()
    expect(() => assertNoNewLnkChronologyIssues([{ ...previous, vikRequestDate: '2026-10-02' }], [previous], DEFAULT_SAVE_CHECK_SETTINGS,
      { formatValidationMessage: formatMessage })).toThrow('раньше даты сварки')
  })
  expect(identities()).toEqual(before)
})

for (const owner of [false, true]) it(`stamp registry ${owner ? 'owner' : 'limited'} does not disclose a hidden joint/date`, async () => {
  const tx = { execute: async () => ({ rows: [{ stamp: 'N1', date: '2026-10-01', joint: 'PRIVATE-JOINT', weldDate: '2026-10-11' }] }) } as unknown as Parameters<typeof assertWelderStampArchiveDatesAreUnused>[0]
  const next = [{ id: 1, naksStamp: 'N1', internalStamp: '', archived: true, archivedAt: '2026-10-01' }] as unknown as Parameters<typeof assertWelderStampArchiveDatesAreUnused>[2]
  const permissions: Permission[] = ['references.view', 'references.edit']
  const error = await accessContext.run({ identity: { id: 'test', name: 'Test', email: '', title: '', role: owner ? 'owner' : 'user', permissions, revision: 1 },
    operation: 'saveWelderStampRecords', operationId: 'test', area: 'references', permissions }, async () => {
    try { await assertWelderStampArchiveDatesAreUnused(tx, [], next); return '' }
    catch (error) { return (error as Error).message }
  })
  expect(error).toContain('Нельзя архивировать клеймо N1')
  expect(error.includes('11.10.2026')).toBe(owner)
  expect(error.includes('PRIVATE-JOINT')).toBe(owner)
})
