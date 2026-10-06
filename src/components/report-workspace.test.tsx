import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReportWorkspace } from './report-workspace'

vi.mock('./app-sidebar', () => ({ AppSidebar: () => <aside>Меню</aside> }))
afterEach(cleanup)

it.each(['weldingJournal', 'percentageLines'] as const)('uses the same continuous white surface for %s', activeReport => {
  render(<ReportWorkspace activeReport={activeReport} navCollapsed={false} registerMinWidth={2000} onNavCollapsedChange={() => {}} onReportChange={() => {}}><div>Отчёт</div></ReportWorkspace>)
  const main = screen.getByRole('main'), boundary = main.querySelector('[data-scroll-top-boundary]')!
  expect(main).toHaveClass('bg-white')
  expect(boundary).toHaveClass('bg-white')
  expect(boundary.parentElement).toHaveClass('bg-white')
  if (activeReport === 'percentageLines') expect(boundary).not.toHaveStyle({ minWidth: '2000px' })
})

it('leaves the separate statistics surface unchanged', () => {
  render(<ReportWorkspace activeReport="statistics" navCollapsed registerMinWidth={2000} onNavCollapsedChange={() => {}} onReportChange={() => {}}><div>Отчёт</div></ReportWorkspace>)
  expect(screen.getByRole('main')).toHaveClass('bg-[#f4f7f9]')
})
