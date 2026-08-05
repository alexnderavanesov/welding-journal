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

  it('updates LNK and PSTO notes only for rows that belong to the corresponding reports', () => {
    const rows = [
      {
        id: 7,
        joint: 'F1',
        weldDate: '2026-07-31',
        hasVik: 'да',
        pstoRequired: 'да',
        lnkNote: null,
        pstoNote: null,
        finalStatus: 'ожидает заявку',
      },
      {
        id: 8,
        joint: 'F2',
        weldDate: null,
        hasVik: null,
        pstoRequired: null,
        lnkNote: null,
        pstoNote: null,
        finalStatus: 'ожидает сварку',
      },
    ] as WeldRow[]

    const { updatedRows, changedFieldKeys } = buildExistingRowImportUpdates(
      rows,
      [
        { id: 7, lnkNote: 'Примечание ЛНК', pstoNote: 'Примечание ПСТО' },
        { id: 8, lnkNote: 'Не читать', pstoNote: 'Не читать' },
      ],
      'replaceData',
    )

    expect(updatedRows).toHaveLength(1)
    expect(updatedRows[0]).toMatchObject({
      id: 7,
      lnkNote: 'Примечание ЛНК',
      pstoNote: 'Примечание ПСТО',
    })
    expect([...changedFieldKeys]).toEqual(expect.arrayContaining(['lnkNote', 'pstoNote']))
  })
})
