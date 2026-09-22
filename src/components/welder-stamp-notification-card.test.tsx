import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  WelderStampNotificationCard,
  WelderStampNotificationGroup,
} from '@/components/welder-stamp-notification-card'
import type { RepeatedJointTaskGroup, WelderStampExpiryTask } from '@/lib/dispatcher-types'

describe('WelderStampNotificationCard', () => {
  it('fills the dispatcher group width when its details are expanded', () => {
    const task = createWelderStampTask()

    const { container } = render(
      <WelderStampNotificationCard
        task={task}
        isTaskExpanded={() => true}
        onToggleDetails={vi.fn()}
      />,
    )

    expect(container.querySelector('[data-welder-stamp-notification-card="true"]')).toHaveClass('w-full')
  })

  it('keeps long reminder groups in manual bounded batches', () => {
    const tasks = Array.from({ length: 81 }, (_, index) => createWelderStampTask(index + 1))
    const group = {
      key: 'welder-reminders',
      baseJoint: 'Клейма',
      tasks,
    } satisfies RepeatedJointTaskGroup
    const { container } = render(
      <WelderStampNotificationGroup
        group={group}
        isTaskExpanded={() => false}
        onToggleDetails={vi.fn()}
      />,
    )

    const details = container.querySelector('details[data-dispatcher-hierarchy-level="1"]')
    expect(details).toBeInstanceOf(HTMLDetailsElement)
    if (!(details instanceof HTMLDetailsElement)) return

    details.open = true
    fireEvent(details, new Event('toggle'))

    expect(container.querySelectorAll('[data-welder-stamp-notification-card="true"]')).toHaveLength(40)
    expect(screen.getByText('Показано задач: 40 из 81')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    expect(container.querySelectorAll('[data-welder-stamp-notification-card="true"]')).toHaveLength(80)

    fireEvent.click(screen.getByRole('button', { name: 'Свернуть список' }))
    expect(container.querySelectorAll('[data-welder-stamp-notification-card="true"]')).toHaveLength(40)
  })
})

function createWelderStampTask(id = 1): WelderStampExpiryTask {
  const naksStamp = `3ZOX-${id}`
  return {
    kind: 'welder-stamp-expiry',
    key: `welder-stamp-expiry:dls:${id}`,
    stamp: {
      id,
      naksStamp,
      welderName: 'Сварщик',
      internalStamp: '',
      weldType: 'РАД',
      materialGroups: 'M01',
      diameterFrom: '',
      diameterTo: '',
      thicknessFrom: '',
      thicknessTo: '',
      validFrom: '',
      validTo: '2026-09-30',
      naksPermits: [],
      dlsPermits: [],
      archived: false,
    },
    permitKind: 'dls',
    permitNumber: `ДЛС-${id}`,
    naksStamp,
    validTo: '2026-09-30',
    daysLeft: 7,
    expired: false,
  }
}
