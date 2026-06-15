import { describe, expect, it } from 'vitest'
import { VISIBLE_FIELDS, VISIBLE_FIELD_SECTIONS } from './weld-fields'

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
      'Актуал-ть (по изм.)',
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
      'Прочее',
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
})
