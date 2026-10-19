import { projectPstoReportDisplayValues } from './report-filter-reference.test-helper'
import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq, sql } from 'drizzle-orm'

import { weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getCurrentPstoCycle } from '@/lib/tvmt-cycle'
import { getPstoDisplayValue } from '@/lib/lnk-status'
import { prepareReportRows } from '@/lib/use-report-rows'
import { toHeatTreatmentReportRow } from '@/lib/report-control-state'
import { filterWeldRowsByColumns } from '@/lib/weld-table-filtering'
import { buildPstoCurrentReportValueSql, PSTO_CURRENT_SQL_FIELD_KEYS } from './psto-report-current-values'

function row(values: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 1, weldDate: '2026-09-01', pstoRequired: 'да', pstoRequest: 'Основная',
    pstoRequestDate: '2026-09-01', pstoDate: '2026-09-02', pstoResult: 'проведено',
    heatTreatmentDiagram: 'Д1', pstoNote: 'Основное примечание',
    tvmtRequest: 'ТВМТ1', tvmtRequestDate: '2026-09-03', tvmtResult: 'не годен',
    tvmtConclusion: 'З1', tvmtConclusionDate: '2026-09-04',
    ...values,
  }
}

describe('PSTO current report projection', () => {
  it.each([
    ['unrequested', { pstoRequest: null, pstoResult: null }, 'ожидает заявку'],
    ['requested', { pstoRequest: '  Заявка  ', pstoResult: null }, 'ожидает'],
    ['stale waiting request label', { pstoRequest: 'Заявка', pstoResult: ' ОЖИДАЕТ ЗАЯВКУ ' }, 'ожидает'],
    ['stale waiting execution label', { pstoRequest: null, pstoResult: ' ОЖИДАЕТ ' }, 'ожидает заявку'],
    ['literal legacy request name', { pstoRequest: 'ожидает заявку', pstoResult: null }, 'ожидает'],
    ['inactive', { pstoRequired: 'нет', pstoRequest: 'Заявка', pstoResult: null }, ''],
    ['cancelled', { pstoRequired: 'отменен', pstoRequest: 'Заявка', pstoResult: null }, 'отменен'],
    ['sparse repeat', { pstoRequest: 'Заявка', pstoResult: null,
      pstoRepeatCycles: [{ id: 12, weldJointId: 1, sequence: 2, pstoRequest: 'Повторная' }] }, ''],
    ['stale rejected final status', { finalStatus: 'не годен', pstoRequest: null, pstoResult: null }, 'ожидает заявку'],
    ['stale duplicate final status', { finalStatus: 'не годен по дублю', pstoRequest: 'Заявка', pstoResult: null }, 'ожидает'],
    ['automatic VIK with preheat rejection', { hasVik: null, preHeatTreatmentLnkEnabled: true,
      preHeatTreatmentControls: [{ id: 31, weldJointId: 1, method: 'ВИК', result: 'ремонт' }] }, 'нет потребности'],
    ['legacy primary failed TVMT without PSTO execution', { pstoRequest: 'Заявка', pstoResult: null,
      tvmtResult: 'не годен', finalStatus: 'не годен' }, 'ожидает'],
    ['legacy repeat failed TVMT without PSTO execution', { pstoResult: 'проведено', tvmtResult: 'годен',
      finalStatus: 'не годен', pstoRepeatCycles: [{ id: 12, weldJointId: 1, sequence: 2,
        pstoRequest: 'Повторная', tvmtResult: 'не годен' }] }, ''],
  ] as Array<[string, Partial<WeldRow>, string]>)('matches the full UI preparation for all current SQL fields: %s', (_name, values, expectedResult) => {
    const source: WeldRow = { id: 1, weldDate: '2026-09-01', pstoRequired: 'да', ...values }
    const before = structuredClone(source)
    const fields = [...PSTO_CURRENT_SQL_FIELD_KEYS, 'pstoCycleSummary' as const]
    const [projected] = projectPstoReportDisplayValues([source], fields)
    const [prepared] = prepareReportRows([toHeatTreatmentReportRow(source)], [], undefined, undefined, undefined, true, true)
    expect(projected.pstoResult).toBe(expectedResult)
    for (const field of fields) {
      expect(String(projected[field] ?? ''), field).toBe(String(getPstoDisplayValue(prepared, field) ?? ''))
    }
    expect(source).toEqual(before)
  })

  it('uses repeat values for selection without changing the primary facts or relations', () => {
    const source = row({ pstoRepeatCycles: [{
      id: 12, weldJointId: 1, sequence: 2, pstoRequest: 'Повторная', pstoDate: '2026-10-02',
      pstoResult: 'проведено', tvmtResult: 'годен', tvmtConclusion: 'З2', pstoNote: 'Повторное',
    }] })
    const before = structuredClone(source)
    const [display] = projectPstoReportDisplayValues([source], ['pstoRequest', 'pstoDate', 'tvmtResult', 'tvmtConclusion', 'pstoNote'])
    expect(display).toMatchObject({ pstoRequest: 'Повторная', pstoDate: '2026-10-02', tvmtResult: 'годен', tvmtConclusion: 'З2', pstoNote: 'Повторное' })
    expect(filterWeldRowsByColumns([display], { tvmtResult: '=годен' })).toHaveLength(1)
    expect(filterWeldRowsByColumns([display], { tvmtResult: '=не годен' })).toHaveLength(0)
    expect(source).toEqual(before)
    expect(display.pstoRepeatCycles).toBe(source.pstoRepeatCycles)
    expect(getCurrentPstoCycle(source)?.sequence).toBe(2)
  })

  it('keeps every sparse repeat field empty instead of falling back to the primary cycle', () => {
    const source = row({ pstoRepeatCycles: [{ id: 12, weldJointId: 1, sequence: 2, pstoRequest: 'Повторная' }] })
    const fields = ['pstoRequestDate', 'pstoDate', 'heatTreatmentDiagram', 'pstoResult', 'pstoNote',
      'tvmtRequest', 'tvmtRequestDate', 'tvmtResult', 'tvmtConclusionDate', 'tvmtConclusion']
    const [display] = projectPstoReportDisplayValues([source], fields)
    for (const field of fields) expect(display[field as keyof WeldRow], field).toBe('')
    expect(filterWeldRowsByColumns([display], { pstoDate: '=', tvmtResult: '=' })).toHaveLength(1)
    expect(source.pstoDate).toBe('2026-09-02')
  })

  it.each(['нет', 'отменен'])('on %s ignores a later request-only repeat and retains the last performed cycle', pstoRequired => {
    const source = row({ pstoRequired, pstoRepeatCycles: [
      { id: 12, weldJointId: 1, sequence: 2, pstoDate: '2026-10-02', pstoResult: 'проведено', tvmtResult: 'годен' },
      { id: 13, weldJointId: 1, sequence: 3, pstoRequest: 'Сохранённая заявка', pstoRequestDate: '2026-10-05', tvmtResult: 'ожидает' },
    ] })
    const [display] = projectPstoReportDisplayValues([source], ['pstoDate', 'pstoResult', 'tvmtResult'])
    expect(display).toMatchObject({
      pstoDate: '2026-10-02', tvmtResult: 'годен',
      pstoResult: pstoRequired === 'отменен' ? 'проведено · назначение отменено' : 'проведено',
    })
    expect(getCurrentPstoCycle(source)?.sequence).toBe(2)
  })

  it('retains the performed primary cycle when the inactive repeat has no execution facts', () => {
    const source = row({ pstoRequired: 'нет', pstoRepeatCycles: [{ id: 12, weldJointId: 1, sequence: 2, pstoRequest: 'Заявка', tvmtResult: 'неизвестно' }] })
    const [display] = projectPstoReportDisplayValues([source], ['pstoDate', 'tvmtResult'])
    expect(display).toMatchObject({ pstoDate: '2026-09-02', tvmtResult: 'не годен' })
    expect(getCurrentPstoCycle(source)?.sequence).toBe(1)
  })

  it('keeps the latest request if no cycle has any execution facts', () => {
    const source: WeldRow = { id: 1, pstoRequired: 'отменен', pstoRequest: 'Основная', pstoRepeatCycles: [
      { id: 12, weldJointId: 1, sequence: 2, pstoRequest: 'История #2', pstoRequestDate: '2026-10-03' },
    ] }
    const [display] = projectPstoReportDisplayValues([source], ['pstoRequest', 'pstoRequestDate', 'pstoResult'])
    expect(display).toMatchObject({ pstoRequest: 'История #2', pstoRequestDate: '2026-10-03', pstoResult: 'отменен' })
  })

  it('derives no-need from the sparse current cycle without rewriting the performed primary', () => {
    const source = row({ hasVik: 'да', vikResult: 'ремонт', pstoRepeatCycles: [{ id: 12, weldJointId: 1, sequence: 2, pstoRequest: 'Повторная' }] })
    const [display] = projectPstoReportDisplayValues([source], ['pstoResult', 'pstoCycleSummary'])
    expect(display).toMatchObject({ pstoResult: 'нет потребности', pstoCycleSummary: 'нет потребности' })
    expect(source.pstoResult).toBe('проведено')
  })

  it('only shows the cancellation basis/date for a cancelled assignment', () => {
    const values = { pstoControlBasis: 'Основание', pstoCancellationDate: '2026-10-10' }
    const fields = Object.keys(values)
    expect(projectPstoReportDisplayValues([row(values)], fields)[0]).toMatchObject({ pstoControlBasis: '', pstoCancellationDate: '' })
    expect(projectPstoReportDisplayValues([row({ ...values, pstoRequired: 'отменен' })], fields)[0]).toMatchObject(values)
  })

  it('limits SQL selection to the joint and selects a cycle before its possibly empty value', () => {
    const { sql: query } = new PgDialect().sqlToQuery(buildPstoCurrentReportValueSql('tvmtConclusionDate')!)
    expect(query).toContain('"psto_repeat_cycles"."weld_joint_id" = "weld_joints"."id"')
    expect(query).toContain('"psto_repeat_cycles"."sequence" >= 2')
    expect(query).toContain('"psto_display_cycles"."sequence" desc')
    expect(query).toContain('"psto_display_cycles"."performed" end desc')
    expect(query).toContain('limit 1')
    expect(query).not.toMatch(/coalesce\(\s*\(\s*select/i)
    expect(buildPstoCurrentReportValueSql('line')).toBeUndefined()
  })

  it.each([...PSTO_CURRENT_SQL_FIELD_KEYS].filter(key => key !== 'pstoControlBasis' && key !== 'pstoCancellationDate'))(
    'retains joint correlation in product predicates, sorting, facets and the direct SQL probe: %s', field => {
      // Compile only: a single-table projection and a SQL expression nested
      // inside a predicate/facet are processed differently by Drizzle.
      const db = drizzle.mock()
      const current = buildPstoCurrentReportValueSql(field)!
      const queries = [
        db.select({ id: weldJoints.id }).from(weldJoints).where(eq(current, 'value')).orderBy(current).toSQL().sql,
        db.select({ value: sql`coalesce(${current}::text, '')`, count: sql`count(*)` })
          .from(weldJoints).groupBy(sql`1`).toSQL().sql,
        new PgDialect().sqlToQuery(sql`select ${current} as ${sql.identifier(field)} from ${weldJoints}`).sql,
      ]
      for (const query of queries) {
        expect(query).toContain('"psto_repeat_cycles"."weld_joint_id" = "weld_joints"."id"')
        expect(query).not.toContain('"weld_joint_id" = "id"')
      }
    },
  )
})
