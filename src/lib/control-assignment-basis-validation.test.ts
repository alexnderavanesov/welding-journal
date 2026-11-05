import { describe, expect, it } from 'vitest'
import { getControlAssignmentBasisIssues } from './control-assignment-basis-validation'
import { getWeldFormSaveBlockReason } from './weld-form-save-reasons'
import { applyProgramPatch, previewProgramChanges } from './line-program-workspace'
import type { WeldRow } from './dispatcher-types'

describe('assignment basis: latest user decision 04.11.2026', () => {
  it('preserves unchanged automatic inheritance from a stored legacy source, without exempting manual assignments', () => {
    const source = { id: 1, hasRk: 'дополнительный', hasUzk: 'отменен', rkControlBasis: null, uzkControlBasis: null }
    const { id: _id, ...inherited } = source
    expect(getControlAssignmentBasisIssues(inherited, undefined, source)).toEqual([])
    expect(getControlAssignmentBasisIssues(inherited)).toHaveLength(2)
    expect(getControlAssignmentBasisIssues({ ...inherited, hasRk: 'отменен' }, undefined, source)).toHaveLength(1)
    expect(getControlAssignmentBasisIssues(inherited, undefined, { ...source, rkControlBasis: 'ТР-1' })).toHaveLength(1)
    // An actual existing row always takes precedence over an inheritance source.
    expect(getControlAssignmentBasisIssues({ ...inherited, id: 2 }, { id: 2, hasRk: 'да', hasUzk: 'да' }, source)).toHaveLength(2)
  })
  it.each(['отменен', 'дополнительный'])('requires a nonblank basis for new or changed %s', state => {
    expect(getControlAssignmentBasisIssues({ hasRk: state, rkControlBasis: '  ' })[0].fieldKeys).toEqual(['hasRk', 'rkControlBasis'])
    expect(getControlAssignmentBasisIssues({ hasRk: state, rkControlBasis: ' ТР-1 ' })).toEqual([])
    expect(getWeldFormSaveBlockReason({ id: 1, hasRk: state }, { id: 1, hasRk: 'да' })).toContain('Основание')
  })
  it('preserves old empty bases on unrelated edits, but rejects changing the status or erasing an existing basis', () => {
    const row = { id: 1, hasRk: 'отменен', rkControlBasis: null }
    expect(getControlAssignmentBasisIssues({ ...row, weldingJournalNote: 'Исправлено' }, row)).toEqual([])
    expect(getControlAssignmentBasisIssues({ ...row, hasRk: 'дополнительный' }, row)).toHaveLength(1)
    expect(getControlAssignmentBasisIssues(row, { ...row, rkControlBasis: 'ТР-1' })).toHaveLength(1)
    expect(getControlAssignmentBasisIssues({ ...row, hasRk: 'да' }, row)).toEqual([])
  })
  it('reports independent methods together, without changing inherited PSTO/TVMT policies', () => {
    expect(getControlAssignmentBasisIssues({ hasRk: 'отменен', hasUzk: 'дополнительный', hasTvmt: 'отменен', pstoRequired: 'отменен' })).toHaveLength(2)
  })
  it('allows an incomplete line-program draft but blocks its preview until the basis is supplied', () => {
    const row: WeldRow = { id: 1, joint: 'S1', connectionType: 'С17' }
    const line = { id: 1, weldControlPercent: 10, pvkControlPercent: 10 }
    expect(applyProgramPatch(row, { РК: 'дополнительный' }).hasRk).toBe('дополнительный')
    expect(previewProgramChanges([row], [{ id: 1, values: { РК: 'дополнительный' } }], line).errors.join()).toContain('Основание')
    expect(previewProgramChanges([row], [{ id: 1, values: { РК: 'дополнительный', rkControlBasis: 'ТР № 1' } }], line).errors).toEqual([])
  })
})
