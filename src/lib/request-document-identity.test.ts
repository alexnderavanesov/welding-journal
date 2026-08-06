import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  findRequestDocumentIdentity,
  getPstoRequestDocumentIdentities,
} from '@/lib/request-document-identity'

describe('request document identity', () => {
  it('keeps requests with the same custom name on different dates separate', () => {
    const options = getPstoRequestDocumentIdentities([
      { id: 1, pstoRequest: 'Заявка пользователя', pstoRequestDate: '2026-07-21' },
      { id: 2, pstoRequest: 'Заявка пользователя', pstoRequestDate: '2026-08-06' },
    ] as WeldRow[])

    expect(options).toHaveLength(2)
    expect(options.map((option) => option.date)).toEqual(['2026-08-06', '2026-07-21'])
    expect(options.map((option) => option.label)).toEqual([
      'Заявка пользователя · 06.08.2026',
      'Заявка пользователя · 21.07.2026',
    ])
  })

  it('does not substitute an identically named request from another date', () => {
    const options = getPstoRequestDocumentIdentities([
      { id: 1, pstoRequest: 'Заявка пользователя', pstoRequestDate: '2026-08-06' },
      { id: 2, pstoRequest: 'Другая заявка', pstoRequestDate: '2026-08-07' },
    ] as WeldRow[])

    const selected = findRequestDocumentIdentity(options, 'Заявка пользователя', '2026-07-21')

    expect(selected?.name).toBe('Другая заявка')
    expect(selected?.date).toBe('2026-08-07')
  })
})
