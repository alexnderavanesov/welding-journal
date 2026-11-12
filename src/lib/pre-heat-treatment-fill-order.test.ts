import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { buildPreHeatTreatmentFillItems, groupPreHeatTreatmentFillItems } from './pre-heat-treatment-fill'
import { buildPreHeatTreatmentRequestWrites, buildPreHeatTreatmentResultWrite } from './pre-heat-treatment-control-updates'
import { DEFAULT_SYSTEM_DOCUMENT_SPLIT_SETTINGS } from './system-document-splitting'
import type { PreHeatTreatmentControlRecord } from './lnk-control-stage'

function complete(row: WeldRow, overrides = {}) {
  const draft = { ...row, preHeatTreatmentControls: [...(row.preHeatTreatmentControls ?? [])] }
  const { items, errors } = buildPreHeatTreatmentFillItems([row], { overrides })
  const { groups } = groupPreHeatTreatmentFillItems([row], items, DEFAULT_SYSTEM_DOCUMENT_SPLIT_SETTINGS)
  for (const group of groups) {
    try {
      const writes = group.action === 'request'
        ? buildPreHeatTreatmentRequestWrites({ row: draft, methodCodes: group.positions.map(p => p.methodCode), requestName: 'Заявка', requestDate: group.date })
        : [buildPreHeatTreatmentResultWrite({ row: draft, methodCode: group.positions[0].methodCode, controlDate: group.date, conclusionName: 'Заключение', result: 'годен' })]
      for (const write of writes) draft.preHeatTreatmentControls = [...draft.preHeatTreatmentControls.filter(c => c.method !== write.method), { ...write, id: write.id ?? -1 } as PreHeatTreatmentControlRecord]
    } catch (error) { errors.push((error as Error).message) }
  }
  return { errors, draft }
}

const row = (extra: Partial<WeldRow> = {}): WeldRow => ({ id: 1, joint: 'S1', line: 'L', projectTitle: 'P', subtitleCode: 'S', connectionType: 'С17',
  weldDate: '2026-11-01', pstoRequired: 'да', preHeatTreatmentRequired: true, hasVik: 'да', hasPvk: 'да', ...extra })

describe('one preliminary package respects method dependencies', () => {
  it.each([{ hasRk: 'да' }, { hasUzk: 'да' }, { hasRk: 'да', hasUzk: 'да' }])('fills all assigned methods together: %j', assignments => {
    const result = complete(row(assignments))
    expect(result.errors).toEqual([])
    expect(result.draft.preHeatTreatmentControls.every(c => c.result === 'годен')).toBe(true)
    expect(result.draft.preHeatTreatmentControls).toHaveLength(2 + Object.keys(assignments).length)
  })
  it('keeps a real date conflict when RK predates the PVK created in the same package', () => {
    const result = complete(row({ hasRk: 'да' }), { '1:result:ПВК': { date: '2026-11-02' } })
    expect(result.errors.join(' ')).toMatch(/ПВК/)
    expect(result.draft.preHeatTreatmentControls.find(c => c.method === 'РК')?.result).not.toBe('годен')
  })
})
