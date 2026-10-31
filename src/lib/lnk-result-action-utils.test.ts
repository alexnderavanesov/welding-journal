import { describe, expect, it } from 'vitest'
import { createDefaultLnkResultDraft } from '@/lib/report-draft-state'
import { getInitialLnkResultRequest, resolveLnkResultDraftAfterMethodChange, resolveLnkResultDraftAfterRequestChange, resolveLnkResultDraftAfterRowIdsChange } from '@/lib/lnk-result-action-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import { createRequestDocumentIdentity } from '@/lib/request-document-identity'

const rows = [1, 2].map((id) => ({ id, hasPvk: 'да', hasVik: 'да', pvkRequest: `ПВК-${id}`, pvkRequestDate: '2026-09-01', vikRequest: 'ВИК', vikRequestDate: '2026-09-01' })) as WeldRow[]
const draft = () => ({ ...createDefaultLnkResultDraft(), methodKey: 'pvkRequest' as const, rowIds: new Set([1, 2]), layeredControlRowIds: new Set([1, 2]) })

describe('per-joint layered draft selection', () => {
  it('does not filter pending controls by a common completed VIK request', () => {
    const pending = rows.map(row => ({ ...row, vikResult: 'годен' }))
    expect(getInitialLnkResultRequest(pending)).toBeNull()
    expect(getInitialLnkResultRequest([pending[0]!])).toEqual(createRequestDocumentIdentity('ПВК-1', '2026-09-01'))
    expect(getInitialLnkResultRequest(pending.map(row => ({ ...row, pvkRequest: 'Shared', pvkRequestDate: '2026-09-01' })))).toEqual(createRequestDocumentIdentity('Shared', '2026-09-01'))
    expect(getInitialLnkResultRequest(pending.map(row => ({ ...row, pvkRequest: 'Shared', pvkRequestDate: `2026-09-0${row.id}` })))).toBeNull()
  })

  it('preserves mixed-request selection and per-row results when changing the request filter', () => {
    const current = { ...draft(), rowResults: { 1: 'годен', 2: 'не годен' } }
    const next = resolveLnkResultDraftAfterRequestChange(current, createRequestDocumentIdentity('ПВК-1', '2026-09-01'))
    expect([...next.rowIds]).toEqual([1, 2])
    expect(next.rowResults).toEqual(current.rowResults)
    expect(next.layeredControlRowIds).toEqual(current.layeredControlRowIds)
  })

  it('prunes only removed joints and does not restore their choices on reselect', () => {
    const next = resolveLnkResultDraftAfterRowIdsChange(draft(), new Set([2]))
    expect(next.layeredControlRowIds).toEqual(new Set([2]))
    expect(resolveLnkResultDraftAfterRowIdsChange(next, new Set([1, 2])).layeredControlRowIds).toEqual(new Set([2]))
  })
  it('keeps layered choices when filtering requests', () => {
    const next = resolveLnkResultDraftAfterRequestChange(draft(), createRequestDocumentIdentity('ПВК-1', '2026-09-01'))
    expect(next.layeredControlRowIds).toEqual(new Set([1, 2]))
  })
  it('clears temporary marks on method changes but keeps them for PVK', () => {
    expect(resolveLnkResultDraftAfterMethodChange(draft(), rows, 'pvkRequest').layeredControlRowIds).toEqual(new Set([1, 2]))
    expect(resolveLnkResultDraftAfterMethodChange(draft(), rows, 'vikRequest').layeredControlRowIds.size).toBe(0)
    expect(resolveLnkResultDraftAfterMethodChange(draft(), rows, '').layeredControlRowIds.size).toBe(0)
  })
})
