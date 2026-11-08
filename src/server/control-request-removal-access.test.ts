import { expect, it } from 'vitest'
import type { AccessIdentity, Permission } from '@/lib/access-permissions'
import { projectControlRequestRemovalPreview, type RestrictedControlRequestRemoval } from './control-request-removal-access'
import { formatControlRequestRemovals } from '@/lib/control-request-removal-preview'

const removals: RestrictedControlRequestRemoval[] = [
  { documentId: 1, title: 'PRIVATE-LNK', date: '2026-11-01', positions: ['F1 · РК'], remaining: 2, accessAreas: ['lnk'] },
  { documentId: 2, title: 'PRIVATE-PSTO', date: '2026-11-02', positions: ['F2 · ПСТО'], remaining: 0, accessAreas: ['psto'] },
  { documentId: 3, title: 'PRIVATE-TVMT', date: '2026-11-03', positions: ['F3 · ТВМТ'], remaining: 0, accessAreas: ['psto'] },
  { documentId: 4, title: 'PRIVATE-MIXED', date: '2026-11-04', positions: ['F4 · РК', 'F4 · ТВМТ'], remaining: 0, accessAreas: ['lnk', 'psto'] },
]
const preview = { token: 'a'.repeat(64), removals }
it.each([
  { name: 'welding-only', permissions: ['welding.view'], expected: [] },
  { name: 'LNK-only', permissions: ['lnk.view'], expected: [1] },
  { name: 'PSTO-only', permissions: ['psto.view'], expected: [2, 3] },
  { name: 'all work areas', permissions: ['welding.view', 'lnk.view', 'psto.view'], expected: [1, 2, 3, 4] },
  { name: 'document registry', permissions: ['documents.view'], expected: [1, 2, 3, 4] },
])('projects $name details without changing confirmation or consequences', ({ permissions, expected }) => {
  const identity: AccessIdentity = { id: 'reader', name: '', email: '', title: '', role: 'user', revision: 1, permissions: permissions as Permission[] }
  const result = projectControlRequestRemovalPreview(preview, identity)
  expect(result.token).toBe(preview.token)
  expect(result.removals.map(item => item.documentId)).toEqual(expected)
  expect(result.hiddenRemovalCount).toBe(removals.length - expected.length)
  expect(JSON.stringify(result)).not.toContain('accessAreas')
  for (const item of removals.filter(item => !expected.includes(item.documentId))) {
    expect(JSON.stringify(result)).not.toContain(item.title)
    expect(JSON.stringify(result)).not.toContain(item.date)
    for (const position of item.positions) expect(JSON.stringify(result)).not.toContain(position)
  }
  const warning = formatControlRequestRemovals(result.removals, result.hiddenRemovalCount)
  if (result.hiddenRemovalCount) expect(warning).toContain('недоступны по вашим правам')
  expect(preview.removals).toBe(removals)
  expect(preview.removals).toHaveLength(4)
})

it('strips internal access metadata for trusted local callers too', () => {
  expect(projectControlRequestRemovalPreview(preview).removals).toEqual(removals.map(({ accessAreas: _accessAreas, ...item }) => item))
})
