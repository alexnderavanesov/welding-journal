import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { StatisticsPage } from '@/components/statistics-page'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { PercentageLineSummary } from '@/lib/percentage-line-summary'

const mocks = vi.hoisted(() => ({
  statisticsQuery: vi.fn(),
  weldRowsByIdsQuery: vi.fn(),
}))

vi.mock('@/lib/use-statistics-server-query', () => ({
  useStatisticsServerQuery: mocks.statisticsQuery,
}))

vi.mock('@/lib/use-weld-rows-by-ids-query', () => ({
  useWeldRowsByIdsQuery: mocks.weldRowsByIdsQuery,
}))

const weldRow: WeldRow = {
  id: 1,
  projectTitle: 'Project',
  subtitleCode: 'S1',
  line: 'Lin123',
  joint: 'J1',
}

const percentageLineSummary: PercentageLineSummary[] = [{
  lineKey: 'project\u0000s1\u0000lin123',
  projectTitle: 'Project',
  subtitleCode: 'S1',
  line: 'Lin123',
  percent: 10,
  potentialControlReduction: 0,
  rowCount: 1,
  rows: [weldRow],
  stamps: [{
    key: 'project\u0000s1\u0000lin123\u0000k-77',
    stamp: 'K-77',
    lineKey: 'project\u0000s1\u0000lin123',
    projectTitle: 'Project',
    subtitleCode: 'S1',
    line: 'Lin123',
    percent: 10,
    officialJointCount: 1,
    baseRequiredControls: 1,
    additionalRequiredControls: 0,
    calculatedRequiredControls: 1,
    availableRequiredControls: 1,
    requiredControls: 1,
    assignedControls: 0,
    normalAssignedControls: 0,
    additionalAssignedControls: 0,
    cancelledAssignedControls: 0,
    coveredControls: 0,
    rejectedCoveredControls: 0,
    completedControls: 0,
    rejectedPrimaryControls: 0,
    goodJoints: 0,
    rejectedJoints: 0,
    waitingRequestJoints: 1,
    waitingControlJoints: 0,
    assignedJointNames: [],
    assignedRowIds: [],
    additionalAssignedJointNames: [],
    additionalAssignedRowIds: [],
    cancelledAssignedJointNames: [],
    cancelledAssignedRowIds: [],
    coveredJointNames: [],
    coveredRowIds: [],
    rejectedCoveredJointNames: [],
    rejectedCoveredRowIds: [],
    completedJointNames: [],
    completedRowIds: [],
    rejectedPrimaryJointNames: [],
    rejectedPrimaryRowIds: [],
    missingCandidateJointNames: ['J1'],
    missingCandidateRowIds: [1],
    assignmentCandidateJointNames: ['J1'],
    assignmentCandidateRowIds: [1],
    excessCandidateJointNames: [],
    excessCandidateRowIds: [],
    missingControls: 1,
    excessControls: 0,
    fullControlRequired: false,
  }],
}]

describe('StatisticsPage percentage-line navigation', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() })
    mocks.statisticsQuery.mockReset().mockReturnValue({
      data: { percentageLineSummary },
      isFetching: false,
      isLoading: false,
    })
    mocks.weldRowsByIdsQuery.mockReset().mockReturnValue({
      data: [weldRow],
      isLoading: false,
    })
  })

  afterEach(() => cleanup())

  it('loads the exact project and subtitle for all time before opening the assignment dialog', async () => {
    const onHandled = vi.fn()
    render(
      <StatisticsPage
        fixedTab="percentageLines"
        percentageLineNavigationRequest={{
          id: 7,
          action: 'assign-missing-controls',
          projectTitle: 'Project',
          subtitleCode: 'S1',
          line: 'Lin123',
          stamp: 'K-77',
        }}
        onPercentageLineNavigationRequestHandled={onHandled}
      />,
    )

    expect(mocks.statisticsQuery.mock.calls[0]?.[0]).toMatchObject({
      tab: 'percentageLines',
      projectFilter: 'project',
      selectedSubtitles: ['s1'],
      from: '',
      to: '',
    })
    await screen.findByRole('heading', { name: 'Назначить контроль' })
    await waitFor(() => expect(onHandled).toHaveBeenCalledWith(7, 'opened'))
  })
})
