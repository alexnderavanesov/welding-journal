import { SYSTEM_RULE_CATALOG, getSystemRuleTargetId, resolveSystemRuleSettingsHash } from './system-rule-catalog'
import { SAVE_CHECK_SETTING_ITEMS, getSaveCheckSettingCode } from './save-check-settings'
import { DISPATCHER_SETTING_GROUPS, getDispatcherSettingCode } from './dispatcher-settings'

export const RULE_SETTINGS_TABS = [
  { id: 'system', label: 'Системные правила', count: SYSTEM_RULE_CATALOG.length },
  { id: 'input', label: 'Защиты ввода', count: SAVE_CHECK_SETTING_ITEMS.length },
  { id: 'tasks', label: 'Задачи диспетчера', count: DISPATCHER_SETTING_GROUPS.reduce((count, group) => count + group.items.length, 0) },
  { id: 'exceptions', label: 'Принятые исключения' },
  { id: 'parameters', label: 'Параметры' },
] as const
export type RuleSettingsTab = (typeof RULE_SETTINGS_TABS)[number]['id']

const references = [
  ...SYSTEM_RULE_CATALOG.map(rule => ({ code: rule.code as string, title: rule.title, targetId: getSystemRuleTargetId(rule.code), tab: 'system' as const })),
  ...SAVE_CHECK_SETTING_ITEMS.map(item => ({ code: getSaveCheckSettingCode(item.id), title: item.label, targetId: `save-check-setting-${item.id}`, tab: 'input' as const })),
  ...DISPATCHER_SETTING_GROUPS.flatMap(group => group.items.map(item => ({ code: getDispatcherSettingCode(item.id), title: item.label, targetId: `dispatcher-setting-${item.id}`, tab: 'tasks' as const }))),
]

export function getRuleSettingsReference(code: string) {
  return references.find(reference => reference.code === code)
}

export function getRuleSettingsTarget(hash: string) {
  const rule = resolveSystemRuleSettingsHash(hash)
  if (rule) return getSystemRuleTargetId(rule.code)
  const target = hash.replace(/^#/, '')
  if (references.some(reference => reference.targetId === target) ||
      RULE_SETTINGS_TABS.some(tab => `rules-${tab.id}` === target) ||
      ['rules-accepted-exceptions', 'rules-dispatcher-background', 'rules-dls-requirement'].includes(target)) return target
  return undefined
}

export function getRuleSettingsTab(target: string | null | undefined): RuleSettingsTab | undefined {
  if (!target) return undefined
  if (target === 'rules-accepted-exceptions') return 'exceptions'
  if (target === 'rules-dispatcher-background' || target === 'rules-dls-requirement') return 'parameters'
  return references.find(reference => reference.targetId === target)?.tab
    ?? RULE_SETTINGS_TABS.find(tab => `rules-${tab.id}` === target)?.id
}

// Explanatory links, not new dependencies or switches. Every edge is shown in
// both directions, with the same meaning and the actual current rule codes.
export const RULE_CONNECTIONS: readonly (readonly [string, string, string])[] = [
  ['ЗВ-01', 'СП-02', 'Архив — организационный признак. Отключение запрета архивного клейма не отменяет проверку допуска на дату сварки.'],
  ['ЗВ-02', 'СП-09', 'Свободный формат обычного имени не разрешает менять системные связи ремонта и катушки.'],
  ['ЗВ-02', 'СП-11', 'Отключение шаблона имени не разрешает разрушать сохранённую историю.'],
  ['ДЗ-01', 'СП-01', 'Напоминание о новом клейме можно скрыть; участие сварщика в программе линии от этого не меняется.'],
  ['ДЗ-02', 'СП-01', 'Уточнение официальности может изменить расчёт программы. Принятие напоминания само по себе официальность не меняет.'],
  ['ДЗ-02', 'СП-09', 'Официальность и негодные результаты учитываются при продолжении цепочки независимо от показа напоминания.'],
  ['ДЗ-03', 'СП-09', 'Предупреждение о возможном дубле отключаемо; неоднозначная реальная цепочка всё равно требует исправления.'],
  ['ДЗ-04', 'СП-02', 'Напоминание о сроке НАКС отключаемо. Действительность допуска на дату сварки проверяется всегда.'],
  ['ДЗ-05', 'СП-02', 'Напоминание о сроке ДЛС отключаемо. Проверка применимого требования ДЛС продолжает действовать.'],
  ['СП-01', 'СП-08', 'Программа линии учитывает обязательные методы ремонтного продолжения; их нельзя снять ради процентной нормы.'],
  ['СП-02', 'СП-03', 'Пустые официальные клейма — неполнота. Когда клеймо внесено, проверяется его допуск на дату сварки.'],
  ['СП-04', 'СП-05', 'Для последовательности методов важны и необходимые результаты, и фактические даты контроля.'],
  ['СП-04', 'СП-06', 'Предыдущие этапы и порядок их фактических дат проверяются отдельно от порядка ввода данных.'],
  ['СП-04', 'СП-10', 'В циклах ПСТО/ТВМТ проверяются применимые даты работ и документов.'],
  ['СП-05', 'СП-07', 'Допустимый результат не отменяет требования к предшествующим методам НК.'],
  ['СП-06', 'СП-10', 'Завершённость этапов учитывает историю циклов ПСТО/ТВМТ именно этого стыка.'],
  ['СП-07', 'СП-08', 'Метод с негодным результатом определяет обязательный контроль следующего ремонта.'],
  ['СП-07', 'СП-09', 'Допустимый результат и накопленная история ремонтов определяют продолжение цепочки.'],
  ['СП-09', 'СП-11', 'Исправление цепочки не должно уничтожать фактическую историю контроля.'],
  ['СП-10', 'СП-11', 'Изменение назначения или цикла ПСТО/ТВМТ должно сохранять выполненную работу и её документы.'],
]

export function getRuleConnections(code: string) {
  return RULE_CONNECTIONS.flatMap(([left, right, explanation]) => {
    const reference = getRuleSettingsReference(left === code ? right : right === code ? left : '')
    return reference ? [{ ...reference, explanation }] : []
  })
}
