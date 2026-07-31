import { describe, expect, it } from 'vitest'

import { isRevisionNotActual } from '@/lib/revision-actuality'

describe('revision actuality', () => {
  it.each([undefined, null, '', 'актуален', 'Актуален'])(
    'treats %s as an actual row',
    (value) => {
      expect(isRevisionNotActual(value)).toBe(false)
    },
  )

  it.each(['не актуален', ' НЕ АКТУАЛЕН ', 'Не актуален'])(
    'recognizes %s as a non-actual row',
    (value) => {
      expect(isRevisionNotActual(value)).toBe(true)
    },
  )
})
