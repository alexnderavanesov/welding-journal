import { expect, it, vi } from 'vitest'
import type { WeldJoint } from '@/db/schema'
import { buildWeldBatchUpdatePayload, toDbInsert } from './weld-persistence'
import { getWorkflowResultValueIssues } from '@/lib/workflow-result-values'
import { isCompletedPstoResult, normalizeTvmtResult } from '@/lib/tvmt-cycle'
import { normalizeResultStatus } from '@/lib/weld-status'
import * as weldStatus from '@/lib/weld-status'

const fields = ['vikResult', 'rkResult', 'uzkResult', 'pvkResult', 'pstoResult', 'tvmtResult'] as const
for (const field of fields) it.each(['HISTORICAL-UNKNOWN', 'да', 'не годен'])(`${field}: unrelated batch edits preserve stored %s through persistence`, value => {
  const previous = { id: 1, joint: 'F1', weldDate: '2026-01-01', hasVik: 'да', hasRk: 'да', hasUzk: 'да', hasPvk: 'да',
    pstoRequired: 'да', hasTvmt: 'да', vikRequest: 'VREQ', rkRequest: 'RREQ', uzkRequest: 'UREQ', pvkRequest: 'PREQ',
    pstoRequest: 'PSTO-REQ', tvmtRequest: 'TVMT-REQ', [field]: value } as unknown as WeldJoint
  const next = { ...previous, lnkNote: 'Unrelated correction' }
  const saved = buildWeldBatchUpdatePayload(next, new Map([[1, previous]]), new Date('2026-11-13T00:00:00Z'))
  expect(saved[field]).toBe(value)
  expect(toDbInsert(next, false, { previous })[field]).toBe(value)
  expect(saved.lnkNote).toBe('Unrelated correction')
})

it('does not preserve absence or pending labels across request and assignment transitions', () => {
  const save = (previous: Partial<WeldJoint>, patch: Partial<WeldJoint>) => toDbInsert({ ...previous, ...patch }, false, { previous })
  expect(save({ hasVik: 'да', vikResult: null }, { vikRequest: 'NEW' }).vikResult).toBe('ожидает НК')
  expect(save({ hasVik: 'да', vikResult: 'ожидает заявку' }, { vikRequest: 'NEW' }).vikResult).toBe('ожидает НК')
  expect(save({ hasVik: 'да', vikRequest: 'OLD', vikResult: 'ожидает НК' }, { vikRequest: null }).vikResult).toBe('ожидает заявку')
  expect(save({ pstoRequired: 'да', pstoResult: null }, { pstoRequest: 'NEW' }).pstoResult).toBe('ожидает')
  expect(save({ pstoRequired: 'да', pstoResult: 'ожидает заявку' }, { pstoRequest: 'NEW' }).pstoResult).toBe('ожидает')
  expect(save({ hasVik: 'отменен', vikResult: 'годен (отменен)' }, { hasVik: 'да' }).vikResult).toBe('годен')
  expect(save({ pstoRequired: 'отменен', pstoResult: 'проведено (отменен)' }, { pstoRequired: 'да' }).pstoResult).toBe('проведено')
})

it.each(['HISTORICAL-UNKNOWN', 'не годен', 'да', 'не годен · назначение отменено'])(
  'legacy VIK %s survives auto-assignment and request metadata backfill without erasing the fact', vikResult => {
    const previous = { id: 1, joint: 'F1', weldDate: '2026-01-01', hasVik: null, vikResult } as WeldJoint
    for (const patch of [{ lnkNote: 'Note' }, { vikRequest: 'Recovered request', vikRequestDate: '2026-01-02' }, { hasVik: 'да' }]) {
      const next = { ...previous, ...patch }
      expect(toDbInsert(next, false, { previous }).vikResult).toBe(vikResult)
      expect(buildWeldBatchUpdatePayload(next, new Map([[1, previous]]), new Date()).vikResult).toBe(vikResult)
    }
  })

it.each(['да', 'проведено', 'проведено (отменен)', 'проведено · назначение отменено'])('new PSTO %s remains completed in the actual persistence payload', pstoResult => {
  const record = { pstoRequired: 'да', pstoResult }
  expect(getWorkflowResultValueIssues(record)).toEqual([])
  for (const previous of [undefined, { pstoRequired: 'да', pstoResult: 'ожидает' }]) {
    const saved = toDbInsert(record, !previous, { previous })
    expect(saved.pstoResult).toBe('проведено')
    expect(isCompletedPstoResult(saved.pstoResult)).toBe(true)
  }
})

it.each(['годен', 'да', 'ремонт', 'вырез', 'годен (отменен)', 'годен · назначение отменено', 'ремонт · назначение отменено'])(
  'new LNK %s retains its factual meaning after storage', rkResult => {
    expect(getWorkflowResultValueIssues({ rkResult })).toEqual([])
    const saved = toDbInsert({ hasRk: 'да', rkResult })
    expect(normalizeResultStatus(saved.rkResult)).toBe(normalizeResultStatus(rkResult))
  })

it.each(['годен', 'да', 'не годен', 'негоден', 'ремонт', 'вырез', 'не годен · назначение отменено'])(
  'new TVMT %s retains its factual meaning after storage', tvmtResult => {
    expect(getWorkflowResultValueIssues({ tvmtResult })).toEqual([])
    expect(normalizeTvmtResult(toDbInsert({ hasTvmt: 'да', tvmtResult }).tvmtResult)).toBe(normalizeTvmtResult(tvmtResult))
  })

it('adds no status calculation when the unchanged stored result already normalized identically', () => {
  const previous = { id: 1, joint: 'F1', hasVik: 'да', vikRequest: 'REQ', vikResult: 'годен' } as WeldJoint
  const calculate = vi.spyOn(weldStatus, 'calculateFinalStatus')
  try {
    toDbInsert(previous)
    const baseline = calculate.mock.calls.length
    calculate.mockClear()
    toDbInsert({ ...previous, lnkNote: 'Note' }, false, { previous })
    expect(calculate).toHaveBeenCalledTimes(baseline)
  } finally { calculate.mockRestore() }
})
