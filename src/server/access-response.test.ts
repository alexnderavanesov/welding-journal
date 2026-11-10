import { expect, it } from 'vitest'
import type { AccessIdentity, Permission } from '@/lib/access-permissions'
import { redactOperationResult } from './access-response'

const user = (...permissions: Permission[]): AccessIdentity => ({ id: 'reader', name: 'Читатель', email: '', title: '', role: 'user', revision: 1, permissions })
const line = { id: 1, projectTitle: 'P', subtitleCode: 'A', line: 'L1', groupName: 'Б(а)', category: 'II', weldControlPercent: 30, pvkControlPercent: 10 }
it('preserves reference parameters independently of access to weld facts', () => {
  const value = { items: [{ id: 1, name: 'TK', connectionType: 'С17', weldingMethods: ['РАД'] }] }
  expect(redactOperationResult(user('references.view'), 'technology-cards-api.ts', 'getTechnologyCardPage', value)).toEqual(value)
})
it('preserves line configuration, while nested joint responses keep their own field boundary', () => {
  const identity = user('lines.view')
  for (const [name, value] of [['findLineProgram', line], ['getLineProgramPage', { rows: [line] }], ['getLineProgramSection', { rows: [line] }], ['getLineProgramCalculation', { line }], ['getLineProgramsForImport', [line]]] as const) {
    expect(redactOperationResult(identity, 'line-program.ts', name, value)).toEqual(value)
  }
  expect(redactOperationResult(identity, 'line-program.ts', 'getLineProgramJointPage', { rows: [{ id: 2, joint: 'F1', weldingJournalNote: 'private', pstoResult: 'private', pvkControlPercent: 10 }] }))
    .toEqual({ rows: [{ id: 2, joint: 'F1' }] })
})
it('does not strip aggregate statistics or reference usage because names overlap weld fields', () => {
  const statistics = { lineSummary: { rows: [{ line: 'L1', projectTitle: 'P', wdi: 45 }] } }
  expect(redactOperationResult(user('statistics.view'), 'statistics.ts', 'getStatisticsServerResult', statistics)).toEqual(statistics)
  const usage = { testTypes: [['РК', 3]], rowsCount: 3 }
  expect(redactOperationResult(user('data.view'), 'weld-read-api.ts', 'getWeldDataUsageSummary', usage)).toEqual(usage)
})
it('preserves already authorized history of non-weld entities', () => {
  const details = { rows: [{ entity: 'technology_cards', changes: { connectionType: { before: 'С2', after: 'С17' } } }] }
  expect(redactOperationResult(user('references.view', 'history.view'), 'activity-api.ts', 'getActivityDetails', details)).toEqual(details)
})
it('never exempts similarly named unknown operations from weld redaction', () => {
  expect(redactOperationResult(user('references.view'), 'other.ts', 'getTechnologyCardPage', { connectionType: 'С17', lnkNote: 'private' })).toEqual({})
})
it('preserves registry IDs, versions and permit parameters without working-report access', () => {
  const specialist = { id: 12, revision: 3, name: 'Специалист', archived: false }
  for (const [name, value] of [['listSpecialists', { records: [specialist] }], ['saveSpecialist', specialist], ['archiveSpecialist', specialist]] as const) {
    expect(redactOperationResult(user('references.view'), 'specialists.ts', name, value)).toEqual(value)
  }
  const registry = { stamps: [{ id: 9, naksPermits: [{ id: 'permit', connectionType: 'С', materialGroup: 'М01' }] }], suspensions: [{ id: 4 }], revision: 'v1' }
  for (const name of ['loadWelderStampRegistrySnapshot', 'saveWelderStampRecords', 'saveWelderStampSuspensionRecords']) {
    expect(redactOperationResult(user('references.view'), 'welder-stamps.ts', name, registry)).toEqual(registry)
  }
})
it('preserves template identities and constructor field configuration for template-only access', () => {
  const template = { id: 'weldingJournal', version: 'v1', constructorConfig: { columns: [{ key: 'lnkNote' }], widths: { connectionType: 20 } } }
  for (const [name, value] of [['getRemoteDocumentTemplateInventory', { templates: [template], missing: [template] }], ['listRemoteDocumentTemplatesWithFiles', [template]], ['getRemoteDocumentTemplate', template], ['saveRemoteDocumentTemplate', template], ['updateRemoteDocumentTemplate', template]] as const) {
    expect(redactOperationResult(user('templates.view'), 'document-templates-api.ts', name, value)).toEqual(value)
  }
})
it('preserves common configuration, profile identity and already filtered history identifiers', () => {
  const configuration = { values: { data: { connectionType: ['С17'] }, processes: { preHeatTreatmentMode: 'allPsto' as const } } }
  expect(redactOperationResult(user('data.view'), 'app-settings.ts', 'listAppSettingsSnapshot', configuration)).toEqual(configuration)
  expect(redactOperationResult(user('data.view'), 'app-settings.ts', 'saveAppSetting', configuration)).toEqual(configuration)
  const profile = { id: 'user-id', name: 'Сотрудник' }
  expect(redactOperationResult(user('references.view'), 'account-api.ts', 'updateOwnProfile', profile)).toEqual(profile)
  const history = { rows: [{ id: 8, action: 'saveSpecialist' }] }
  expect(redactOperationResult(user('references.view', 'history.view'), 'activity-api.ts', 'listActivityHistory', history)).toEqual(history)
  const defaults = { pstoRequest: { pattern: '№{number}' } }
  expect(redactOperationResult(user('numbering.view'), 'document-grouping-preferences.ts', 'getDocumentGroupingDefaults', defaults)).toEqual(defaults)
  expect(redactOperationResult(user('numbering.view'), 'system-document-sequences.ts', 'getSystemDocumentSequences', { pstoRequest: 2 })).toEqual({ pstoRequest: 2 })
})

const schemeWeldInfo = {
  date: '2026-11-10', material1: '15Х5М', material2: '12Х18Н10Т', element1: 'Труба', element2: 'Отвод',
  d1: 108, d2: 89, t1: 6, t2: 4, stamp1: 'A1', stamp1Fact: 'B1', stamp2: 'A2', stamp2Fact: 'B2',
}
const schemeJoint = { key: 'p:1', rootId: 1, physicalId: 1, rowId: 1, label: 'S1R1', color: 'good', reason: 'Годен', welded: true, placedPage: 1, weldInfo: schemeWeldInfo }
const schemeResponses = [
  { name: 'getLineSchemeJoints', wrap: (joint: unknown) => ({ rows: [joint], total: 1 }) },
  { name: 'getLineSchemePoints', wrap: (joint: unknown) => ({ points: [{ id: 'point', page: 1, x: 0.1, y: 0.2, joint }], version: 1, next: null }) },
  { name: 'getLineSchemeDraftStates', wrap: (joint: unknown) => [joint] },
]
for (const { name, wrap } of schemeResponses) {
  it(`${name} preserves scheme labels/statuses but does not reveal welding facts to a scheme-only viewer`, () => {
    const value = wrap(schemeJoint), before = structuredClone(value)
    const hiddenInfo = Object.fromEntries(Object.keys(schemeWeldInfo).map(key => [key, null]))
    expect(redactOperationResult(user('schemes.view'), 'line-schemes-api.ts', name, value))
      .toEqual(wrap({ ...schemeJoint, weldInfo: hiddenInfo }))
    expect(value).toEqual(before)
  })
  it(`${name} keeps permitted shared dimensions while redacting welding-only tooltip fields`, () => {
    const hiddenInfo = Object.fromEntries(Object.keys(schemeWeldInfo).map(key => [key, null]))
    expect(redactOperationResult(user('schemes.view', 'lnk.view'), 'line-schemes-api.ts', name, wrap(schemeJoint)))
      .toEqual(wrap({ ...schemeJoint, weldInfo: { ...hiddenInfo, d1: 108, d2: 89, t1: 6, t2: 4 } }))
  })
  it(`${name} keeps all tooltip details for a user with welding access`, () => {
    expect(redactOperationResult(user('schemes.view', 'welding.view'), 'line-schemes-api.ts', name, wrap(schemeJoint)))
      .toEqual(wrap(schemeJoint))
  })
}
