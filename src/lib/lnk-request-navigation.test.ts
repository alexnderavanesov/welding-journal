import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  formatLnkRequestNavigationLabel,
  getLnkRequestIdentityForField,
  getLnkRequestNavigationEntries,
} from '@/lib/lnk-request-navigation'

const row = {
  id: 1,
  joint: 'F1',
  vikRequest: 'Заявка ВИК',
  vikRequestDate: '2026-08-14',
  rkRequest: 'Заявка РК',
  rkRequestDate: '2026-08-15',
} as WeldRow

describe('LNK request navigation', () => {
  it('resolves the exact request from the clicked request name or date cell', () => {
    expect(getLnkRequestIdentityForField(row, 'vikRequest')).toMatchObject({
      name: 'Заявка ВИК',
      date: '2026-08-14',
      methodCodes: ['ВИК'],
    })
    expect(getLnkRequestIdentityForField(row, 'rkRequestDate')).toMatchObject({
      name: 'Заявка РК',
      date: '2026-08-15',
      methodCodes: ['РК'],
    })
  })

  it('does not guess a request for an unrelated cell', () => {
    expect(getLnkRequestIdentityForField(row, 'joint')).toBeNull()
  })

  it('lists every request of a row with its actual methods', () => {
    const entries = getLnkRequestNavigationEntries([
      row,
      {
        ...row,
        id: 2,
        joint: 'F2',
        vikRequest: 'Общая заявка',
        rkRequest: 'Общая заявка',
        vikRequestDate: '2026-08-16',
        rkRequestDate: '2026-08-16',
      },
    ])
    const shared = entries.find((entry) => entry.name === 'Общая заявка')

    expect(entries.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'Заявка ВИК',
      'Заявка РК',
      'Общая заявка',
    ]))
    expect(shared?.methodCodes).toEqual(['ВИК', 'РК'])
    expect(shared && formatLnkRequestNavigationLabel(shared)).toContain('ВИК/РК')
  })
})
