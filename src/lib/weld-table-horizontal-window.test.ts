import { describe, expect, it } from 'vitest'

import type { WeldTableDisplaySection } from '@/lib/weld-table-sections'
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
      { key: 'status', label: 'Статус' },
    ],
  },
] as WeldTableDisplaySection[]

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
})
