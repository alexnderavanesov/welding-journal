import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WeldTableSectionToolbar } from '@/components/weld-table-section-toolbar'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import type { WeldField } from '@/lib/weld-fields'

describe('WeldTableSectionToolbar', () => {
  it('keeps its right border aligned with the visible report viewport', () => {
    const { container } = render(
      <WeldTableSectionToolbar
        sections={[]}
        extraColumns={[]}
        collapsedSections={new Set()}
        alwaysVisibleFieldKeys={new Set()}
        stickyLeft={80}
        onToggleSection={() => undefined}
        viewControls={<button type="button">Виды</button>}
      />,
    )

    const toolbar = screen.getByText('Разделы').parentElement
    expect(toolbar).toHaveStyle({
      left: '80px',
      width: 'calc(100vw - 104px)',
      maxWidth: 'calc(100vw - 104px)',
    })
    expect(container.querySelector('[data-report-section-strip]')).toHaveClass('overflow-x-auto')
    expect(screen.getByRole('button', { name: 'Показать предыдущие разделы' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Показать следующие разделы' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Виды' }).parentElement).toHaveAttribute('data-report-view-controls-slot')
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
    const { container } = render(
      <WeldTableSectionToolbar
        sections={[
          { section: 'Стык', fields: [{ key: 'joint', label: 'Стык' } as WeldField] },
          { section: 'Материалы', fields: [{ key: 'element1', label: 'Материал 1' } as WeldField] },
        ]}
        extraColumns={[nextActionColumn]}
        collapsedSections={new Set()}
        alwaysVisibleFieldKeys={new Set()}
        stickyLeft={0}
        onToggleSection={() => undefined}
      />,
    )

    const sectionButtons = container.querySelectorAll<HTMLButtonElement>('[data-report-section-strip] button')
    expect(Array.from(sectionButtons).map((button) => button.textContent?.replace(/\s+/g, ''))).toEqual([
      'Стык1/1',
      'Следующийшаг1/1',
      'Материалы1/1',
    ])
  })
})
