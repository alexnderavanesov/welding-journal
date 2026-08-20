import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { hasRemainingLnkRequestDocumentPositions } from '@/lib/use-lnk-request-correction-mutation'

describe('LNK request correction identity', () => {
  it('does not keep a removed request selected because an identically named request exists on another date', () => {
    const rows = [
      {
        id: 1,
        vikRequest: 'Заявка НК №12',
        vikRequestDate: '2026-08-19',
      },
      {
        id: 2,
        rkRequest: 'Заявка НК №12',
        rkRequestDate: '2026-08-20',
      },
    ] as WeldRow[]

    expect(hasRemainingLnkRequestDocumentPositions({
      rows,
      removedRowId: 1,
      removedMethodKey: 'vikRequest',
      requestName: 'Заявка НК №12',
      requestDate: '2026-08-19',
    })).toBe(false)
  })

  it('keeps the request selected while another position of the same dated document remains', () => {
    const rows = [
      {
        id: 1,
        vikRequest: 'Заявка НК №12',
        vikRequestDate: '2026-08-19',
      },
      {
        id: 2,
        rkRequest: 'Заявка НК №12',
        rkRequestDate: '2026-08-19',
      },
    ] as WeldRow[]

    expect(hasRemainingLnkRequestDocumentPositions({
      rows,
      removedRowId: 1,
      removedMethodKey: 'vikRequest',
      requestName: 'Заявка НК №12',
      requestDate: '2026-08-19',
    })).toBe(true)
  })
})
