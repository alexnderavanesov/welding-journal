import { expect, type Page } from '@playwright/test'

// Independent contract for the fresh user's current journal view.
// October's 111 columns: -8 retired stamps (08.11), -2 service dates hidden by
// the access plan, +weld length, +pre-heat requirement, +2 custom documents.
// Keep the whole ordered list: a matching count alone would miss a substitution.
export const CURRENT_JOURNAL_OUTPUT_HEADERS = [
  'Линия', 'Стык', 'Проект', 'Шифр', 'Группа трубопровода', 'Категория трубопровода',
  'Контроль швов, (%)', 'Изометрия', 'Номер листа', 'Номер ИЗМа', 'Официальность',
  'Актуальность по ИЗМу', 'Спул', 'ID cпула', 'Материал 1', 'Материал 2', 'Марка стали 1', 'Марка стали 2',
  'Способ сварки', 'Тип соединения', 'Группа материалов', 'D1', 'D2', 'T1', 'T2', 'Длина шва, мм',
  'WDI', 'Дата сварки', 'Ответственный', 'Клеймо_1', 'Клеймо_1 - факт', 'Клеймо_2', 'Клеймо_2 - факт',
  'Назначение ВИК', 'Назначение РК', 'Назначение УЗК', 'Назначение ПВК', 'Назначение ПСТО', 'НК до ТО',
  'Основания назначения', 'Заявка ВИК', 'Дата заявки ВИК', 'Заявка РК', 'Дата заявки РК',
  'Заявка УЗК', 'Дата заявки УЗК', 'Заявка ПВК', 'Дата заявки ПВК', 'Заявка ПСТО', 'Дата заявки ПСТО',
  'Результат ВИК', 'Результат РК', 'Результат УЗК', 'Результат ПВК', 'Результат ПСТО',
  'Вид испытаний', 'Контур', 'Дата ГИ', 'Дата ПИ', 'ЖСР', 'Чек-лист', 'ЗНИ',
  'Пользовательский 1', 'Пользовательский 2', 'Номер записи', 'Задачи диспетчера', 'Примечание сварочный журнал',
  'Код заказа 1', 'Код заказа 2', 'Уникальный номер материала 1', 'Уникальный номер материала 2',
  'Полное наименование материала 1', 'Полное наименование материала 2',
  'Нормативный документ материала 1', 'Нормативный документ материала 2',
  'Номер сертификата на материал 1', 'Номер сертификата на материал 2', 'Длина элемента 1, мм', 'Длина элемента 2, мм',
  'Номер технологической карты', 'Сварочные электроды', 'Номер сертификата (электроды)',
  'Присадочная проволока', 'Номер сертификата (проволока)', 'Защитный газ', 'Номер сертификата (газ)',
  'BoQ сварка', 'BoQ ПСТО', 'BoQ ВИК', 'BoQ РК', 'BoQ УЗК', 'BoQ ПВК', 'BoQ ТВМТ', 'BoQ ГИ', 'BoQ ПИ',
  'КС3 сварка', 'КС3 ПСТО', 'КС3 ВИК', 'КС3 РК', 'КС3 УЗК', 'КС3 ПВК', 'КС3 ТВМТ', 'КС3 ГИ', 'КС3 ПИ',
  'Итоговый статус',
]

const serviceDatePosition = CURRENT_JOURNAL_OUTPUT_HEADERS.indexOf('Код заказа 1')
export const ALL_JOURNAL_OUTPUT_HEADERS = [
  ...CURRENT_JOURNAL_OUTPUT_HEADERS.slice(0, serviceDatePosition),
  'Внесен сварка', 'Обновлен сварка',
  ...CURRENT_JOURNAL_OUTPUT_HEADERS.slice(serviceDatePosition),
]

/** Keep maximum-width load coverage; do not mistake the default hidden dates for removed fields. */
export async function showAllJournalOutputColumns(page: Page) {
  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Настройка вида журнала', exact: true })
  await expect(settings.locator('.journal-panel-heading')).toContainText('105 из 107 столбцов')
  // The separate "Следующий шаг" toggle shares this class but is not a column.
  const checkedLabels = () => settings.locator('.journal-column-group label.journal-column-option').evaluateAll(labels => labels
    .filter(label => label.querySelector('input')?.checked)
    .map(label => label.querySelector('span')?.textContent ?? '').sort())
  expect(await checkedLabels()).toEqual([...CURRENT_JOURNAL_OUTPUT_HEADERS].sort())
  await settings.getByRole('button', { name: 'Показать все', exact: true }).click()
  await expect(settings.locator('.journal-panel-heading')).toContainText('107 из 107 столбцов')
  expect(await checkedLabels()).toEqual([...ALL_JOURNAL_OUTPUT_HEADERS].sort())
  await settings.getByRole('button', { name: 'Закрыть настройки вида', exact: true }).click()
  await expect(settings).toBeHidden()
}
