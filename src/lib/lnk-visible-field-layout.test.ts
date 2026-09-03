import { describe, expect, it } from 'vitest'

import { CONTROL_ASSIGNMENT_BASIS_FIELDS } from '@/lib/control-assignment-basis'
import { DUPLICATE_CONTROL_METHODS } from '@/lib/duplicate-control-types'
import { ALL_LNK_FIELD_METHODS, LNK_METHODS } from '@/lib/lnk-report-config'
import { getLnkVisibleFieldSections, LNK_VISIBLE_FIELD_SECTIONS } from '@/lib/lnk-visible-field-layout'
import { CONTROL_RESULT_PAIRS } from '@/lib/weld-status'
import { getAvailableWeldTableSections } from '@/lib/weld-table-sections'
import { LNK_HIDDEN_FIELD_KEYS } from '@/lib/welding-journal-report-config'

describe('LNK visible field layout', () => {
  it('can hide each optional process section independently', () => {
    const withoutLayered = getLnkVisibleFieldSections({ layeredControlEnabled: false })
    const withoutPreHeatTreatment = getLnkVisibleFieldSections({ preHeatTreatmentLnkEnabled: false })

    expect(withoutLayered.some((section) => section.section === 'Послойный контроль')).toBe(false)
    expect(withoutLayered.some((section) => section.section === 'НК до ТО')).toBe(true)
    expect(withoutPreHeatTreatment.some((section) => section.section === 'Послойный контроль')).toBe(true)
    expect(withoutPreHeatTreatment.some((section) => section.section === 'НК до ТО')).toBe(false)
  })

  it('uses one supported weld-joint control method set across the system', () => {
    const lnkMethodCodes = ['ВИК', 'РК', 'УЗК', 'ПВК']

    expect(LNK_METHODS.map((method) => method.code)).toEqual(lnkMethodCodes)
    expect(ALL_LNK_FIELD_METHODS.map((method) => method.code)).toEqual([...lnkMethodCodes, 'ТВМТ'])
    expect(CONTROL_ASSIGNMENT_BASIS_FIELDS.map((method) => method.code)).toEqual(lnkMethodCodes)
    expect(CONTROL_RESULT_PAIRS.map((method) => method.code)).toEqual(lnkMethodCodes)
    expect(DUPLICATE_CONTROL_METHODS).toEqual([...lnkMethodCodes, 'ТВМТ'])
  })

  it('keeps the approved chronological section order', () => {
    expect(LNK_VISIBLE_FIELD_SECTIONS.map((section) => section.section)).toEqual([
      'Проект',
      'Статус',
      'Спул',
      'Стык',
      'Материалы',
      'Сварка',
      'Клейма',
      'Назначения',
      'Послойный контроль',
      'НК до ТО',
      'ВИК',
      'РК',
      'УЗК',
      'ПВК',
      'Прочее',
    ])
  })

  it('shows only the two composite layered-control columns after assignments', () => {
    expect(
      LNK_VISIBLE_FIELD_SECTIONS.find((section) => section.section === 'Послойный контроль')
        ?.fields.map((field) => field.key),
    ).toEqual(['layeredVikDocuments', 'layeredPvkDocuments'])
  })

  it('places RK scheme and defects between the result and conclusion', () => {
    expect(LNK_VISIBLE_FIELD_SECTIONS.find((section) => section.section === 'РК')?.fields.map((field) => field.key)).toEqual([
      'rkRequest',
      'rkRequestDate',
      'rkResult',
      'rkExposureScheme',
      'lnkDefectDescription',
      'rkConclusionDate',
      'rkConclusion',
    ])
  })

  it('keeps officiality and revision actuality in the optional status section', () => {
    expect(LNK_VISIBLE_FIELD_SECTIONS.slice(0, 2).map((section) => section.section)).toEqual(['Проект', 'Статус'])
    expect(LNK_VISIBLE_FIELD_SECTIONS.find((section) => section.section === 'Статус')?.fields.map((field) => field.key)).toEqual([
      'officiality',
      'revisionActuality',
    ])
    expect(LNK_VISIBLE_FIELD_SECTIONS.find((section) => section.section === 'Стык')?.fields.map((field) => field.key)).toEqual([
      'joint',
      'finalStatus',
    ])
  })

  it('does not lose any visible LNK fields while regrouping them', () => {
    const defaultKeys = getAvailableWeldTableSections({
      hiddenFieldKeys: LNK_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    }).flatMap((section) => section.fields.map((field) => field.key)).sort()
    const regroupedKeys = getAvailableWeldTableSections({
      hiddenFieldKeys: LNK_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
      sectionLayout: LNK_VISIBLE_FIELD_SECTIONS,
    }).flatMap((section) => section.fields.map((field) => field.key)).sort()

    expect(regroupedKeys).toEqual([
      ...defaultKeys,
      'layeredPvkDocuments',
      'layeredVikDocuments',
    ].sort())
  })
})
