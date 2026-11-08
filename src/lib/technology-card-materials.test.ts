import { expect, it } from 'vitest'
import { getTechnologyCardMaterialChanges } from './technology-card-materials'
import { createTechnologyCardAssignmentClassifier } from './technology-card-assignment'
import { DEFAULT_DATA_LIST_SETTINGS } from './data-list-settings'
import type { TechnologyCardRecord } from './technology-card-types'

it('refreshes only nonempty defaults and keeps values under empty or missing card fields', () => {
  const source = Object.freeze({ weldingElectrodes: 'Вручную', fillerWire: 'Сохранить', shieldingGas: 'Аргон', shieldingGasCertificateNumber: 'G-1' })
  expect(getTechnologyCardMaterialChanges(source, { weldingElectrodes: ' Новые ', fillerWire: ' ', shieldingGas: 'Аргон', shieldingGasCertificateNumber: null }))
    .toEqual({ weldingElectrodes: 'Новые' })
  expect(source.weldingElectrodes).toBe('Вручную')
  expect(getTechnologyCardMaterialChanges({}, {})).toEqual({})
})

it('offers a material refresh for the same applicable card, and becomes unchanged after applying it', () => {
  const card: TechnologyCardRecord = { id: 1, revision: 2, archived: false, name: 'TK', weldingMethods: ['РАД'], materialGroups: ['М01'],
    connectionType: 'С17', diameterFrom: 1, diameterTo: 200, thicknessFrom: 1, thicknessTo: 10, psto: 'any', weldingElectrodes: 'Э-2' }
  const classify = createTechnologyCardAssignmentClassifier({ cards: [card], names: [{ name: card.name, cardId: card.id }] }, DEFAULT_DATA_LIST_SETTINGS)
  const row = { id: 3, version: '1', projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1', technologyCardNumber: card.name,
    weldDate: '2026-11-01', weldingMethod: 'РАД', materialGroup: 'М01', connectionType: 'С17', d1: 57, d2: 57, t1: 3, t2: 3,
    weldingElectrodes: 'Ручные', fillerWire: 'Ручная проволока' }
  const proposal = classify(row)
  expect(proposal).toMatchObject({ kind: 'materials', mismatch: false, materialChanges: { weldingElectrodes: 'Э-2' }, previousMaterials: { weldingElectrodes: 'Ручные' } })
  expect(classify({ ...row, ...proposal.materialChanges })).toMatchObject({ kind: 'unchanged', materialChanges: {} })
  expect(classify({ ...row, d1: null }).kind).toBe('incomplete')
  expect(classify({ ...row, weldDate: '' }).kind).toBe('excluded')
})
