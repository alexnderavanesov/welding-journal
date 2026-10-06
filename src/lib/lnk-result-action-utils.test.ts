import { describe, expect, it } from 'vitest'
import { createDefaultLnkResultDraft } from '@/lib/report-draft-state'
import { resolveLnkResultDraftAfterMethodChange, resolveLnkResultDraftAfterRequestChange, resolveLnkResultDraftAfterRowIdsChange } from '@/lib/lnk-result-action-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import { createRequestDocumentIdentity } from '@/lib/request-document-identity'

const rows = [1, 2].map((id) => ({ id, hasPvk: 'да', hasVik: 'да', pvkRequest: `ПВК-${id}`, pvkRequestDate: '2026-09-01', vikRequest: 'ВИК', vikRequestDate: '2026-09-01' })) as WeldRow[]
const draft = () => ({ ...createDefaultLnkResultDraft(), methodKey: 'pvkRequest' as const, rowIds: new Set([1, 2]), layeredControlRowIds: new Set([1, 2]) })

describe('per-joint layered draft selection', () => {
  it('prunes only removed joints and does not restore their choices on reselect', () => {
    const next = resolveLnkResultDraftAfterRowIdsChange(draft(), rows, new Set([2]))
    expect(next.layeredControlRowIds).toEqual(new Set([2]))
    expect(resolveLnkResultDraftAfterRowIdsChange(next, rows, new Set([1, 2])).layeredControlRowIds).toEqual(new Set([2]))
  })
  it('keeps choices for the surviving request only', () => {
    const next = resolveLnkResultDraftAfterRequestChange(draft(), rows, createRequestDocumentIdentity('ПВК-1', '2026-09-01'))
    expect(next.layeredControlRowIds).toEqual(new Set([1]))
  })
  it('clears temporary marks on method changes but keeps them for PVK', () => {
    expect(resolveLnkResultDraftAfterMethodChange(draft(), rows, 'pvkRequest').layeredControlRowIds).toEqual(new Set([1, 2]))
    expect(resolveLnkResultDraftAfterMethodChange(draft(), rows, 'vikRequest').layeredControlRowIds.size).toBe(0)
    expect(resolveLnkResultDraftAfterMethodChange(draft(), rows, '').layeredControlRowIds.size).toBe(0)
  })
})
