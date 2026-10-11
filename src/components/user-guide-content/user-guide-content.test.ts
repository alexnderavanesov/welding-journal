import { describe, expect, it } from 'vitest'

import { REFERENCE_GUIDE_SECTIONS as REFERENCE_GUIDE_SECTIONS_1 } from '@/components/user-guide-content/reference-sections-1'
import { REFERENCE_GUIDE_SECTIONS as REFERENCE_GUIDE_SECTIONS_2 } from '@/components/user-guide-content/reference-sections-2'
import { REFERENCE_GUIDE_SECTIONS as REFERENCE_GUIDE_SECTIONS_3 } from '@/components/user-guide-content/reference-sections-3'
import { WORK_GUIDE_SECTIONS } from '@/components/user-guide-content/work-sections'

describe('user guide content', () => {
  it('explains PSTO captions inside the picture sections without hiding historical documents', () => {
    const content = JSON.stringify(REFERENCE_GUIDE_SECTIONS_2)
    for (const text of ['ПСТО не предусмотрено', 'ПСТО отменено', 'НК до ТО отключён в настройках',
      'без отдельного блока сверху', 'Подписи не скрывают документы и историю']) expect(content).toContain(text)
  })
  it('teaches only the two contextual corrections and preserves dependency-protected cancellation', () => {
    const content = JSON.stringify([WORK_GUIDE_SECTIONS, REFERENCE_GUIDE_SECTIONS_1, REFERENCE_GUIDE_SECTIONS_2, REFERENCE_GUIDE_SECTIONS_3])
    for (const removed of ['Изменить этап контроля', 'перенести комплект в «До ТО»', 'перенос годного комплекта', 'выберите судьбу связанных комплектов']) expect(content).not.toContain(removed)
    expect(content).not.toContain('Смены этапа у уже внесённого НК нет')
    expect(content).toContain('Весь основной НК → до ТО')
    expect(content).toContain('Весь НК до ТО → основной')
    expect(content).toContain('Основной этап должен быть пустым')
    expect(content).toContain('результат НК до ТО нельзя удалить, пока на него опирается заявка ПСТО')
  })

  it('explains explicit TK replacement/rename, partial completion and event-only dispatcher freshness', () => {
    const cards = JSON.stringify(REFERENCE_GUIDE_SECTIONS_2.find(section => section.id === 'stamps'))
    for (const text of ['по 50 ТК на странице', 'Проверить и назначить ТК', 'весь журнал и все проекты', 'в том числе ручных',
      'Название действительно записывается в стык', 'эта порция целиком не сохраняется', 'отдельного журнала этих операций нет', 'ранее скачанный файл сам не изменится']) expect(cards).toContain(text)
    const dispatcher = JSON.stringify(WORK_GUIDE_SECTIONS)
    for (const text of ['небольшую служебную версию данных', 'Постоянного опроса нет', 'Черновик открытой формы не заменяется', 'всех СП и ДЗ']) expect(dispatcher).toContain(text)
  })
  it('explains compact TK controls, the two-method limit and explicit historical assignment', () => {
    const content = JSON.stringify(REFERENCE_GUIDE_SECTIONS_2.find(section => section.id === 'stamps'))
    expect(content).toContain('один или два способа сварки')
    expect(content).toContain('«Все карты», «Действующие», «Архивные»')
    expect(content).toContain('значок справки для подробной причины')
    expect(content).toContain('для ручного выбора')
    expect(content).toContain('новая подходящая карта не назначается в фоне')
  })
  it('explains the read-only stamp check tab and preserved registry state', () => {
    const stamps = REFERENCE_GUIDE_SECTIONS_2.find(section => section.id === 'stamps')!
    const content = JSON.stringify(stamps)
    expect(content).toContain('Вкладки «Клейма», «Технологические карты» и «Параметры проверки»')
    expect(content).toContain('таблица из 12 вариантов')
    expect(content).toContain('сохраняются поиск, фильтры и раскрытая карточка')
    expect(content).toContain('не меняет настройки или допуски')
    expect(content).toContain('без внутреннего окна')
    expect(content).toContain('Разобрать свой пример проверки клейма')
    expect(content).toContain('не решение «допущен»')
    expect(content).toContain('Цветные примеры: у кого проверяется параметр')
    expect(content).toContain('фиолетовый — проверяется отдельно у каждого')
    expect(content).toContain('варианты через «ИЛИ» равноправны')
    expect(content).toContain('Номера сторон 1/2 не обозначают сварщиков А/Б')
    expect(content).toContain('ввод находится слева, а результат — справа')
    expect(content).toContain('короткие строки «группа → D И T»')
    expect(content).toContain('условия расположены слева, а пояснения — справа')
  })
  it('uses the inch calculation settings name without renaming report sections', () => {
    const reference = JSON.stringify([...REFERENCE_GUIDE_SECTIONS_2, ...REFERENCE_GUIDE_SECTIONS_3])
    expect(reference).toContain('Настройки → Расчет дюймов')
    expect(reference).toContain('Настройка “Расчет дюймов”')
    expect(reference).not.toContain('Настройки → Прочее')
    expect(reference).not.toContain('Настройка “Прочее”')
    expect(JSON.stringify(REFERENCE_GUIDE_SECTIONS_1)).toContain('разделе “Прочее” сварочного журнала')
  })

  it('documents mandatory SP-05 across methods and keeps the older SP-01 warning behavior', () => {
    const settings = REFERENCE_GUIDE_SECTIONS_3.find((section) => section.id === 'settings')!
    const matrix = settings.blocks.find((block) => block.type === 'table' && block.title === 'СП-07: допустимые результаты ЛНК')
    expect(matrix?.type === 'table' ? matrix.table.rows : undefined).toEqual([
      ['ВИК / ПВК', 'Любой D, до двух ремонтов', 'годен, ремонт'],
      ['ВИК / ПВК', 'Любой D, после двух ремонтов', 'только годен'],
      ['РК / УЗК', 'Dmin < 89 мм, до двух ремонтов', 'годен, вырез'],
      ['РК / УЗК', 'Dmin ≥ 89 мм, до двух ремонтов', 'годен, ремонт, вырез'],
      ['РК / УЗК', 'Любой D, после двух ремонтов', 'годен, вырез'],
    ])
    const content = JSON.stringify(settings)
    expect(content).toContain('Само СП-06 не означает запрет любого действия')
    expect(content).toContain('старые выключенные ЗВ-20/ДЗ-17 правило не отключают')
    expect(content).not.toContain('Отключать только если по проекту действует отдельное решение')
    expect(JSON.stringify(REFERENCE_GUIDE_SECTIONS_2)).toContain('даже если в Excel изменен только диаметр')
    expect(JSON.stringify(WORK_GUIDE_SECTIONS)).toContain('Все правила перенумерованы: 12 обязательных СП, 2 отключаемые ЗВ и 6 отключаемых ДЗ')
  })
  it('explains the release waiting page and avoids automatic retry of a save', () => {
    const content = JSON.stringify(WORK_GUIDE_SECTIONS)
    expect(content).toContain('Идёт обновление системы')
    expect(content).toContain('Сама страница ожидания не запускает миграции и не меняет данные')
    expect(content).toContain('сначала проверьте, что уже сохранилось до начала обновления')
    const reference = JSON.stringify(REFERENCE_GUIDE_SECTIONS_1)
    expect(reference).toContain('pnpm db:remote-migration --backup-confirmed --maintenance-window-confirmed --release-deployed-confirmed')
    expect(reference).toContain('/health/live')
    expect(reference).toContain('/health/ready')
  })
  it('does not offer implicit document deletion in either line-move guide', () => {
    const content = JSON.stringify([...WORK_GUIDE_SECTIONS, ...REFERENCE_GUIDE_SECTIONS_1])
    expect(content).toContain('Удаление ошибочных документов выполняется отдельно')
    expect(content).not.toContain('перенести его в «До ТО» либо удалить')
    expect(content).not.toContain('перенести комплект в «До ТО» или удалить')
  })
  it('keeps every concise workflow in its expected order', () => {
    expect(WORK_GUIDE_SECTIONS.map((section) => section.id)).toEqual([
      'work-start',
      'work-journal',
      'work-assignments',
      'work-lnk',
      'work-psto',
      'work-stamps',
      'work-dispatcher',
      'work-percentage',
      'work-statistics',
      'work-documents',
      'work-import',
      'work-settings',
    ])
  })

  it('keeps every full-reference section exactly once across the lazy chunks', () => {
    const sectionIds = [
      ...REFERENCE_GUIDE_SECTIONS_1,
      ...REFERENCE_GUIDE_SECTIONS_2,
      ...REFERENCE_GUIDE_SECTIONS_3,
    ].map((section) => section.id)

    expect(sectionIds).toEqual([
      'start',
      'sidebar',
      'technical-map',
      'journal',
      'control-states',
      'joint-modal',
      'lnk-psto',
      'daily-workflows',
      'import',
      'chains',
      'dispatcher',
      'stamps',
      'percentage-lines',
      'duplicate-control',
      'statistics',
      'documents',
      'settings',
      'rule-matrices',
    ])
    expect(new Set(sectionIds).size).toBe(sectionIds.length)
  })
})
