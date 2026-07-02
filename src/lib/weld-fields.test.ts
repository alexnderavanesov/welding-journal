import { describe, expect, it } from 'vitest'
import { VISIBLE_FIELDS, VISIBLE_FIELD_SECTIONS, calculateFinalStatus, getFinalStatusErrorReason } from './weld-fields'
import { getAlwaysVisibleFieldKeys, getFilteredWeldTableSections } from './weld-table-sections'

describe('weld field order', () => {
  it('keeps table columns in the order defined by the section Excel file', () => {
    expect(VISIBLE_FIELDS.map((field) => field.label).slice(0, 15)).toEqual([
      'Проект/Титул',
      'Шифр/Подтитул',
      'Линия',
      'Группа',
      'Категория',
      'Контроль швов, (%)',
      'Изометрия',
      'Лист',
      '№ Изм.',
      'Актуальность по изм.',
      'Спул',
      'ID cпула',
      'Стык',
      'Статус',
      'Код заказа 1',
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
      'Прочее',
    ])
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
      'Дата ВИК',
      'Заключение ВИК',
      'Дата РК',
      'Заключение РК',
      'Дата ПВК',
      'Заключение ПВК',
      'Дата УЗК',
      'Заключение УЗК',
      'Дата ТВМТ',
      'Заключение ТВМТ',
      'Дата РФА',
      'Заключение РФА',
      'Дата СТЛС',
      'Заключение СТЛС',
      'Дата МКК',
      'Заключение МКК',
      'Описание дефектов',
      'Примечание',
    ])
  })

  it('shows welding and heat treatment tracking fields in the misc section', () => {
    const misc = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Прочее')

    expect(misc?.fields.map((field) => field.label)).toEqual([
      'BoQ сварка',
      'КС3 сварка',
      'Внесен сварка',
      'BoQ ПСТО',
      'КС3 ПСТО',
      'Внесен ПСТО',
      'Внесен ЛНК',
      'BoQ ВИК',
      'КС3 ВИК',
      'BoQ РК',
      'КС3 РК',
      'BoQ ПВК',
      'КС3 ПВК',
      'BoQ УЗК',
      'КС3 УЗК',
      'BoQ ТВМТ',
      'КС3 ТВМТ',
      'BoQ РФА',
      'КС3 РФА',
      'BoQ СТЛС',
      'КС3 СТЛС',
      'BoQ МКК',
      'КС3 МКК',
    ])
  })

  it('shows request columns in the same control order as results', () => {
    const requests = VISIBLE_FIELD_SECTIONS.find((group) => group.section === 'Заявки')

    expect(requests?.fields.map((field) => field.label)).toEqual([
      'Заявка ВИК',
      'Заявка РК',
      'Заявка ПВК',
      'Заявка УЗК',
      'Заявка ПСТО',
      'Заявка ТВМТ',
      'Заявка РФА',
      'Заявка СТЛС',
      'Заявка МКК',
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
      'РК: результат «ожидает НК» заполнен, но наличие РК = «пусто»',
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
