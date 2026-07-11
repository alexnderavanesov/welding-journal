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
      'Материал 1',
      'Материал 2',
      'Состав 1',
      'Состав 2',
    ],
  },
  {
    section: 'Сварка',
    columns: ['Способ сварки', 'Тип соединения', 'D1', 'D2', 'T1', 'T2', 'WDI', 'Дата сварки', 'Ответственный'],
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
      'Назначение ВИК',
      'Назначение РК',
      'Назначение УЗК',
      'Назначение ПВК',
      'Назначение ПСТО',
      'Назначение ТВМТ',
      'Назначение РФА',
      'Назначение СТЛС',
      'Назначение МКК',
    ],
  },
  {
    section: 'Заявки',
    columns: [
      'Заявка ВИК',
      'Заявка РК',
      'Заявка УЗК',
      'Заявка ПВК',
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
      'результат УЗК',
      'результат ПВК',
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
      'Дата УЗК',
      'Заключение УЗК',
      'Дата ПВК',
      'Заключение ПВК',
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
    section: 'Код работ',
    columns: [
      'BoQ сварка',
      'BoQ ПСТО',
      'BoQ ВИК',
      'BoQ РК',
      'BoQ УЗК',
      'BoQ ПВК',
      'BoQ ТВМТ',
      'BoQ РФА',
      'BoQ СТЛС',
      'BoQ МКК',
    ],
  },
  {
    section: 'Закрытие',
    columns: [
      'КС3 сварка',
      'КС3 ПСТО',
      'КС3 ВИК',
      'КС3 РК',
      'КС3 УЗК',
      'КС3 ПВК',
      'КС3 ТВМТ',
      'КС3 РФА',
      'КС3 СТЛС',
      'КС3 МКК',
    ],
  },
  {
    section: 'Прочее',
    columns: [
      'Внесен сварка',
      'Внесен ПСТО',
      'Внесен ЛНК',
    ],
  },
  {
    section: 'Материал (дополнительно)',
    columns: [
      'Код заказа 1',
      'Код заказа 2',
      'Уникальный номер материала 1',
      'Уникальный номер материала 2',
      'Полное наименование материала 1',
      'Полное наименование материала 2',
      'Нормативный документ материала 1',
      'Нормативный документ материала 2',
      'Номер сертификата на материал 1',
      'Номер сертификата на материал 2',
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
