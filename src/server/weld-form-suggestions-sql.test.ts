import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import {
  buildWeldFormSuggestionsQuery,
  buildWeldLineSuggestionsQuery,
  normalizeWeldFormSuggestionRows,
} from '@/server/weld-form-suggestions-sql'

describe('weld form suggestions SQL', () => {
  it('reads bounded full identities from the line registry, restricting existing joints to their project/code', () => {
    const dialect = new PgDialect()
    const draft = { projectTitle: ' Проект ', subtitleCode: ' A ', line: 'L_%' }
    const create = dialect.sqlToQuery(buildWeldLineSuggestionsQuery(draft))
    const edit = dialect.sqlToQuery(buildWeldLineSuggestionsQuery({ ...draft, id: 7 }))
    expect(create.sql).toContain('from "line_programs"')
    expect(create.sql).toContain('limit 8')
    expect(create.sql).toContain('strpos(')
    expect(create.params).toContain('l_%')
    expect(create.sql.split('order by')[0]).not.toContain('and lower(btrim("line_programs"."project_title")) =')
    expect(edit.sql.split('order by')[0]).toContain('and lower(btrim("line_programs"."project_title")) =')
    expect(edit.sql.split('order by')[0]).toContain('and lower(btrim("line_programs"."subtitle_code")) =')
    expect(edit.params).toContain('проект')
    expect(edit.params).toContain('a')
  })

  it('aggregates paired values, context scores, literal search, and current-row exclusion in SQL', () => {
    const query = buildWeldFormSuggestionsQuery({
      fieldKey: 'material2',
      draft: {
        id: 17,
        material2: '09_%',
        projectTitle: '  Риформинг  ',
        subtitleCode: '400',
      },
    })
    expect(query).not.toBeNull()

    const compiled = new PgDialect().sqlToQuery(query!)
    expect(compiled.sql).toContain('cross join lateral')
    expect(compiled.sql).toContain('"material_1"')
    expect(compiled.sql).toContain('"material_2"')
    expect(compiled.sql).toContain('strpos(lower("suggestion_source"."value"),')
    expect(compiled.sql).toContain('"weld_joints"."id" <>')
    expect(compiled.sql).toContain('group by "value"')
    expect(compiled.params).toContain('09_%')
    expect(compiled.params).toContain('риформинг')
    expect(compiled.params).toContain(17)
    expect(compiled.params.at(-1)).toBe(8)
  })

  it('normalizes numeric driver values without retaining empty candidates', () => {
    expect(normalizeWeldFormSuggestionRows([
      { value: '57', context: 'Проект · Линия', count: '12', score: '40' },
      { value: '-', context: '', count: 1, score: 0 },
    ])).toEqual([
      { value: '57', context: 'Проект · Линия', count: 12, score: 40 },
    ])
  })

  it('returns no query for a virtual field without a database source column', () => {
    expect(buildWeldFormSuggestionsQuery({
      fieldKey: 'dispatcherTasks',
      draft: {},
    })).toBeNull()
  })
})
