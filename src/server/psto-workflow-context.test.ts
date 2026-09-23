import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  buildPstoWorkflowRequestOptionsQuery,
  buildPstoWorkflowRowsWhere,
  filterPstoWorkflowRows,
  PSTO_WORKFLOW_ROW_SELECT,
} from '@/server/psto-workflow-context'
import { normalizePstoWorkflowRowsRequest } from '@/server/weld-contracts'
import { WELD_TABLE_SELECT } from '@/server/weld-server-shared'

describe('PSTO modal workflow queries', () => {
  it('uses a compact projection with workflow-critical fields', () => {
    const keys = Object.keys(PSTO_WORKFLOW_ROW_SELECT)

    expect(keys).toEqual(expect.arrayContaining([
      'id',
      'rowVersion',
      'projectTitle',
      'line',
      'joint',
      'pstoRequired',
      'pstoRequest',
      'pstoResult',
      'heatTreatmentDiagram',
      'tvmtRequest',
      'tvmtResult',
    ]))
    expect(keys).not.toEqual(expect.arrayContaining([
      'materialFullName1',
      'materialCertificateNumber1',
      'weldingElectrodes',
      'weldingElectrodesCertificateNumber',
      'createdAt',
    ]))
    expect(keys.length).toBeLessThanOrEqual(Object.keys(WELD_TABLE_SELECT).length / 2)
  })

  it('normalizes ids so equivalent requests share a cache key', () => {
    expect(normalizePstoWorkflowRowsRequest({
      scope: 'fieldRows',
      rowIds: [8, 3, 8],
    })).toEqual({ scope: 'fieldRows', rowIds: [3, 8] })
    expect(() => normalizePstoWorkflowRowsRequest({
      scope: 'fieldRows',
      rowIds: [0],
    })).toThrow('некорректный список')
    expect(() => normalizePstoWorkflowRowsRequest({
      scope: 'fieldRows',
      rowIds: '7' as never,
    })).toThrow('некорректный список')
  })

  it('uses one PostgreSQL array parameter for an explicit row scope', () => {
    const query = compileWhere({ scope: 'fieldRows', rowIds: [11, 7] })

    expect(query.sql).toMatch(/= any\(\$\d+::integer\[\]\)/)
    expect(query.params.at(-1)).toEqual([7, 11])
  })

  it('limits request candidates in SQL before relation hydration', () => {
    const query = compileWhere({ scope: 'requestCandidates' })

    expect(query.sql).toContain('"weld_joints"."psto_required"')
    expect(query.sql).toContain('"weld_joints"."psto_request"')
    expect(query.sql).toContain('exists (select')
    expect(query.sql).toContain('"psto_repeat_cycles"')
  })

  it('keeps an explicitly selected row after the in-memory workflow guard', () => {
    const nonCandidate = { id: 200_000 } as WeldRow

    expect(filterPstoWorkflowRows([nonCandidate], 'requestCandidates')).toEqual([])
    expect(filterPstoWorkflowRows([nonCandidate], 'requestCandidates', [200_000])).toEqual([nonCandidate])
  })

  it('limits result registries to rows with PSTO result data', () => {
    const query = compileWhere({ scope: 'resultRegistry' })

    expect(query.sql).toContain('"weld_joints"."psto_result"')
    expect(query.sql).toContain('"weld_joints"."psto_date"')
    expect(query.sql).toContain('"weld_joints"."heat_treatment_diagram"')
  })

  it('narrows PSTO and TVMT result candidates by the selected current-cycle request', () => {
    const pstoQuery = compileWhere({
      scope: 'resultCandidates',
      requestName: 'ПСТО-17',
      requestDate: '2026-09-22',
    })
    expect(pstoQuery.sql).toContain('current_psto_repeat_cycle')
    expect(pstoQuery.params).toEqual(expect.arrayContaining(['ПСТО-17', '2026-09-22']))

    const tvmtQuery = compileWhere({
      scope: 'tvmtResultCandidates',
      requestName: 'ТВМТ-17',
      requestDate: '2026-09-23',
    })
    expect(tvmtQuery.sql).toContain('"weld_joints"."tvmt_request"')
    expect(tvmtQuery.params).toEqual(expect.arrayContaining(['ТВМТ-17', '2026-09-23']))
  })

  it('loads a request manager by exact name and date instead of scanning the registry', () => {
    const query = compileWhere({
      scope: 'requestRegistry',
      requestName: 'Заявка ПСТО-17',
      requestDate: '2026-09-01',
    })

    expect(query.sql).toContain('btrim(coalesce("weld_joints"."psto_request"::text')
    expect(query.params).toEqual(expect.arrayContaining(['Заявка ПСТО-17', '2026-09-01']))
  })

  it('bounds and searches request identities in one grouped SQL query', () => {
    const query = new PgDialect().sqlToQuery(buildPstoWorkflowRequestOptionsQuery({
      search: 'LINE-17',
    }))

    expect(query.sql).toContain('group by')
    expect(query.sql).toContain('order by date desc, name asc')
    expect(query.params).toEqual(expect.arrayContaining(['%line-17%', 201]))
  })
})

function compileWhere(request: Parameters<typeof buildPstoWorkflowRowsWhere>[0]) {
  return new PgDialect().sqlToQuery(sql`
    select 1 from ${weldJoints} where ${buildPstoWorkflowRowsWhere(request)}
  `)
}
