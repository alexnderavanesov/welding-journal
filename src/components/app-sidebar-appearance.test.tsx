import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppSidebar } from './app-sidebar'
import type { ActiveReport } from '@/lib/home-state'

afterEach(cleanup)

const sections: [ActiveReport, string, string][] = [
  ['weldingJournal', 'Сварочный журнал', 'clipboard-list'],
  ['percentageLines', 'Программа линий', 'list-tree'],
  ['heatTreatment', 'ПСТО и ТВМТ', 'thermometer'],
  ['lnk', 'ЛНК', 'clipboard-check'],
  ['welderStamps', 'Справочники', 'book-user'],
  ['statistics', 'Статистика', 'chart-column'],
  ['documents', 'Документы', 'file-text'],
  ['settings', 'Настройки', 'settings'],
]

it.each([false, true])('keeps every section accessible with consistent outline icons, collapsed=%s', collapsed => {
  const onReportChange = vi.fn(), onCollapsedChange = vi.fn()
  const { rerender } = render(<AppSidebar activeReport="percentageLines" collapsed={collapsed} onReportChange={onReportChange} onCollapsedChange={onCollapsedChange} />)
  const sidebar = screen.getByRole('complementary')
  expect(sidebar).toHaveClass(collapsed ? 'w-16' : 'w-48')
  for (const [report, label, icon] of sections) {
    const button = within(sidebar).getByRole('button', { name: label })
    expect(button).toHaveAttribute('title', label)
    expect(button).toHaveClass(collapsed ? 'rounded-xl' : 'rounded-lg')
    expect(button.querySelector('svg')).toHaveClass(`lucide-${icon}`, 'h-5', 'w-5')
    expect(button.querySelector('svg')).toHaveAttribute('stroke-width', '1.5')
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(button)
    expect(onReportChange).toHaveBeenLastCalledWith(report)
    rerender(<AppSidebar activeReport={report} collapsed={collapsed} onReportChange={onReportChange} onCollapsedChange={onCollapsedChange} />)
    expect(button).toHaveAttribute('aria-current', 'page')
    expect(button).toHaveClass('bg-sky-50', 'text-sky-700')
    expect(sidebar.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  }
  expect(within(sidebar).getByRole('link', { name: /Мой профиль/ })).toHaveAttribute('href', '/account')
  expect(within(sidebar).queryByRole('button', { name: 'Руководство пользователя' })).not.toBeInTheDocument()
  expect(within(sidebar).queryByRole('link', { name: 'Журнал действий' })).not.toBeInTheDocument()
  fireEvent.click(within(sidebar).getByRole('button', { name: collapsed ? 'Раскрыть меню' : 'Скрыть меню' }))
  expect(onCollapsedChange).toHaveBeenCalledExactlyOnceWith(!collapsed)
})
