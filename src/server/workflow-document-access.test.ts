import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { assertPermission, type AccessIdentity, type Permission } from '@/lib/access-permissions'
import { buildWeldColumnValueFilter } from '@/lib/weld-column-choice-filter'
import { accessContext } from './access-store'
import { getOperationPermissions, getOperationPolicy } from './access-operation-policy'
import { requireStoredWorkflowDocumentPermission } from './workflow-document-access'
import { normalizeSystemDocumentHistoryGridRequest, normalizeWorkflowDocumentHistoryGridRequest } from './system-documents'
import { buildIndexedSystemDocumentHistoryGridSql } from './system-document-index'
import { redactOperationResult } from './access-response'
import { assertWholeWorkflowDocumentReference } from '@/lib/workflow-document-area'
import { changeSystemDocumentDate, normalizeSystemDocumentDateChangeData } from './system-document-date-workflow'
import { buildSystemDocumentDateChangePlan } from '@/lib/system-document-date-change'

vi.mock('@/db', () => ({ requireDb: () => { throw new Error('No database in permission regressions') } }))
const account = (permissions: Permission[]): AccessIdentity => ({ id: 'specialty', name: 'Специалист', email: '', title: '', role: 'user', revision: 1, permissions })
const reference = { type: 'lnkConclusion' as const, methodCode: 'ВИК', title: 'C', date: '2026-11-01', documentId: 3 }
const permissions = (name: string, input: unknown) => getOperationPermissions(getOperationPolicy(
  name === 'changeSystemDocumentDate' ? 'weld-mutations-api.ts' : 'system-documents.ts', name), input)
const allowed = (identity: AccessIdentity, required: Permission[]) => required.forEach(permission => assertPermission(identity, permission))
const grid = { type: 'lnkConclusion' as const, startRow: 0, endRow: 50, rowGroupCols: [], groupKeys: [], sortModel: [] }

describe('working document permissions stay within the specialty', () => {
  it('rejects narrowing a primary request to one method while keeping complete, pre-TO and TVMT references', () => {
    const primary = { type: 'lnkRequest' as const, title: 'Shared request', date: '2026-01-18' }
    for (const methodCode of ['ВИК', 'РК', 'УЗК', 'ПВК']) {
      expect(() => normalizeSystemDocumentDateChangeData({ reference: { ...primary, methodCode }, nextDate: '2026-01-19', expectedVersions: [] }))
        .toThrow('для всех видов контроля')
    }
    for (const target of [primary, { ...primary, methodCode: 'ТВМТ' }, { ...primary, sourceKind: 'beforeHeatTreatment' as const },
      { ...primary, sourceKind: 'beforeHeatTreatment' as const, methodCode: 'РК' }]) {
      expect(() => assertWholeWorkflowDocumentReference(target)).not.toThrow()
    }
  })
  it('rejects the partial request through the direct workflow, while a complete plan updates all six method positions', async () => {
    const primary = { type: 'lnkRequest' as const, title: 'Shared request', date: '2026-01-18' }
    await expect(changeSystemDocumentDate({ data: { reference: { ...primary, methodCode: 'ВИК' },
      nextDate: '2026-01-19', nextTitle: 'Renamed', expectedVersions: [{ id: 1, version: '1' }] } }))
      .rejects.toThrow('для всех видов контроля')
    const plan = buildSystemDocumentDateChangePlan({ reference: primary, nextDate: '2026-01-19', nextTitle: 'Renamed',
      rows: [1, 2, 3].map(id => ({ id, vikRequest: primary.title, vikRequestDate: primary.date, rkRequest: primary.title, rkRequestDate: primary.date })) })
    expect(plan).toMatchObject({ rowCount: 3, positionCount: 6 })
    expect(plan.rows.every(row => row.vikRequest === 'Renamed' && row.rkRequest === 'Renamed' &&
      row.vikRequestDate === '2026-01-19' && row.rkRequestDate === '2026-01-19')).toBe(true)
  })
  it.each([
    ['lnk', reference],
    ['lnk', { ...reference, sourceKind: 'beforeHeatTreatment' }],
    ['lnk', { ...reference, methodCode: 'ПВК' }],
    ['psto', { ...reference, type: 'pstoConclusion', methodCode: undefined }],
    ['psto', { ...reference, methodCode: 'ТВМТ', sourceKind: 'pstoCycle', cycleSequences: [2] }],
  ] as const)('%s editor reads and changes its document without documents permissions', (area, target) => {
    const identity = account([`${area}.view`, `${area}.edit`])
    const read = permissions('getSystemDocumentDateContext', target)
    const edit = permissions('changeSystemDocumentDate', { reference: target })
    expect(read).toEqual([`${area}.view`])
    expect(edit).toEqual([`${area}.view`, `${area}.edit`])
    expect(() => allowed(identity, read)).not.toThrow()
    expect(() => allowed(identity, edit)).not.toThrow()
    expect(() => allowed(identity, permissions('listSystemDocumentHistoryGrid', grid))).toThrow('Недостаточно прав')
    for (const suffix of ['view', 'delete'] as const) {
      const restricted = account([`${area}.view`, `${area}.${suffix}`])
      expect(() => allowed(restricted, read)).not.toThrow()
      expect(() => allowed(restricted, edit)).toThrow('Недостаточно прав')
    }
  })

  it('does not grant another specialty, generic documents, merge or specialist assignment', () => {
    const lnk = account(['lnk.view', 'lnk.edit'])
    expect(() => allowed(lnk, permissions('getSystemDocumentDateContext', { ...reference, methodCode: 'ТВМТ' }))).toThrow()
    expect(() => allowed(lnk, permissions('listWorkflowDocumentHistoryGrid', { ...grid, workflowArea: 'psto' }))).toThrow()
    for (const [file, name] of [['document-operations.ts', 'applyDocumentOperation'], ['specialists.ts', 'assignDocumentSpecialists']]) {
      expect(getOperationPolicy(file, name)).toBe('@documentEdit')
      expect(() => allowed(lnk, getOperationPermissions(getOperationPolicy(file, name), {}))).toThrow()
    }
    expect(() => allowed(account(['documents.view', 'documents.edit']), permissions('changeSystemDocumentDate', { reference }))).toThrow()
  })

  it('rechecks the actual stored type and registers it for transaction access revocation', () => {
    const context = { identity: account(['lnk.view', 'lnk.edit']), operation: 'changeSystemDocumentDate', operationId: 'test', area: 'lnk', permissions: [] as Permission[] }
    accessContext.run(context, () => {
      expect(() => requireStoredWorkflowDocumentPermission('system:tvmtConclusion', 'edit')).toThrow('Недостаточно прав')
      expect(() => requireStoredWorkflowDocumentPermission('custom:lnkConclusion', 'edit')).toThrow('Неизвестный тип')
      requireStoredWorkflowDocumentPermission('system:lnkConclusionVik', 'edit')
      expect(context.permissions).toEqual(['lnk.view', 'lnk.edit'])
      expect(() => allowed(account(['lnk.view']), context.permissions)).toThrow('Недостаточно прав')
    })
  })

  it('keeps hidden workflow facts redacted in both the context and save response', () => {
    const row = { id: 1, joint: 'F3', rowVersion: '4', vikConclusion: 'LNK', tvmtConclusion: 'TVMT', heatTreatmentDiagram: 'PSTO', weldDate: '2026-11-01' }
    for (const [file, name] of [['system-documents.ts', 'getSystemDocumentDateContext'], ['weld-mutations-api.ts', 'changeSystemDocumentDate']]) {
      const lnk = redactOperationResult(account(['lnk.view']), file, name, { rows: [row] })
      expect(lnk.rows[0]).toMatchObject({ joint: 'F3', vikConclusion: 'LNK' })
      expect(lnk.rows[0]).not.toHaveProperty('tvmtConclusion')
      expect(lnk.rows[0]).not.toHaveProperty('heatTreatmentDiagram')
      expect(lnk.rows[0]).not.toHaveProperty('weldDate')
      const psto = redactOperationResult(account(['psto.view']), file, name, { rows: [row] })
      expect(psto.rows[0]).toMatchObject({ tvmtConclusion: 'TVMT', heatTreatmentDiagram: 'PSTO' })
      expect(psto.rows[0]).not.toHaveProperty('vikConclusion')
    }
  })
})

describe('working registry scopes are enforced before search, totals and grouping', () => {
  it.each(['lnk', 'psto'] as const)('restricts %s storage types even when client filters ask for the other method', workflowArea => {
    const request = normalizeWorkflowDocumentHistoryGridRequest({ ...grid, workflowArea,
      search: 'secret', rowGroupCols: ['method'], columnFilters: { method: buildWeldColumnValueFilter([workflowArea === 'lnk' ? 'ТВМТ' : 'ВИК']) } })
    const query = new PgDialect().sqlToQuery(buildIndexedSystemDocumentHistoryGridSql(request))
    const types = query.params.filter(value => typeof value === 'string' && value.startsWith('system:'))
    expect(types.length).toBeGreaterThan(0)
    expect(types.every(value => workflowArea === 'psto' ? value === 'system:tvmtConclusion' : value !== 'system:tvmtConclusion')).toBe(true)
    expect(query.sql.indexOf('"generated_documents"."type" in')).toBeLessThan(query.sql.indexOf('"filtered_documents" as materialized'))
  })

  it('rejects missing/forged areas and incompatible types, and cannot alter the generic registry scope', () => {
    expect(() => normalizeWorkflowDocumentHistoryGridRequest(grid as never)).toThrow('Неизвестная рабочая область')
    expect(() => normalizeWorkflowDocumentHistoryGridRequest({ ...grid, workflowArea: 'documents' } as never)).toThrow('Неизвестная рабочая область')
    expect(() => normalizeWorkflowDocumentHistoryGridRequest({ ...grid, type: 'pstoRequest', workflowArea: 'lnk' })).toThrow('недоступен')
    const generic = normalizeSystemDocumentHistoryGridRequest({ ...grid, workflowArea: 'lnk' } as never)
    expect(generic).not.toHaveProperty('workflowArea')
    const query = new PgDialect().sqlToQuery(buildIndexedSystemDocumentHistoryGridSql(generic))
    expect(query.params).toContain('system:tvmtConclusion')
  })
})
