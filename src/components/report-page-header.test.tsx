import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ReportPageHeader } from '@/components/report-page-header'

describe('ReportPageHeader', () => {
  it('stays inside the visible report viewport during horizontal scrolling', () => {
    render(
      <ReportPageHeader title="ЛНК" stickyLeft={80}>
        <button type="button">Заявка</button>
      </ReportPageHeader>,
    )

    const header = screen.getByRole('banner')
    expect(header).toHaveClass('sticky', 'z-40')
    expect(header).toHaveStyle({
      left: '80px',
      width: 'calc(100vw - 104px)',
      maxWidth: 'calc(100vw - 104px)',
    })
  })
})
