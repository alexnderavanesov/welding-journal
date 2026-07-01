import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  clearCancelledPstoRequestWithoutResult,
  restoreActivePstoCancelledResult,
  withPendingPstoResultStatus,
} from '@/lib/psto-field-updates'

describe('clearCancelledPstoRequestWithoutResult', () => {
  it('clears PSTO request and date when PSTO is inactive without result', () => {
    const row = clearCancelledPstoRequestWithoutResult({
      pstoRequired: null,
      pstoRequest: 'ПСТО-30.06.26-001',
      pstoDate: '30.06.2026',
      pstoResult: null,
    } as WeldRow)

    expect(row.pstoRequest).toBeNull()
    expect(row.pstoDate).toBeNull()
    expect(row.pstoResult).toBeNull()
  })

  it('keeps PSTO request and date when inactive PSTO already has conducted result', () => {
    const row = clearCancelledPstoRequestWithoutResult({
      pstoRequired: null,
      pstoRequest: 'ПСТО-30.06.26-001',
      pstoDate: '30.06.2026',
      pstoResult: 'проведено',
    } as WeldRow)

    expect(row.pstoRequest).toBe('ПСТО-30.06.26-001')
    expect(row.pstoDate).toBe('30.06.2026')
  })

  it('does not treat pending PSTO statuses as report history', () => {
    const row = clearCancelledPstoRequestWithoutResult({
      pstoRequired: null,
      pstoRequest: 'ПСТО-30.06.26-001',
      pstoDate: '30.06.2026',
      pstoResult: 'ожидает заявку',
    } as WeldRow)

    expect(row.pstoRequest).toBeNull()
    expect(row.pstoDate).toBeNull()
    expect(row.pstoResult).toBeNull()
  })

  it('fills active PSTO result with waiting request status when request is missing', () => {
    const row = withPendingPstoResultStatus({
      pstoRequired: 'да',
      pstoRequest: null,
      pstoResult: null,
    } as WeldRow)

    expect(row.pstoResult).toBe('ожидает заявку')
  })

  it('fills active PSTO result with waiting status when request exists', () => {
    const row = withPendingPstoResultStatus({
      pstoRequired: 'да',
      pstoRequest: 'ПСТО-30.06.26-001',
      pstoResult: null,
    } as WeldRow)

    expect(row.pstoResult).toBe('ожидает')
  })

  it('restores cancelled conducted result when PSTO becomes active again', () => {
    const row = restoreActivePstoCancelledResult({
      pstoRequired: 'да',
      pstoResult: 'проведено (отменен)',
    } as WeldRow)

    expect(row.pstoResult).toBe('проведено')
  })

  it('clears cancelled PSTO result when PSTO becomes active again', () => {
    const row = restoreActivePstoCancelledResult({
      pstoRequired: 'да',
      pstoResult: 'отменен',
    } as WeldRow)

    expect(row.pstoResult).toBeNull()
  })
})
