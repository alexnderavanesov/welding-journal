import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WelderStampNotificationCard } from '@/components/welder-stamp-notification-card'
import type { WelderStampExpiryTask } from '@/lib/dispatcher-types'

describe('WelderStampNotificationCard', () => {
  it('fills the dispatcher group width when its details are expanded', () => {
    const task: WelderStampExpiryTask = {
      kind: 'welder-stamp-expiry',
      key: 'welder-stamp-expiry:dls:1',
      stamp: {
        id: 1,
        naksStamp: '3ZOX',
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
      permitNumber: 'ДЛС-17',
      naksStamp: '3ZOX',
      validTo: '2026-09-30',
      daysLeft: 7,
      expired: false,
    }

    const { container } = render(
      <WelderStampNotificationCard
        task={task}
        isTaskExpanded={() => true}
        onToggleDetails={vi.fn()}
      />,
    )

    expect(container.querySelector('[data-welder-stamp-notification-card="true"]')).toHaveClass('w-full')
  })
})
