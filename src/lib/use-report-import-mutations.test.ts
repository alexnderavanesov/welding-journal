import { describe, expect, it } from 'vitest'
import { buildExistingRowImportUpdates } from './use-report-import-mutations'
import type { WeldRow } from './dispatcher-types'

describe('buildExistingRowImportUpdates', () => {
  it('builds mass fill updates from changed imported values', () => {
    const { updatedRows, changedFieldKeys } = buildExistingRowImportUpdates(
      [{ id: 7, joint: 'F1', material1: null, finalStatus: 'ожидает сварку' } as WeldRow],
      [{ id: 7, material1: '09Г2С' }],
      'massFill',
    )

    expect(updatedRows).toHaveLength(1)
    expect(updatedRows[0]).toMatchObject({ id: 7, material1: '09Г2С' })
    expect([...changedFieldKeys]).toContain('material1')
  })

  it('ignores locked joint changes in existing rows imports', () => {
    const { updatedRows, changedFieldKeys } = buildExistingRowImportUpdates(
      [{ id: 7, joint: 'F1', material1: null, finalStatus: 'ожидает сварку' } as WeldRow],
      [{ id: 7, joint: 'F2', material1: '09Г2С' }],
      'replaceData',
    )

    expect(updatedRows).toHaveLength(1)
    expect(updatedRows[0]).toMatchObject({ id: 7, joint: 'F1', material1: '09Г2С' })
    expect([...changedFieldKeys]).toContain('material1')
    expect([...changedFieldKeys]).not.toContain('joint')
  })
})
