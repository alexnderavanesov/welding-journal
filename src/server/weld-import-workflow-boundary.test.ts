import { describe, expect, it } from 'vitest'
import type { AccessIdentity } from '@/lib/access-permissions'
import { accessContext } from './access-store'
import { assertImportedWeldFields } from './access-payload'

// Independent list of workflow facts: import permission and specialty rights
// must never turn a journal import into a request/result/document command.
const workflowFields = [
  'vikRequest', 'vikRequestDate', 'vikResult', 'vikConclusion', 'vikConclusionDate',
  'rkRequest', 'rkRequestDate', 'rkResult', 'rkConclusion', 'rkConclusionDate',
  'uzkRequest', 'uzkRequestDate', 'uzkResult', 'uzkConclusion', 'uzkConclusionDate',
  'pvkRequest', 'pvkRequestDate', 'pvkResult', 'pvkConclusion', 'pvkConclusionDate',
  'pstoRequest', 'pstoRequestDate', 'pstoResult', 'pstoDate', 'heatTreatmentDiagram',
  'tvmtRequest', 'tvmtRequestDate', 'tvmtResult', 'tvmtConclusion', 'tvmtConclusionDate',
  'jsrDocument', 'checklistDocument', 'zniDocument', 'custom1Document', 'custom2Document',
  'finalStatus', 'dispatcherTasks', 'createdAt', 'lnkNote', 'pstoNote',
]
const identity = (role: AccessIdentity['role']): AccessIdentity => ({ id: 'importer', role,
  name: '', email: '', title: '', revision: 1,
  permissions: ['welding.view', 'welding.import', 'lnk.view', 'lnk.edit', 'psto.view', 'psto.edit'] })

describe.each(['owner', 'user', 'local'] as const)('workflow import boundary: %s', role => {
  function check(record: Record<string, unknown>, previous?: Record<string, unknown>) {
    const run = () => assertImportedWeldFields(record, previous)
    return role === 'local' ? run() : accessContext.run({ identity: identity(role),
      operation: 'importWeldJoints', operationId: 'import', area: 'welding', permissions: ['welding.import'] }, run)
  }
  it.each(workflowFields)('rejects supplied %s even with all specialty rights', key => {
    expect(() => check({ joint: 'F15', [key]: 'history' })).toThrow('недоступны для импорта')
  })
  it('reports simultaneous forbidden facts and accepts ordinary journal fields', () => {
    let message = ''
    try { check({ joint: 'F15', rkRequest: 'R', rkResult: 'годен', pstoResult: 'проведено' }) }
    catch (error) { message = (error as Error).message }
    for (const key of ['rkRequest', 'rkResult', 'pstoResult']) expect(message).toContain(key)
    expect(() => check({ joint: 'F15', hasVik: 'да', hasRk: '10%', weldingJournalNote: 'note',
      stamp1K: 'AAAA', stamp1Z: 'BBBB', d1: 159, t1: 8, vikBoq: 'work', pstoKs3: 'closed' })).not.toThrow()
  })
  it('does not grant permission to change or clear existing history', () => {
    const previous = { id: 15, rkRequest: 'R', rkResult: 'годен' }
    expect(() => check({ id: 15, weldingJournalNote: 'correction' }, previous)).not.toThrow()
    expect(() => check({ id: 15, rkResult: 'годен' }, previous)).not.toThrow()
    expect(() => check({ id: 15, rkResult: null }, previous)).toThrow('недоступны для импорта')
    expect(() => check({ id: 15, rkResult: 'ремонт' }, previous)).toThrow('недоступны для импорта')
    expect(previous).toEqual({ id: 15, rkRequest: 'R', rkResult: 'годен' })
  })
})
