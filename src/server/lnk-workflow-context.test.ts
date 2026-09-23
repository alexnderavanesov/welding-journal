import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { weldJoints } from '@/db/schema'
import {
  buildLnkWorkflowRequestDocumentSummary,
  buildLnkWorkflowRequestSummaryQuery,
  buildLnkWorkflowRowsWhere,
  LNK_WORKFLOW_ROW_SELECT,
} from '@/server/lnk-workflow-context'
import { normalizeLnkWorkflowRowsRequest } from '@/server/weld-contracts'
import { WELD_TABLE_SELECT } from '@/server/weld-server-shared'

describe('LNK modal workflow queries', () => {
  it('uses a compact row projection with every workflow-critical field', () => {
    const keys = Object.keys(LNK_WORKFLOW_ROW_SELECT)

    expect(keys).toEqual(expect.arrayContaining([
      'id',
      'rowVersion',
      'projectTitle',
      'line',
      'joint',
      'd1',
      'd2',
      'preHeatTreatmentLnkExempt',
      'vikRequest',
      'vikResult',
      'vikConclusion',
      'lnkDefectDescription',
    ]))
    expect(keys).not.toEqual(expect.arrayContaining([
      'materialFullName1',
      'materialCertificateNumber1',
      'weldingElectrodes',
      'weldingElectrodesCertificateNumber',
      'lnkNote',
      'createdAt',
    ]))
    expect(keys.length).toBeLessThan(Object.keys(WELD_TABLE_SELECT).length / 2)
  })

  it('aggregates the workflow summary in SQL instead of returning source weld rows', () => {
    const query = new PgDialect().sqlToQuery(buildLnkWorkflowRequestSummaryQuery())

    expect(query.sql).toContain('union all')
    expect(query.sql).toContain('count(distinct row_id)')
    expect(query.sql).toContain('group by name, request_date')
    expect(query.sql).toContain('select distinct on (name, request_date)')
    expect(query.sql).not.toContain('material_full_name_1')
    expect(query.sql).not.toContain('welding_electrodes_certificate_number')
  })

  it('builds request options and names from one row per document', () => {
    const summary = buildLnkWorkflowRequestDocumentSummary([
      {
        name: 'Заявка Б',
        date: '2026-09-02',
        hasPrimary: true,
        rowCount: '2',
        positionCount: 3,
        methodCodes: ['РК', 'ВИК'],
        searchText: 'линия 1 f1 f2',
        completedRowId: 17,
        completedJoint: 'F2',
        completedMethodCode: 'РК',
      },
      {
        name: 'Заявка А',
        date: '2026-09-01',
        hasPrimary: false,
        rowCount: 0,
        positionCount: 0,
        methodCodes: null,
        searchText: null,
        completedRowId: null,
        completedJoint: null,
        completedMethodCode: null,
      },
    ])

    expect(summary.requestNames).toEqual(['Заявка А', 'Заявка Б'])
    expect(summary.requestOptions).toEqual([expect.objectContaining({
      name: 'Заявка Б',
      rowCount: 2,
      positionCount: 3,
      methodCodes: ['ВИК', 'РК'],
      searchText: 'линия 1 f1 f2',
      disabledReason: 'Заявка закрыта для дополнения: по стыку F2, РК уже внесен результат или заключение.',
    })])
  })

  it('normalizes row ids so equivalent registry requests share one cache key', () => {
    expect(normalizeLnkWorkflowRowsRequest({
      scope: 'resultRegistry',
      rowIds: [8, 3, 8],
    })).toEqual({ scope: 'resultRegistry', rowIds: [3, 8] })
    expect(() => normalizeLnkWorkflowRowsRequest({
      scope: 'resultRegistry',
      rowIds: [0],
    })).toThrow('некорректный список')
    expect(() => normalizeLnkWorkflowRowsRequest({
      scope: 'resultRegistry',
      rowIds: '7' as never,
    })).toThrow('некорректный список')
  })

  it('limits request composers to server-side request candidates', () => {
    const query = compileWhere({ scope: 'requestCandidates' })

    expect(query.sql).toContain('"weld_joints"."vik_request"')
    expect(query.sql).toContain('not exists')
    expect(query.sql).toContain('"duplicate_controls"')
    expect(query.sql).toContain('"pre_heat_treatment_controls"')
  })

  it('narrows candidate rows by the selected method and request before applying the limit', () => {
    const requestQuery = compileWhere({
      scope: 'requestCandidates',
      methodKeys: ['rkRequest'],
    })
    expect(requestQuery.sql).toContain('"weld_joints"."has_rk"')
    expect(requestQuery.sql).toContain('"weld_joints"."rk_request"')

    const resultQuery = compileWhere({
      scope: 'resultCandidates',
      methodKeys: ['rkRequest'],
      requestName: 'РК-17',
      requestDate: '2026-09-22',
    })
    expect(resultQuery.sql).toContain('"weld_joints"."rk_result"')
    expect(resultQuery.params).toEqual(expect.arrayContaining(['РК-17', '2026-09-22']))
  })

  it('narrows before-heat-treatment candidates by relation method and request', () => {
    const query = compileWhere({
      scope: 'preHeatTreatmentResultCandidates',
      methodKeys: ['uzkRequest'],
      requestName: 'УЗК-ДО-17',
      requestDate: '2026-09-22',
    })

    expect(query.sql).toContain('"pre_heat_treatment_controls"')
    expect(query.params).toEqual(expect.arrayContaining(['УЗК', 'УЗК-ДО-17', '2026-09-22']))
  })

  it.each(['requestCandidates', 'resultCandidates'] as const)(
    'keeps blocked %s rows searchable in strict mode so the UI can explain the missing stage',
    (scope) => {
      const strict = compileWhere({ scope, methodKeys: ['vikRequest'], allowPrimaryBeforePreviousStagesComplete: false })
      const permissive = compileWhere({ scope, methodKeys: ['vikRequest'], allowPrimaryBeforePreviousStagesComplete: true })
      expect(strict).toEqual(permissive)
    },
  )

  it('limits the request manager to one selected request identity', () => {
    const query = compileWhere({
      scope: 'requestRegistry',
      requestName: 'Заявка 17',
      requestDate: '2026-09-22',
    })

    expect(query.sql).toContain('"weld_joints"."vik_request"')
    expect(query.sql).toContain('"weld_joints"."vik_request_date"')
    expect(query.params).toEqual(expect.arrayContaining(['Заявка 17', '2026-09-22']))
  })

  it('limits result registries to final results and selected ids', () => {
    const query = compileWhere({ scope: 'resultRegistry', rowIds: [11, 7] })

    expect(query.sql).toContain('"weld_joints"."id" = any(')
    expect(query.sql).toContain('lower(btrim(coalesce("weld_joints"."vik_result"')
    expect(query.params).toContainEqual([7, 11])
    expect(query.params).toEqual(expect.arrayContaining(['годен', 'ремонт', 'вырез']))
  })

  it('uses relation existence checks for before-heat-treatment registries', () => {
    const requestQuery = compileWhere({ scope: 'preHeatTreatmentRequestRegistry' })
    const resultQuery = compileWhere({ scope: 'preHeatTreatmentResultRegistry' })

    expect(requestQuery.sql).toContain('exists (select')
    expect(requestQuery.sql).toContain('"pre_heat_treatment_controls"."request_name"')
    expect(resultQuery.sql).toContain('"pre_heat_treatment_controls"."result"')
  })

  it('loads an explicitly edited field row without applying a registry predicate', () => {
    const query = compileWhere({ scope: 'fieldRows', rowIds: [13] })

    expect(query.sql).toContain('"weld_joints"."id" = any(')
    expect(query.params).toContainEqual([13])
    expect(query.sql).not.toContain('"pre_heat_treatment_controls"."result"')
  })
})

function compileWhere(request: Parameters<typeof buildLnkWorkflowRowsWhere>[0]) {
  return new PgDialect().sqlToQuery(sql`
    select 1 from ${weldJoints} where ${buildLnkWorkflowRowsWhere(request)}
  `)
}
