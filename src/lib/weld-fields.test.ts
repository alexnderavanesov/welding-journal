import { describe, expect, it } from 'vitest'
import { VISIBLE_FIELDS, VISIBLE_FIELD_SECTIONS, calculateFinalStatus, getFinalStatusErrorReason } from './weld-fields'
import { getAlwaysVisibleFieldKeys, getAvailableWeldTableSections, getFilteredWeldTableSections } from './weld-table-sections'
import { HEAT_TREATMENT_HIDDEN_FIELD_KEYS, LNK_HIDDEN_FIELD_KEYS, WELDING_JOURNAL_HIDDEN_FIELD_KEYS } from './report-config'
import { formHiddenFieldKeys, secondaryWeldFormFieldKeys } from './weld-form-field-sets'

describe('weld field order', () => {
  it('keeps table columns in the order defined by the section Excel file', () => {
    expect(VISIBLE_FIELDS.map((field) => field.label).slice(0, 15)).toEqual([
      'Проект',
      'Шифр',
      'Линия',
      'Группа трубопровода',
      'Категория трубопровода',
      'Контроль швов, (%)',
      'Изометрия',
      'Номер листа',
      'Номер ИЗМа',
      'Актуальность по ИЗМу',
      'Спул',
      'ID cпула',
      'Стык',
      'Статус',
      'Материал 1',
    ])
  })

  it('groups visible columns into section headers', () => {
    expect(VISIBLE_FIELD_SECTIONS.map((group) => group.section)).toEqual([
      'Проект',
      'Спул',
      'Стык',
      'Материалы',
      'Сварка',
      'Клейма',
      'Контроль',
      'Заявки',
      'Результат',
      'Заключения',
      'Испытания',
      'Код работ',
      'Закрытие',
      'Прочее',
      'Материал (дополнительно)',
    ])
  })

  it('hides additional material fields from LNK and PSTO reports only', () => {
    const journalSections = getAvailableWeldTableSections({
      hiddenFieldKeys: WELDING_JOURNAL_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    })
    const lnkSections = getAvailableWeldTableSections({
      hiddenFieldKeys: LNK_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    })
    const pstoSections = getAvailableWeldTableSections({
      hiddenFieldKeys: HEAT_TREATMENT_HIDDEN_FIELD_KEYS,
      mergePstoSections: true,
    })

    expect(journalSections.some((group) => group.section === 'Материал (дополнительно)')).toBe(true)
    expect(lnkSections.some((group) => group.section === 'Материал (дополнительно)')).toBe(false)
    expect(pstoSections.some((group) => group.section === 'Материал (дополнительно)')).toBe(false)
  })

  it('shows testing fields only in the welding journal report', () => {
    const journalSections = getAvailableWeldTableSections({
      hiddenFieldKeys: WELDING_JOURNAL_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    })
    const lnkSections = getAvailableWeldTableSections({
      hiddenFieldKeys: LNK_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    })
    const pstoSections = getAvailableWeldTableSections({
      hiddenFieldKeys: HEAT_TREATMENT_HIDDEN_FIELD_KEYS,
      mergePstoSections: true,
    })

    expect(journalSections.some((group) => group.section === 'Испытания')).toBe(true)
    expect(journalSections.flatMap((group) => group.fields).map((field) => field.key)).toEqual(
      expect.arrayContaining(['testContour', 'testDate', 'testBoq', 'testKs3']),
    )
    expect(lnkSections.flatMap((group) => group.fields).map((field) => field.key)).not.toEqual(
      expect.arrayContaining(['testContour', 'testDate', 'testBoq', 'testKs3']),
    )
    expect(pstoSections.flatMap((group) => group.fields).map((field) => field.key)).not.toEqual(
      expect.arrayContaining(['testContour', 'testDate', 'testBoq', 'testKs3']),
    )
  })

  it('keeps weld control percent visible when the project section is collapsed', () => {
    const alwaysVisibleFieldKeys = getAlwaysVisibleFieldKeys(false)
    const projectSection = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Проект')

    expect(projectSection).toBeDefined()

    const sections = getFilteredWeldTableSections({
      availableSections: [projectSection!],
      collapsedSections: new Set(['Проект']),
      alwaysVisibleFieldKeys,
    })

    expect(sections[0]?.fields.map((field) => field.key)).toEqual([
      'projectTitle',
      'subtitleCode',
      'line',
      'weldControlPercent',
    ])
  })

  it('shows LNK conclusion columns after result columns', () => {
    const conclusions = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Заключения')

    expect(conclusions?.fields.map((field) => field.label)).toEqual([
      'Заключение ВИК',
      'Дата ВИК',
      'Заключение РК',
      'Дата РК',
      'Заключение УЗК',
      'Дата УЗК',
      'Заключение ПВК',
      'Дата ПВК',
      'Заключение ТВМТ',
      'Дата ТВМТ',
      'Заключение РФА',
      'Дата РФА',
      'Заключение СТЛС',
      'Дата СТЛС',
      'Заключение МКК',
      'Дата МКК',
      'Описание дефектов',
      'Примечание',
    ])
  })

  it('shows welding customer work code and acceptance fields in separate sections', () => {
    const tests = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Испытания')
    const customerWorkCode = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Код работ')
    const acceptance = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Закрытие')

    expect(tests?.fields.map((field) => field.label)).toEqual([
      'Контур',
      'Дата испытаний',
    ])
    expect(customerWorkCode?.fields.map((field) => field.label)).toEqual([
      'BoQ сварка',
      'BoQ испытания',
      'BoQ ПСТО',
      'BoQ ВИК',
      'BoQ РК',
      'BoQ УЗК',
      'BoQ ПВК',
      'BoQ ТВМТ',
      'BoQ РФА',
      'BoQ СТЛС',
      'BoQ МКК',
    ])
    expect(acceptance?.fields.map((field) => field.label)).toEqual([
      'КС3 сварка',
      'КС3 испытания',
      'КС3 ПСТО',
      'КС3 ВИК',
      'КС3 РК',
      'КС3 УЗК',
      'КС3 ПВК',
      'КС3 ТВМТ',
      'КС3 РФА',
      'КС3 СТЛС',
      'КС3 МКК',
    ])
  })

  it('keeps work code and acceptance fields available in the weld form secondary tab', () => {
    expect([...secondaryWeldFormFieldKeys].some((fieldKey) => formHiddenFieldKeys.has(fieldKey))).toBe(false)
    expect(secondaryWeldFormFieldKeys.has('testContour')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('testDate')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('boq')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('ks3')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('testBoq')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('testKs3')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('pstoBoq')).toBe(true)
    expect(secondaryWeldFormFieldKeys.has('pstoKs3')).toBe(true)
  })

  it('keeps BoQ and KS3 fields visible in the welding journal report', () => {
    const sections = getAvailableWeldTableSections({
      hiddenFieldKeys: WELDING_JOURNAL_HIDDEN_FIELD_KEYS,
      mergePstoSections: false,
    })
    const customerWorkCode = sections.find((group) => group.section === 'Код работ')
    const acceptance = sections.find((group) => group.section === 'Закрытие')
    const tests = sections.find((group) => group.section === 'Испытания')

    expect(tests?.fields.map((field) => field.label)).toEqual([
      'Контур',
      'Дата испытаний',
    ])
    expect(customerWorkCode?.fields.map((field) => field.label)).toEqual([
      'BoQ сварка',
      'BoQ испытания',
      'BoQ ПСТО',
      'BoQ ВИК',
      'BoQ РК',
      'BoQ УЗК',
      'BoQ ПВК',
      'BoQ ТВМТ',
      'BoQ РФА',
      'BoQ СТЛС',
      'BoQ МКК',
    ])
    expect(acceptance?.fields.map((field) => field.label)).toEqual([
      'КС3 сварка',
      'КС3 испытания',
      'КС3 ПСТО',
      'КС3 ВИК',
      'КС3 РК',
      'КС3 УЗК',
      'КС3 ПВК',
      'КС3 ТВМТ',
      'КС3 РФА',
      'КС3 СТЛС',
      'КС3 МКК',
    ])
  })

  it('shows service tracking fields in the misc section', () => {
    const misc = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Прочее')

    expect(misc?.fields.map((field) => field.label)).toEqual([
      'Внесен сварка',
      'Внесен ПСТО',
      'Внесен ЛНК',
    ])
  })

  it('shows request columns in the same control order as results', () => {
    const requests = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Заявки')

    expect(requests?.fields.map((field) => field.label)).toEqual([
      'Заявка ВИК',
      'Дата заявки ВИК',
      'Заявка РК',
      'Дата заявки РК',
      'Заявка УЗК',
      'Дата заявки УЗК',
      'Заявка ПВК',
      'Дата заявки ПВК',
      'Заявка ПСТО',
      'Дата заявки ПСТО',
      'Заявка ТВМТ',
      'Дата заявки ТВМТ',
      'Заявка РФА',
      'Дата заявки РФА',
      'Заявка СТЛС',
      'Дата заявки СТЛС',
      'Заявка МКК',
      'Дата заявки МКК',
      'дата ПСТО',
    ])
  })

  it('shows heat treatment result before the generated diagram', () => {
    const results = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Результат')
    const labels = results?.fields.map((field) => field.label) ?? []

    expect(labels.indexOf('результат ПСТО')).toBeLessThan(labels.indexOf('диаграмма термообработки'))
  })

  it('does not treat cancelled controls with old results as an error', () => {
    expect(calculateFinalStatus({ hasPvk: 'отменен', pvkResult: 'годен' })).toBe('ожидает сварку')
    expect(calculateFinalStatus({ pstoRequired: 'отменен', pstoResult: 'проведено' })).toBe('ожидает сварку')
  })

  it('explains final status errors caused by result without active control', () => {
    expect(getFinalStatusErrorReason({ hasRk: null, rkResult: 'ожидает НК' })).toContain(
      'РК: результат «ожидает НК» заполнен, но назначение РК = «пусто»',
    )
    expect(getFinalStatusErrorReason({ hasRk: 'отменен', rkResult: 'ожидает НК' })).toBeNull()
  })

  it('skips cancelled controls when active controls still wait for NDT', () => {
    expect(
      calculateFinalStatus({
        weldDate: '20.03.2025',
        hasVik: 'отменен',
        vikRequest: 'Заявка-1',
        vikResult: 'отменен',
        hasRk: 'да',
        rkRequest: 'Заявка-2',
        rkResult: 'ожидает НК',
        pstoRequired: 'отменен',
        pstoResult: 'отменен',
      }),
    ).toBe('ожидает НК')
  })

  it('treats positive cancelled result as good when control is enabled again', () => {
    expect(
      calculateFinalStatus({
        weldDate: '20.03.2025',
        hasVik: 'да',
        vikResult: 'годен (отменен)',
      }),
    ).toBe('годен')
  })

  it('treats additional controls as active controls', () => {
    expect(
      calculateFinalStatus({
        weldDate: '20.03.2025',
        hasRk: 'дополнительный',
        rkRequest: 'Заявка-1',
        rkResult: 'годен',
      }),
    ).toBe('годен')

    expect(
      calculateFinalStatus({
        weldDate: '20.03.2025',
        hasRk: 'дополнительный',
        rkRequest: 'Заявка-1',
        rkResult: 'ожидает НК',
      }),
    ).toBe('ожидает НК')
  })

  it('treats pending NDT results as waiting', () => {
    expect(calculateFinalStatus({ weldDate: '20.03.2025', hasPvk: true, pvkRequest: 'Заявка-1', pvkResult: 'ожидает НК' })).toBe(
      'ожидает НК',
    )
  })

  it('prioritizes waiting NDT over missing request in final status', () => {
    expect(
      calculateFinalStatus({
        weldDate: '20.03.2025',
        hasVik: 'да',
        vikRequest: '',
        vikResult: 'ожидает заявку',
        hasRk: 'да',
        rkRequest: 'Заявка-1',
        rkResult: 'ожидает НК',
      }),
    ).toBe('ожидает НК')
  })

  it('keeps waiting request when the other control is cancelled', () => {
    expect(
      calculateFinalStatus({
        weldDate: '20.03.2025',
        hasVik: 'да',
        vikRequest: '',
        vikResult: 'ожидает заявку',
        hasRk: 'отменен',
        rkResult: 'отменен',
      }),
    ).toBe('ожидает заявку')
  })

  it('does not let pending heat treatment keep a good NDT joint waiting', () => {
    expect(
      calculateFinalStatus({
        weldDate: '20.03.2025',
        hasVik: 'да',
        vikResult: 'годен',
        hasRk: 'да',
        rkResult: 'годен',
        pstoRequired: 'да',
        pstoResult: null,
      }),
    ).toBe('годен')
  })
})
