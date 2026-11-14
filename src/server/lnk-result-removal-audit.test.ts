import { expect, it } from 'vitest'
import { createAuditOriginResolver } from './audit-origin-policy'

it('attributes the selected deletion to the user and its cleared documents and derived states to the system', () => {
  const origin = createAuditOriginResolver('removeLnkResults', { targets: [{ rowId: 7, methodKey: 'vikRequest', expectedVersion: 'v1' }] })
  const before = { id: 7, vikResult: 'годен', vikConclusion: 'C', finalStatus: 'годен' }
  const after = { id: 7, vikResult: null, vikConclusion: null, finalStatus: 'ожидает НК' }
  expect(origin('weld_joints', before, after, 'vikResult')).toBe('user')
  expect(origin('weld_joints', before, after, 'vikConclusion')).toBe('automatic')
  expect(origin('weld_joints', before, after, 'finalStatus')).toBe('automatic')
  expect(origin('weld_joints', before, { ...after, id: 8 }, 'vikResult')).toBe('automatic')
  expect(origin('generated_documents', { id: 7 }, undefined, 'title')).toBe('automatic')
})
