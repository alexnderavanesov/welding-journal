import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WeldTableSectionToolbar } from '@/components/weld-table-section-toolbar'

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
})
