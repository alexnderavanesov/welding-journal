import { describe, expect, it } from 'vitest'

import { LNK_VISIBLE_FIELD_SECTIONS } from '@/lib/lnk-visible-field-layout'
import { getAvailableWeldTableSections } from '@/lib/weld-table-sections'
import { LNK_HIDDEN_FIELD_KEYS } from '@/lib/welding-journal-report-config'

describe('LNK visible field layout', () => {
  it('keeps the approved chronological section order', () => {
    expect(LNK_VISIBLE_FIELD_SECTIONS.map((section) => section.section)).toEqual([
      'Проект',
      'Спул',
      'Стык',
      'Материалы',
      'Сварка',
      'Клейма',
      'Назначения',
      'НК до ТО',
      'ВИК',
      'РК',
      'УЗК',
      'ПВК',
      'РФА',
      'СТЛС',
      'МКК',
      'Прочее',
    ])
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

    expect(regroupedKeys).toEqual(defaultKeys)
  })
})
