import { expect, it } from 'vitest'
import { assertPermission, type AccessIdentity, type Permission } from '@/lib/access-permissions'
import { canViewWeldField, redactWeldData } from '@/lib/weld-field-access'
import { WELD_MUTATION_FIELD_KEYS, restrictWeldMutationRecord } from './weld-mutation-policy'
import { mergeWeldRecordsWithPrevious } from './weld-save-validation'
import { getOperationPermissions, getOperationPolicy } from './access-operation-policy'
import type { WeldJoint } from '@/db/schema'
import { WELD_FIELDS, isVirtualWeldField } from '@/lib/weld-fields'

const user = (permissions: Permission[]): AccessIdentity => ({ id: 'contract', role: 'user', permissions, name: '', email: '', title: '', revision: 1 })
const reports = [['weldingJournal', 'welding'], ['lnk', 'lnk'], ['heatTreatment', 'psto']] as const

it('derived report fields never enter ordinary mutation payloads or inherit journal access', () => {
  const virtual = WELD_FIELDS.filter(isVirtualWeldField).map(field => field.key)
  for (const scope of ['welding', 'lnk', 'psto'] as const) {
    expect(restrictWeldMutationRecord({ id: 1, ...Object.fromEntries(virtual.map(key => [key, 'forged'])) }, scope)).toEqual({ id: 1 })
  }
  expect(canViewWeldField(user(['welding.view']), 'pstoCycleSummary')).toBe(false)
  expect(canViewWeldField(user(['psto.view']), 'pstoCycleSummary')).toBe(true)
})

// Small cross-layer contracts: test the permitted workflow as well as refusals.
// New fields/handlers must not make a specialty depend on unrelated access.
it.each(reports)('%s selection, grid, output and save use their own specialty', (report, area) => {
  const identity = user([`${area}.view`, `${area}.edit`, `${area}.export`])
  for (const [file, name, data] of [
    ['journal-grid-api.ts', 'readJournalGrid', { report }],
    ['journal-grid-api.ts', 'selectJournalGridRows', { report }],
    ['weld-read-api.ts', 'listWeldJointRowsByIds', { report, ids: [1] }],
    ['weld-read-api.ts', 'readReportOutputSnapshot', { report, kind: 'current' }],
    ['weld-mutations-api.ts', 'updateWeldJoints', { mutationScope: area }],
  ] as const) {
    const permissions = getOperationPermissions(getOperationPolicy(file, name), data)
    expect(() => permissions.forEach(permission => assertPermission(identity, permission)), name).not.toThrow()
    expect(() => permissions.forEach(permission => assertPermission(user([]), permission)), name).toThrow()
  }
})

it.each(reports)('%s editable fields remain visible and survive a partial save; foreign facts and relations remain intact', (_report, area) => {
  const identity = user([`${area}.view`, `${area}.edit`])
  for (const field of WELD_MUTATION_FIELD_KEYS[area]) {
    expect(canViewWeldField(identity, field), `${area}: ${field}`).toBe(true)
    const payload = restrictWeldMutationRecord({ id: 1, [field]: 'changed' }, area)
    expect(payload[field], field).toBe('changed')
  }
  const previous = {
    id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1',
    weldDate: '2026-10-01', weldingJournalNote: 'welding', lnkNote: 'lnk', pstoNote: 'psto',
    vikRequest: 'R1', pstoRequest: 'P1',
    duplicateControls: [{ id: 3 }], preHeatTreatmentControls: [{ id: 4 }], pstoRepeatCycles: [{ id: 5 }],
  }
  const ownNote = ({ welding: 'weldingJournalNote', lnk: 'lnkNote', psto: 'pstoNote' } as const)[area]
  // A response can hide other specialties; their absence is not a deletion.
  const visible = redactWeldData(identity, previous)
  const patch = restrictWeldMutationRecord({ ...visible, [ownNote]: null }, area)
  const [merged] = mergeWeldRecordsWithPrevious([patch], new Map([[1, previous as unknown as WeldJoint]]))
  expect(merged).toEqual({ ...previous, [ownNote]: null })
  expect(previous[ownNote]).not.toBeNull()
})

it('selected-row scope is explicit: foreign and non-working reports cannot bypass the permission boundary', () => {
  const policy = getOperationPolicy('weld-read-api.ts', 'listWeldJointRowsByIds')
  expect(getOperationPermissions(policy, {})).toEqual(['welding.view'])
  for (const report of ['statistics', 'documents', 'unknown']) expect(() => getOperationPermissions(policy, { report })).toThrow()
  expect(() => getOperationPermissions(policy, { report: 'heatTreatment' }).forEach(permission => assertPermission(user(['lnk.view']), permission))).toThrow()
})
