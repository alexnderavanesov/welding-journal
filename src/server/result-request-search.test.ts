import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it } from 'vitest'
import { buildLnkResultRequestOptionsQuery } from './lnk-workflow-context'
import { buildPstoWorkflowRequestOptionsQuery } from './psto-workflow-context'
import { normalizeLnkWorkflowRequestSummaryRequest, normalizePstoWorkflowRequestOptionsRequest } from './weld-contracts'

it.each(['primary', 'beforeHeatTreatment'] as const)('searches %s request identities before applying the existing document limit', resultScope => {
  const query = new PgDialect().sqlToQuery(buildLnkResultRequestOptionsQuery({ resultScope, methodCode: 'РК', search: 'Ёлка 100%', limit: 200_000 }))
  expect(query.params.at(-1)).toBe(201)
  expect(query.params).toContain('%елка 100\\%%')
  expect(query.sql.indexOf('group by btrim(name)')).toBeLessThan(query.sql.lastIndexOf('limit'))
  expect(query.sql).not.toContain('limit 500')
  expect(query.sql).toContain(resultScope === 'primary' ? '"weld_joints"."rk_request" as name' : 'c.request_name as name')
  expect(query.sql).not.toContain('"weld_joints"."vik_request" as name')
})

it.each(['psto', 'tvmt'] as const)('searches the actual current %s cycle without falling back to an older request', resultScope => {
  const query = new PgDialect().sqlToQuery(buildPstoWorkflowRequestOptionsQuery({ resultScope, search: 'Needle', limit: 200_000 }))
  expect(query.params.at(-1)).toBe(201)
  expect(query.params).toContain('%needle%')
  expect(query.sql).toContain(`"psto_repeat_cycles"."${resultScope}_request" as name`)
  expect(query.sql).toContain('case when current_cycle.id is null')
  expect(query.sql).toContain('order by "psto_repeat_cycles"."sequence" desc limit 1')
  expect(query.sql).toContain('group by btrim(name)')
  expect(query.sql).not.toContain('coalesce(current_cycle.name')
})

it('rejects unknown stage or method selectors rather than changing the permission area', () => {
  expect(() => normalizeLnkWorkflowRequestSummaryRequest({ resultScope: 'tvmt' as never })).toThrow()
  expect(() => normalizeLnkWorkflowRequestSummaryRequest({ resultScope: 'primary', methodCode: 'ТВМТ' })).toThrow()
  expect(() => normalizePstoWorkflowRequestOptionsRequest({ resultScope: 'primary' as never })).toThrow()
})

it('preserves lookup by the displayed Russian date as well as ISO dates', () => {
  const query = new PgDialect().sqlToQuery(buildLnkResultRequestOptionsQuery({ resultScope: 'primary', methodCode: 'ВИК', search: '02.10.2026' }))
  expect(query.sql).toContain("to_char(nullif(date, '')::date, 'DD.MM.YYYY')")
  expect(query.params).toContain('%02.10.2026%')
})
