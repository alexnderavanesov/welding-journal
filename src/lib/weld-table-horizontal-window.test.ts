import { describe, expect, it } from 'vitest'

import type { WeldTableDisplaySection } from '@/lib/weld-table-sections'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import {
  buildWeldTableFieldSpans,
  buildWeldTableRenderColumns,
  getVisibleWeldTableFieldKeys,
} from '@/lib/weld-table-horizontal-window'

const sections = [
  {
    section: 'Проект',
    collapsed: false,
    fields: [
      { key: 'projectTitle', label: 'Проект' },
      { key: 'line', label: 'Линия' },
    ],
  },
  {
    section: 'Стык',
    collapsed: false,
    fields: [
      { key: 'joint', label: 'Стык' },
      { key: 'officiality', label: 'Официальность' },
    ],
  },
] as WeldTableDisplaySection[]

const sectionsWithMaterials = [
  ...sections,
  {
    section: 'Материалы',
    collapsed: false,
    fields: [{ key: 'element1', label: 'Материал 1' }],
  },
] as WeldTableDisplaySection[]

const nextActionColumn = {
  key: 'jointNextAction',
  section: 'Следующий шаг',
  label: 'Следующее действие',
  width: 340,
  insertAfterSection: 'Стык',
  renderCell: () => null,
} satisfies WeldTableExtraColumn

describe('weld table horizontal window', () => {
  it('keeps sticky identity fields outside the visible range', () => {
    const spans = buildWeldTableFieldSpans({ sections, extraColumns: [], leadingWidth: 0 })
    const visible = getVisibleWeldTableFieldKeys({
      spans,
      viewportStart: 10_000,
      viewportEnd: 11_000,
      overscan: 0,
    })

    expect(visible).toEqual(['line', 'joint'])
  })

  it('replaces consecutive offscreen fields with colspan spacers without changing order', () => {
    const columns = buildWeldTableRenderColumns({
      sections,
      extraColumns: [],
      visibleFieldKeys: new Set(['line', 'joint']),
    })

    expect(columns.map((column) =>
      column.kind === 'field'
        ? column.field.key
        : column.kind === 'spacer'
          ? `spacer:${column.colSpan}`
          : column.column.key,
    )).toEqual(['spacer:1', 'line', 'joint', 'spacer:1'])
  })

  it('inserts an extra column immediately after its anchor section', () => {
    const columns = buildWeldTableRenderColumns({
      sections: sectionsWithMaterials,
      extraColumns: [nextActionColumn],
    })

    expect(columns.map((column) =>
      column.kind === 'extra'
        ? column.column.key
        : column.kind === 'field'
          ? column.field.key
          : `spacer:${column.colSpan}`,
    )).toEqual([
      'projectTitle',
      'line',
      'joint',
      'officiality',
      'jointNextAction',
      'element1',
    ])
  })

  it('accounts for an after-section column before calculating the next section offset', () => {
    const baseSpans = buildWeldTableFieldSpans({
      sections: sectionsWithMaterials,
      extraColumns: [],
      leadingWidth: 0,
    })
    const anchoredSpans = buildWeldTableFieldSpans({
      sections: sectionsWithMaterials,
      extraColumns: [nextActionColumn],
      leadingWidth: 0,
    })
    const getStart = (spans: typeof baseSpans, fieldKey: string) => {
      const span = spans.find((candidate) => candidate.fieldKey === fieldKey)
      if (!span) throw new Error(`Missing span for ${fieldKey}`)
      return span.start
    }

    expect(getStart(anchoredSpans, 'officiality')).toBe(getStart(baseSpans, 'officiality'))
    expect(getStart(anchoredSpans, 'element1')).toBe(getStart(baseSpans, 'element1') + 340)
  })
})
