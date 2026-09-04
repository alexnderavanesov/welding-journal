import { describe, expect, it } from 'vitest'

import { formHiddenFieldKeys } from '@/lib/weld-form-field-sets'
import { WELD_FIELDS, isVirtualWeldField } from '@/lib/weld-fields'
import {
  SYSTEM_FIELD_KEYS,
  WELD_MUTATION_FIELD_KEYS,
  restrictWeldMutationRecord,
} from '@/server/weld-mutation-policy'

describe('weld mutation policy', () => {
  it('persists every visible editable field from the weld form', () => {
    const allowed = new Set(WELD_MUTATION_FIELD_KEYS.welding)
    const silentlyDropped = WELD_FIELDS
      .filter((field) => !isVirtualWeldField(field) && !formHiddenFieldKeys.has(field.key))
      .filter((field) => !allowed.has(field.key))
      .map((field) => field.key)

    expect(silentlyDropped).toEqual([])
  })

  it('keeps system-managed fields outside an ordinary weld save', () => {
    const payload = Object.fromEntries(
      [...SYSTEM_FIELD_KEYS]
        .filter((fieldKey) => fieldKey !== 'id')
        .map((fieldKey) => [fieldKey, 'changed']),
    )
    const restricted = restrictWeldMutationRecord({ id: 7, ...payload }, 'welding')

    expect(restricted).toEqual({ id: 7 })
  })

  it('allows work-code fields shared with LNK and PSTO reports', () => {
    const restricted = restrictWeldMutationRecord({
      id: 7,
      vikBoq: 'ВИК-BoQ',
      rkKs3: 'РК-КС3',
      pstoBoq: 'ПСТО-BoQ',
      tvmtKs3: 'ТВМТ-КС3',
    }, 'welding')

    expect(restricted).toEqual({
      id: 7,
      vikBoq: 'ВИК-BoQ',
      rkKs3: 'РК-КС3',
      pstoBoq: 'ПСТО-BoQ',
      tvmtKs3: 'ТВМТ-КС3',
    })
  })
})
