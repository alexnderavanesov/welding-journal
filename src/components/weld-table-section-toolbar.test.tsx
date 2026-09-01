import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WeldTableSectionToolbar } from '@/components/weld-table-section-toolbar'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import type { WeldField } from '@/lib/weld-fields'

describe('WeldTableSectionToolbar', () => {
  it('keeps its right border aligned with the table when sections are collapsed', () => {
    render(
      <WeldTableSectionToolbar
        sections={[]}
        extraColumns={[]}
        collapsedSections={new Set()}
        alwaysVisibleFieldKeys={new Set()}
        tableMinWidth={1000}
        stickyLeft={80}
        onToggleSection={() => undefined}
        viewControls={<button type="button">Виды</button>}
      />,
    )

    const toolbar = screen.getByText('Разделы').parentElement
    expect(toolbar).toHaveStyle({
      left: '80px',
      width: '1000px',
      minWidth: '1000px',
    })
  })

  it('places an extra section directly after its anchor section', () => {
    const nextActionColumn = {
      key: 'jointNextAction',
      section: 'Следующий шаг',
      label: 'Следующее действие',
      width: 340,
      insertAfterSection: 'Стык',
      collapsible: true,
      renderCell: () => null,
    } satisfies WeldTableExtraColumn
    render(
      <WeldTableSectionToolbar
        sections={[
          { section: 'Стык', fields: [{ key: 'joint', label: 'Стык' } as WeldField] },
          { section: 'Материалы', fields: [{ key: 'element1', label: 'Материал 1' } as WeldField] },
        ]}
        extraColumns={[nextActionColumn]}
        collapsedSections={new Set()}
        alwaysVisibleFieldKeys={new Set()}
        tableMinWidth={1000}
        stickyLeft={0}
        onToggleSection={() => undefined}
      />,
    )

    expect(screen.getAllByRole('button').map((button) => button.textContent?.replace(/\s+/g, ''))).toEqual([
      'Стык1/1',
      'Следующийшаг1/1',
      'Материалы1/1',
    ])
  })
})
