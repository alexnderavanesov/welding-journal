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
})
