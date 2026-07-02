import {
  WELD_FIELDS,
  type WeldFieldKey,
} from './weld-field-definitions'

const HIDDEN_TABLE_FIELD_KEYS = new Set<string>()

const TABLE_LAYOUT = [
  {
    section: 'Проект',
    columns: [
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
    ],
  },
  { section: 'Спул', columns: ['Спул', 'ID cпула'] },
  { section: 'Стык', columns: ['Стык', 'Статус'] },
  {
    section: 'Материалы',
    columns: [
      'Код заказа 1',
      'Код заказа 2',
      'Элемент 1',
      'Элемент 2',
      'Материал 1',
      'Материал 2',
    ],
  },
  {
    section: 'Сварка',
    columns: ['Тип сварки', 'Тип соедин.', 'D1', 'D2', 'T1', 'T2', 'WDI', 'Дата сварки', 'Ответственный'],
  },
  {
    section: 'Клейма',
    columns: [
      'Корень_1',
      'Заполнение_1',
      'Облицовка_1',
      'Корень_1 - факт',
      'Заполнение_1 - факт',
      'Облицовка_1 - факт',
      'Корень_2',
      'Заполнение_2',
      'Облицовка_2',
      'Корень_2 - факт',
      'Заполнение_2 - факт',
      'Облицовка_2 - факт',
    ],
  },
  {
    section: 'Контроль',
    columns: [
      'наличие ВИК',
      'наличие РК',
      'наличие ПВК',
      'наличие УЗК',
      'наличие ПСТО',
      'наличие ТВМТ',
      'наличие РФА',
      'наличие СТЛС',
      'наличие МКК',
    ],
  },
  {
    section: 'Заявки',
    columns: [
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
    ],
  },
  {
    section: 'Результат',
    columns: [
      'результат ВИК',
      'результат РК',
      'результат ПВК',
      'результат УЗК',
      'результат ПСТО',
      'диаграмма термообработки',
      'результат ТВМТ',
      'результат РФА',
      'результат СТЛС',
      'результат МКК',
      'примечание',
      'Итоговый статус',
    ],
  },
  {
    section: 'Заключения',
    columns: [
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
    ],
  },
  {
    section: 'Прочее',
    columns: [
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
    ],
  },
] as const

function fieldByLabel(label: string) {
  const field = WELD_FIELDS.find((candidate) => candidate.label === label)
  if (!field) throw new Error(`Unknown weld field label: ${label}`)
  return field
}

export const VISIBLE_FIELD_SECTIONS = TABLE_LAYOUT.map(({ section, columns }) => ({
  section,
  fields: columns.map(fieldByLabel).filter((field) => !HIDDEN_TABLE_FIELD_KEYS.has(field.key)),
})).filter((group) => group.fields.length > 0)

export const VISIBLE_FIELDS = VISIBLE_FIELD_SECTIONS.flatMap((group) => group.fields)
export const VISIBLE_SECTION_END_FIELD_KEYS = new Set(
  VISIBLE_FIELD_SECTIONS.map((group) => group.fields.at(-1)?.key).filter((key): key is WeldFieldKey => Boolean(key)),
)
export const FIELD_GROUPS = [...new Set(WELD_FIELDS.map((field) => field.group))]
