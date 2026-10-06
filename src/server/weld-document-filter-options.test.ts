import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { PgDialect } from 'drizzle-orm/pg-core'

const mocks = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/db', async () => {
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const db = drizzle({ client: { query: mocks.query } as unknown as Pool })
  return { requireDb: () => db }
})

import {
  buildReportSourceWhere,
  buildWeldColumnFilterOptionsFromRows,
  canPaginateReportSource,
  listColumnFilterOptions,
  normalizeWeldColumnFilterOptionsRequest,
} from './weld-read'
import { GENERATED_DOCUMENT_FIELD_TYPES } from './weld-server-shared'
import { buildWeldColumnValueFilter } from '@/lib/weld-column-choice-filter'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LAYERED_CONTROL_WAITING_LABEL } from '@/lib/layered-control-documents'

describe('generated-document report filters', () => {
  beforeEach(() => { mocks.query.mockReset() })

  it.each(['Vik', 'Pvk'] as const)('aggregates the %s waiting state without a third query or a full-table read', async (method) => {
    mocks.query.mockResolvedValueOnce({ rows: [['К-1', 2]] })
    mocks.query.mockResolvedValueOnce({ rows: [[7, ''], [3, LAYERED_CONTROL_WAITING_LABEL]] })
    const options = await listColumnFilterOptions(normalizeWeldColumnFilterOptionsRequest({ report: 'lnk', fieldKey: `layered${method}Documents` }))
    expect(options).toEqual(expect.arrayContaining([
      { value: '', label: '(пусто)', count: 7 },
      { value: 'К-1', label: 'К-1', count: 2 },
      { value: LAYERED_CONTROL_WAITING_LABEL, label: LAYERED_CONTROL_WAITING_LABEL, count: 3 },
    ]))
    expect(mocks.query).toHaveBeenCalledTimes(2)
    const query = mocks.query.mock.calls[1]![0].text
    expect(query).toContain('"layered_control_assigned"')
    expect(query).toContain('"pvk_result"')
    expect(query).toContain('group by 2')
    expect(query).not.toContain('"pre_heat_treatment_controls"')
  })

  it.each(['Vik', 'Pvk'] as const)('counts %s document titles once per joint in local option lists too', (method) => {
    const rows = [
      { id: 1, [`layered${method}EdgesDocument`]: 'Общее', [`layered${method}LayersDocument`]: 'Общее' },
      { id: 2, [`layered${method}LayersDocument`]: 'Общее' },
      { id: 3 },
    ] as WeldRow[]
    expect(buildWeldColumnFilterOptionsFromRows(rows, `layered${method}Documents`)).toEqual([
      { value: '', label: '(пусто)', count: 1 },
      { value: 'Общее', label: 'Общее', count: 2 },
    ])
  })

  for (const fieldKey of Object.keys(GENERATED_DOCUMENT_FIELD_TYPES) as WeldFieldKey[]) {
    it(`${fieldKey}: uses SQL document relations for filtering, including empty and multiple choices`, () => {
      const columnFilters = { [fieldKey]: buildWeldColumnValueFilter(['Заключение №1', '']) }
      expect(canPaginateReportSource(columnFilters)).toBe(true)
      const query = new PgDialect().sqlToQuery(buildReportSourceWhere({ columnFilters })!)
      expect(query.sql).toContain('"generated_document_weld_joints"')
      expect(query.sql).toContain('not exists')
      expect(query.params).toContain('Заключение №1')
      for (const type of [GENERATED_DOCUMENT_FIELD_TYPES[fieldKey as keyof typeof GENERATED_DOCUMENT_FIELD_TYPES]].flat()) {
        expect(query.params).toContain(type)
      }
    })

    for (const report of ['weldingJournal', 'lnk', 'heatTreatment'] as const) {
      it(`${report}/${fieldKey}: aggregates options in two queries without loading all report rows`, async () => {
        mocks.query.mockResolvedValueOnce({ rows: [['Заключение №1', 3]] })
        mocks.query.mockResolvedValueOnce({ rows: [[7]] })
        const options = await listColumnFilterOptions(normalizeWeldColumnFilterOptionsRequest({
          report,
          fieldKey,
          columnFilters: { projectTitle: '=Объект', [fieldKey]: '=Исключить свой фильтр' },
        }))
        expect(options).toEqual([
          { value: '', label: '(пусто)', count: 7 },
          { value: 'Заключение №1', label: 'Заключение №1', count: 3 },
        ])
        expect(mocks.query).toHaveBeenCalledTimes(2)
        for (const [config, params] of mocks.query.mock.calls) {
          expect(config.text).toContain('"generated_document_weld_joints"')
          expect(params).toContain('Объект')
          expect(params).not.toContain('Исключить свой фильтр')
          expect(config.text).not.toContain('"rk_conclusion"')
          if (report !== 'weldingJournal') expect(config.text).toContain('"weld_date" is not null')
        }
        expect(mocks.query.mock.calls[0]![0].text).toContain('count(distinct')
      })
    }
  }
})
