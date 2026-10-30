import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { getOperationPermissions, getOperationPolicy } from './access-operation-policy'
import { assertPermission, type AccessIdentity } from '@/lib/access-permissions'
import { assertReadableQuery, assertSubmittedWeldFields, assertImportedWeldFields } from './access-payload'
import { accessContext } from './access-store'
import { redactWeldData } from '@/lib/weld-field-access'
import { packProgramRows, unpackProgramRows } from '@/lib/line-program-row-payload'
const engineer: AccessIdentity = { id: 'engineer', name: 'Имя', email: '', title: 'Директор', role: 'user', permissions: ['welding.view', 'welding.edit', 'templates.view', 'templates.edit'], revision: 1 }
describe('server operation access boundary', () => {
  it('registers every current RPC export and rejects new/unknown operations', () => {
    const directory = resolve('src/server')
    let checked = 0
    for (const file of readdirSync(directory).filter(name => name.endsWith('.ts') && !name.includes('.test.'))) {
      const source = readFileSync(resolve(directory, file), 'utf8')
      for (const match of source.matchAll(/export const (\w+)\s*=\s*createServerFn\(/g)) {
        expect(() => getOperationPolicy(file, match[1]), `${file}#${match[1]}`).not.toThrow(); checked++
      }
    }
    expect(checked).toBeGreaterThan(170)
    expect(() => getOperationPolicy('new.ts', 'unsafe')).toThrow()
  })
  it('uses the requested report specialty on every shared grid entry point', () => {
    for (const name of ['readJournalGrid', 'readJournalGridBlocks', 'copyJournalGridRange', 'listJournalFilterOptions']) {
      const permissions = getOperationPermissions(getOperationPolicy('journal-grid-api.ts', name), { report: 'heatTreatment' })
      expect(permissions).toContain('psto.view')
      expect(() => permissions.forEach(permission => assertPermission(engineer, permission))).toThrow()
    }
  })
  it('does not let template editors modify DZ or bypass mixed field/query checks', () => {
    expect(() => getOperationPermissions('@settingEdit', { key: 'dispatcher' }).forEach(permission => assertPermission(engineer, permission))).toThrow()
    expect(() => assertReadableQuery(engineer, { columnFilters: { lnkNote: '=private' } })).toThrow()
    expect(() => assertReadableQuery(engineer, { sort: { fieldKey: 'pstoResult', direction: 'asc' } })).toThrow()
    expect(() => assertReadableQuery(engineer, { parts: [{ columns: ['joint', 'pstoResult'] }] })).toThrow()
    const context = { identity: engineer, operation: 'edit', operationId: 'test', permissions: ['welding.edit'] as const, area: 'welding' }
    accessContext.run({ ...context, permissions: [...context.permissions] }, () => {
      expect(() => assertSubmittedWeldFields({ weldingJournalNote: 'allowed', lnkNote: 'forbidden' }, { lnkNote: 'old' }, 'welding')).toThrow()
      expect(() => assertSubmittedWeldFields({ weldingJournalNote: 'allowed', lnkNote: 'old' }, { lnkNote: 'old' }, 'welding')).toThrow()
      accessContext.run({ ...context, identity: { ...engineer, permissions: [...engineer.permissions, 'lnk.view'] }, permissions: [...context.permissions] }, () => {
        expect(() => assertSubmittedWeldFields({ weldingJournalNote: 'allowed', lnkNote: 'old' }, { lnkNote: 'old' }, 'welding')).not.toThrow()
      })
      expect(() => assertSubmittedWeldFields({ joint: 'F1', officiality: 'действующий' }, undefined, 'welding')).not.toThrow()
      expect(() => assertSubmittedWeldFields({ joint: 'F1', officiality: 'неофициальный' }, undefined, 'welding')).toThrow()
    })
  })
  it('protects compressed dispatcher snapshots and direct task probes with the same field visibility', () => {
    for (const [file, name] of [['dispatcher-task-snapshot.ts', 'getDispatcherTaskSnapshot'], ['dispatcher-task-snapshot.ts', 'refreshDispatcherTaskSnapshot'], ['dispatcher-task-pages.ts', 'getDispatcherTaskBatch'], ['dispatcher-task-context.ts', 'getDispatcherTaskContext']]) {
      const permissions = getOperationPermissions(getOperationPolicy(file, name), { transport: 'gzip-v1' })
      expect(permissions).toEqual(['welding.view', 'lnk.view', 'psto.view'])
      expect(() => permissions.forEach(permission => assertPermission(engineer, permission))).toThrow()
    }
  })
  it('does not disclose welding notes to another specialty without journal access', () => {
    const lnkOnly = { ...engineer, permissions: ['lnk.view'] as AccessIdentity['permissions'] }
    expect(redactWeldData(lnkOnly, { id: 1, joint: 'F1', d1: 57, weldingJournalNote: 'hidden', lnkNote: 'visible', pstoResult: 'hidden' })).toEqual({ id: 1, joint: 'F1', d1: 57, lnkNote: 'visible' })
    expect(() => assertReadableQuery(lnkOnly, { columnFilters: { weldingJournalNote: 'hidden' } })).toThrow()
  })
  it('requires each specialty when importing historical control facts, before any mutation', () => {
    expect(getOperationPermissions('@replace', { records: [], deleteIds: [] })).toEqual(['welding.view', 'welding.import'])
    expect(getOperationPermissions('@replace', { records: [], deleteIds: [1] })).toContain('welding.delete')
    accessContext.run({ identity: engineer, operation: 'importWeldJoints', operationId: 'import', area: 'welding', permissions: ['welding.import'] }, () => {
      expect(() => assertImportedWeldFields({ joint: 'F1', weldingJournalNote: 'allowed' })).not.toThrow()
      expect(() => assertImportedWeldFields({ joint: 'F1', lnkNote: 'forged' })).toThrow()
      expect(() => assertImportedWeldFields({ joint: 'F1', pstoResult: 'forged' })).toThrow()
    })
  })
  it('redacts hidden values recursively but retains shared identity and officiality', () => {
    expect(redactWeldData(engineer, { rows: [{ id: 1, joint: 'F1', officiality: 'действующий', weldingJournalNote: 'visible', lnkNote: 'private', pstoResult: 'private', finalStatus: 'derived', activeDispatcherTasks: 'private', programRepairRequirements: [{ method: 'РК' }] }] }))
      .toEqual({ rows: [{ id: 1, joint: 'F1', officiality: 'действующий', weldingJournalNote: 'visible' }] })
  })
  it('does not restore hidden fields when compact line-program rows are unpacked', () => {
    const packed = packProgramRows([{ id: 1, joint: 'F1', lnkNote: null, pstoResult: null,
      programRepairRequirements: [],
      programChainState: { weldJointId: 1, kind: 'primary', physicalRootId: 1, sourceRowId: null,
        coilParentId: null, coilSide: null, replacedByCoil: false },
    }])
    const redacted = redactWeldData(engineer, packed)
    expect(redacted).not.toHaveProperty('chainStates')
    expect(redacted).not.toHaveProperty('emptyRepairRequirementIds')
    expect(unpackProgramRows(redacted).rows).toEqual([{ id: 1, joint: 'F1' }])
    const full = { ...engineer, permissions: [...engineer.permissions, 'lnk.view', 'psto.view'] as AccessIdentity['permissions'] }
    expect(unpackProgramRows(redactWeldData(full, packed))).toEqual(unpackProgramRows(packed))
  })
})
