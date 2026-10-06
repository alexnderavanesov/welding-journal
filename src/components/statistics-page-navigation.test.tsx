import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { StatisticsPage } from '@/components/statistics-page'

const mocks = vi.hoisted(() => ({ statisticsQuery: vi.fn(), lineProgram: vi.fn() }))
vi.mock('@/lib/use-statistics-server-query', () => ({ useStatisticsServerQuery: mocks.statisticsQuery }))
vi.mock('@/components/line-program-page', () => ({ LineProgramPage: (props: unknown) => {
  mocks.lineProgram(props)
  return <div>Единая программа линий</div>
} }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('routes the old percentage entry to the same program without loading or filtering statistics', () => {
  const request = { id: 7, action: 'assign-missing-controls' as const, projectTitle: 'Project', subtitleCode: 'S1', line: 'Lin123', stamp: 'K-77', demandKind: 'pvk' as const }
  const onHandled = vi.fn()
  render(<StatisticsPage fixedTab="percentageLines" percentageLineNavigationRequest={request} onPercentageLineNavigationRequestHandled={onHandled} />)
  expect(screen.getByText('Единая программа линий')).toBeVisible()
  expect(mocks.statisticsQuery).not.toHaveBeenCalled()
  expect(mocks.lineProgram).toHaveBeenCalledWith(expect.objectContaining({ navigationRequest: request, onNavigationHandled: onHandled }))
})
