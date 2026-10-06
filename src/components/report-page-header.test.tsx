import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ReportPageHeader } from '@/components/report-page-header'

describe('ReportPageHeader', () => {
  it('aligns a fluid page to its container without the wide-table horizontal offset', () => {
    const { container } = render(<ReportPageHeader title="Программа линий" stickyLeft={288} fluid><button>Показать</button></ReportPageHeader>)
    expect(container.querySelector('header')).toHaveStyle({ left: '0px', width: '100%', maxWidth: '100%' })
    expect(container.querySelector('[data-report-header-actions]')).toHaveClass('basis-full', 'sm:basis-auto')
  })
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
    expect(header).toHaveClass('border-b', 'bg-white/95')
    expect(header.querySelector('[data-report-header-actions]')).not.toHaveClass('basis-full')
  })

  it('keeps the report summary inside the same header surface', () => {
    const { container } = render(
      <ReportPageHeader title="ЛНК" stickyLeft={80} summary={<div>Стыков: 12</div>}>
        <button type="button">Заявка</button>
      </ReportPageHeader>,
    )

    expect(screen.getByText('Стыков: 12')).toBeInTheDocument()
    expect(container.querySelector('[data-report-header-summary]')).toBe(
      screen.getByText('Стыков: 12').parentElement,
    )
  })
})
