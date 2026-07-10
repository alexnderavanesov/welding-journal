import { useEffect, useState } from 'react'
import { REPAIR_FORBIDDEN_BY_DIAMETER_REASON, UNOFFICIAL_REJECTED_WITH_COIL_REASON } from '@/lib/report-config'
import type { DispatcherTask } from '@/lib/dispatcher-types'

export const DISPATCHER_SETTINGS_EVENT = 'dispatcher-settings-change'

const DISPATCHER_SETTINGS_STORAGE_KEY = 'welding-dispatcher-settings'

export type DispatcherSettingId =
  | 'percentage-missing'
  | 'percentage-full-control'
  | 'percentage-excess'
  | 'percentage-new-welder'
  | 'percentage-rejected-primary'
  | 'percentage-suspend-welder'
  | 'repeated-create'
  | 'repeated-create-official-from-unofficial'
  | 'repeated-coil'
  | 'repeated-delete'
  | 'repeated-rename'
  | 'repeated-obsolete-check'
  | 'chain-consistency'
  | 'chain-duplicate'
  | 'chain-date-order'
  | 'check-control-before-weld'
  | 'check-repair-diameter'
  | 'check-welder-stamp'
  | 'check-incomplete-stamps'
  | 'line-percent'
  | 'line-group'
  | 'line-category'
  | 'line-control-presence'
  | 'welder-stamp-expiry'

export type DispatcherSettings = Record<DispatcherSettingId, boolean>

export type DispatcherSettingItem = {
  id: DispatcherSettingId
  label: string
  description: string
}

export type DispatcherSettingGroup = {
  id: string
  title: string
  description: string
  items: DispatcherSettingItem[]
}

export const DISPATCHER_SETTING_GROUPS: DispatcherSettingGroup[] = [
  {
    id: 'percentage-lines',
    title: 'Процентные линии',
    description: 'Задачи по добору РК/УЗК, лишнему контролю, официальности и отстранению сварщиков.',
    items: [
      {
        id: 'percentage-new-welder',
        label: 'Новый сварщик на процентной линии',
        description: 'Показывать предупреждение при появлении нового официального клейма на процентной линии.',
      },
      {
        id: 'percentage-excess',
        label: 'Лишний контроль',
        description: 'Показывать задачи, когда обычного РК/УЗК назначено больше расчетного процента.',
      },
      {
        id: 'percentage-rejected-primary',
        label: 'Проверить официальность',
        description: 'Показывать задачи по негодным первичным РК/УЗК и дубль-контролю на процентных линиях.',
      },
      {
        id: 'percentage-missing',
        label: 'Назначить РК/УЗК',
        description: 'Показывать задачи по недостающему расчетному РК/УЗК.',
      },
      {
        id: 'percentage-full-control',
        label: 'Назначить 100% РК/УЗК',
        description: 'Показывать задачи 100% контроля после четвертого первичного негодного РК/УЗК.',
      },
      {
        id: 'percentage-suspend-welder',
        label: 'Отстранить сварщика',
        description: 'Показывать задачу отстранения сварщика после четвертого первичного негодного РК/УЗК.',
      },
    ],
  },
  {
    id: 'joint-chains',
    title: 'Цепочки стыков',
    description: 'Создание, переименование и проверка повторных стыков с системными индексами.',
    items: [
      {
        id: 'repeated-create',
        label: 'Создать ремонт/вырез',
        description: 'Показывать задачи создания следующего ремонтного или вырезного стыка после негодного результата.',
      },
      {
        id: 'repeated-create-official-from-unofficial',
        label: 'Создать официальный после неофициального',
        description: 'Показывать задачи создания официального стыка с тем же номером после неофициального негодного стыка.',
      },
      {
        id: 'repeated-coil',
        label: 'Создать катушку',
        description: 'Показывать задачи создания двух стыков катушки при требовании катушки.',
      },
      {
        id: 'repeated-delete',
        label: 'Удалить лишний повторный стык',
        description: 'Показывать задачи удаления незаполненных повторных стыков, которые больше не нужны.',
      },
      {
        id: 'repeated-rename',
        label: 'Переименовать стык цепочки',
        description: 'Показывать задачи переименования повторных стыков по текущей логике цепочки.',
      },
      {
        id: 'repeated-obsolete-check',
        label: 'Проверить лишний заполненный стык',
        description: 'Показывать ручную проверку повторных стыков, которые уже содержат данные.',
      },
      {
        id: 'chain-consistency',
        label: 'Проверить целостность цепочки',
        description: 'Показывать проверки разрывов цепочки, катушек, неофициальных финалов и лишних веток.',
      },
      {
        id: 'chain-duplicate',
        label: 'Проверить дубли стыков',
        description: 'Показывать задачи по возможным дублям стыков в одной цепочке.',
      },
      {
        id: 'chain-date-order',
        label: 'Проверить порядок дат сварки',
        description: 'Показывать задачи, когда даты сварки в цепочке идут не по порядку.',
      },
    ],
  },
  {
    id: 'data-quality',
    title: 'Проверки данных',
    description: 'Проверки дат, клейм, совместимости и заполненности обязательных полей.',
    items: [
      {
        id: 'check-control-before-weld',
        label: 'Дата контроля раньше сварки',
        description: 'Показывать задачи, когда дата ЛНК/ПСТО раньше даты сварки.',
      },
      {
        id: 'check-repair-diameter',
        label: 'Ремонт запрещен диаметром',
        description: 'Показывать задачи, когда ремонт указан на малом диаметре.',
      },
      {
        id: 'check-welder-stamp',
        label: 'Проверить клеймо',
        description: 'Показывать задачи по НАКС, типу сварки, диаметру, сроку действия и отстранению.',
      },
      {
        id: 'check-incomplete-stamps',
        label: 'Дозаполнить клейма/дату сварки',
        description: 'Показывать задачи неполного заполнения клейм или даты сварки.',
      },
    ],
  },
  {
    id: 'line-consistency',
    title: 'Согласованность линий',
    description: 'Проверки единых параметров внутри одной линии.',
    items: [
      {
        id: 'line-percent',
        label: 'Проверить % контроля линии',
        description: 'Показывать задачи разных значений процента контроля на одной линии.',
      },
      {
        id: 'line-group',
        label: 'Проверить группу линии',
        description: 'Показывать задачи разных групп на одной линии.',
      },
      {
        id: 'line-category',
        label: 'Проверить категорию линии',
        description: 'Показывать задачи разных категорий на одной линии.',
      },
      {
        id: 'line-control-presence',
        label: 'Проверить назначение контроля линии',
        description: 'Показывать задачи разных наборов назначенного контроля на 100% линии.',
      },
    ],
  },
  {
    id: 'reminders',
    title: 'Напоминания',
    description: 'Напоминания, которые показываются в связанных рабочих разделах.',
    items: [
      {
        id: 'welder-stamp-expiry',
        label: 'Срок действия НАКС',
        description: 'Показывать напоминания в разделе «Клейма» о подходящем или истекшем сроке действия НАКС.',
      },
    ],
  },
]

export const DISPATCHER_SETTING_HELP: Record<DispatcherSettingId, { meaning: string; example: string }> = {
  'percentage-new-welder': {
    meaning: 'Следит, что на процентной линии появилось новое официальное клеймо, а значит расчет РК/УЗК по проценту начинается отдельно для этого сварщика.',
    example: 'На линии 10% раньше варил A1, а затем появился B2. Диспетчер попросит проверить, действительно ли B2 официально участвует в этой линии.',
  },
  'percentage-excess': {
    meaning: 'Находит обычный контроль со статусом "да", который превышает расчетный объем процентной линии.',
    example: 'По расчету нужно 2 стыка РК/УЗК, а обычным "да" назначено 4. Лишние стыки можно перевести в "дополнительный" или исправить назначение.',
  },
  'percentage-rejected-primary': {
    meaning: 'Показывает негодные первичные официальные РК/УЗК, потому что они увеличивают добор и могут менять расчет по клейму.',
    example: 'Первичный официальный стык F12 дал "вырез" по РК. Диспетчер попросит проверить официальность, чтобы добор считался только по реальным официальным стыкам.',
  },
  'percentage-missing': {
    meaning: 'Находит недостающие назначения РК/УЗК по процентной линии и предлагает доступных кандидатов.',
    example: 'По клейму нужно закрыть 3 стыка РК/УЗК, закрыт только 1. Диспетчер покажет задачу назначить еще 2 стыка.',
  },
  'percentage-full-control': {
    meaning: 'Включает задачу 100% РК/УЗК по клейму после четвертого первичного негодного РК/УЗК.',
    example: 'У сварщика A1 накопилось 4 первичных негодных РК/УЗК. Новые и уже сваренные стыки этого клейма должны попасть под 100% контроль.',
  },
  'percentage-suspend-welder': {
    meaning: 'Напоминает оформить отстранение сварщика после четвертого первичного негодного результата на процентной линии.',
    example: 'После четвертого выреза по РК диспетчер предложит открыть клеймо и внести период отстранения с даты контроля.',
  },
  'repeated-create': {
    meaning: 'Создает задачу на следующий ремонтный или вырезной стык, когда исходный официальный стык получил негодный результат.',
    example: 'Исходный официальный стык получил "ремонт" по УЗК, а следующего ремонтного стыка еще нет в журнале. Диспетчер предложит создать его по текущему системному индексу.',
  },
  'repeated-create-official-from-unofficial': {
    meaning: 'Создает задачу на официальный стык с тем же номером, когда исходный стык неофициальный и получил негодный результат контроля.',
    example: 'Неофициальный стык получил "вырез". Диспетчер предложит создать официальный стык с тем же номером без системного индекса цепочки.',
  },
  'repeated-coil': {
    meaning: 'Создает задачу на пару стыков катушки, когда по правилам цепочки ремонт дальше недопустим и нужен вырез участка.',
    example: 'После нескольких негодных официальных стыков цепочка должна перейти к катушке. Диспетчер предложит создать два стыка катушки с текущим системным индексом.',
  },
  'repeated-delete': {
    meaning: 'Находит пустой повторный стык, который больше не соответствует текущему результату исходного стыка.',
    example: 'Раньше был вырез и создан повторный стык, но результат исходного стыка изменили на годен. Пустой повторный стык можно удалить.',
  },
  'repeated-rename': {
    meaning: 'Показывает, что имя повторного стыка больше не соответствует текущей цепочке и его нужно переименовать.',
    example: 'Был стык выреза, но результат исходного стыка поменяли с выреза на ремонт. Диспетчер предложит имя по текущему ремонтному индексу.',
  },
  'repeated-obsolete-check': {
    meaning: 'Просит вручную проверить лишний повторный стык, который уже содержит данные и не может быть удален автоматически.',
    example: 'Повторный стык больше не нужен по расчету, но у него заполнена дата сварки. Диспетчер не удаляет его сам и просит проверить цепочку.',
  },
  'chain-consistency': {
    meaning: 'Проверяет целостность цепочек с системными индексами: разрывы, лишние ветки, катушки, неофициальные финалы и продолжение после годного стыка.',
    example: 'В журнале есть второй ремонтный шаг, но нет первого, или после годного финала появилась новая ветка. Диспетчер покажет проверку цепочки.',
  },
  'chain-duplicate': {
    meaning: 'Находит несколько строк, которые выглядят как один и тот же стык в рамках проекта, шифра, линии и цепочки.',
    example: 'В одной линии два раза встречается F12 с одинаковой идентичностью. Диспетчер попросит проверить дубль.',
  },
  'chain-date-order': {
    meaning: 'Проверяет, что даты сварки в цепочке идут последовательно от исходного стыка к последующим системным шагам.',
    example: 'Повторный стык сварен 05.07, а исходный указан 07.07. Диспетчер покажет задачу проверить порядок дат.',
  },
  'check-control-before-weld': {
    meaning: 'Находит контроль ЛНК или ПСТО, дата которого раньше даты сварки стыка.',
    example: 'Стык сварен 10.07, а заключение РК датировано 09.07. Нужно исправить дату сварки или дату контроля.',
  },
  'check-repair-diameter': {
    meaning: 'Показывает задачу, если результат "ремонт" указан для малого диаметра, где ремонт запрещен.',
    example: 'Для D57 по РК выбран "ремонт". По правилу малого диаметра должен быть вырез, поэтому диспетчер попросит проверить результат.',
  },
  'check-welder-stamp': {
    meaning: 'Проверяет официальные клейма по реестру: НАКС, тип сварки, диаметр, срок действия и отстранения.',
    example: 'Дата сварки попала в период отстранения клейма или диаметр стыка вне допуска. Диспетчер покажет задачу "Проверить клеймо".',
  },
  'check-incomplete-stamps': {
    meaning: 'Следит, чтобы дата сварки и группы фактических клейм были заполнены согласованно.',
    example: 'Дата сварки заполнена, но клейма пустые, или в группе клейма_1 заполнен только корень без заполнения и облицовки.',
  },
  'line-percent': {
    meaning: 'Проверяет, что у всех стыков одной линии одинаковое значение процента контроля.',
    example: 'На линии LIN-1 у части стыков 10%, а у части 25%. Диспетчер попросит привести линию к одному значению.',
  },
  'line-group': {
    meaning: 'Проверяет единое значение группы для всех стыков одной линии.',
    example: 'В одной линии часть строк относится к группе B, часть к группе C. Диспетчер покажет проверку группы.',
  },
  'line-category': {
    meaning: 'Проверяет единое значение категории для всех стыков одной линии.',
    example: 'Для LIN-1 у одних стыков категория I, у других II. Нужно проверить импорт или ручной ввод.',
  },
  'line-control-presence': {
    meaning: 'На 100% линиях проверяет, что набор назначенных видов контроля одинаков внутри линии.',
    example: 'На одной 100% линии часть стыков имеет ВИК+РК, а часть только ВИК. Диспетчер попросит проверить назначение контроля.',
  },
  'welder-stamp-expiry': {
    meaning: 'Показывает в разделе "Клейма" напоминания о НАКС, срок которого скоро истечет или уже истек.',
    example: 'У клейма A1 срок действия до 15.07. Диспетчер заранее покажет напоминание, чтобы продлить или архивировать запись.',
  },
}

export const DEFAULT_DISPATCHER_SETTINGS: DispatcherSettings = Object.fromEntries(
  DISPATCHER_SETTING_GROUPS.flatMap((group) => group.items.map((item) => [item.id, true])),
) as DispatcherSettings

export function useDispatcherSettings() {
  const [settings, setSettings] = useState<DispatcherSettings>(() => loadDispatcherSettings())

  useEffect(() => {
    const syncSettings = () => setSettings(loadDispatcherSettings())
    window.addEventListener(DISPATCHER_SETTINGS_EVENT, syncSettings)
    window.addEventListener('storage', syncSettings)
    return () => {
      window.removeEventListener(DISPATCHER_SETTINGS_EVENT, syncSettings)
      window.removeEventListener('storage', syncSettings)
    }
  }, [])

  return settings
}

export function loadDispatcherSettings(): DispatcherSettings {
  if (typeof window === 'undefined') return DEFAULT_DISPATCHER_SETTINGS

  try {
    const rawValue = window.localStorage.getItem(DISPATCHER_SETTINGS_STORAGE_KEY)
    if (!rawValue) return DEFAULT_DISPATCHER_SETTINGS
    return normalizeDispatcherSettings(JSON.parse(rawValue))
  } catch {
    return DEFAULT_DISPATCHER_SETTINGS
  }
}

export function saveDispatcherSettings(settings: DispatcherSettings) {
  if (typeof window === 'undefined') return
  const normalizedSettings = normalizeDispatcherSettings(settings)
  window.localStorage.setItem(DISPATCHER_SETTINGS_STORAGE_KEY, JSON.stringify(normalizedSettings))
  window.dispatchEvent(new Event(DISPATCHER_SETTINGS_EVENT))
}

export function isDispatcherTaskEnabled(task: DispatcherTask, settings: DispatcherSettings) {
  return settings[getDispatcherTaskSettingId(task)] !== false
}

function normalizeDispatcherSettings(value: unknown): DispatcherSettings {
  const source = typeof value === 'object' && value ? (value as Partial<Record<DispatcherSettingId, unknown>>) : {}
  return Object.fromEntries(
    Object.entries(DEFAULT_DISPATCHER_SETTINGS).map(([id, defaultValue]) => [id, typeof source[id as DispatcherSettingId] === 'boolean' ? source[id as DispatcherSettingId] : defaultValue]),
  ) as DispatcherSettings
}

function getDispatcherTaskSettingId(task: DispatcherTask): DispatcherSettingId {
  if (task.kind === 'welder-stamp-expiry') return 'welder-stamp-expiry'
  if (task.kind === 'create') return String(task.row.status ?? '').trim().toLowerCase() === 'неофициальный' ? 'repeated-create-official-from-unofficial' : 'repeated-create'
  if (task.kind === 'coil') return 'repeated-coil'
  if (task.kind === 'delete') return 'repeated-delete'
  if (task.kind === 'rename') return 'repeated-rename'
  if (task.kind === 'duplicate-check') return 'chain-duplicate'
  if (task.kind === 'line-consistency') return getLineConsistencySettingId(task.fieldKey)
  if (task.kind === 'percentage-line-control') return getPercentageLineSettingId(task)
  return getCheckTaskSettingId(task.reason)
}

function getLineConsistencySettingId(fieldKey: 'weldControlPercent' | 'groupName' | 'category' | 'controlPresence') {
  if (fieldKey === 'weldControlPercent') return 'line-percent'
  if (fieldKey === 'groupName') return 'line-group'
  if (fieldKey === 'category') return 'line-category'
  return 'line-control-presence'
}

function getPercentageLineSettingId(task: Extract<DispatcherTask, { kind: 'percentage-line-control' }>): DispatcherSettingId {
  if (task.issue === 'new-welder') return 'percentage-new-welder'
  if (task.issue === 'excess') return 'percentage-excess'
  if (task.issue === 'rejected-primary') return 'percentage-rejected-primary'
  if (task.issue === 'suspend-welder') return 'percentage-suspend-welder'
  if (task.issue === 'missing' && task.title.includes('100%')) return 'percentage-full-control'
  return 'percentage-missing'
}

function getCheckTaskSettingId(reason?: string): DispatcherSettingId {
  if (reason === 'проверить дату сварки и контроля') return 'check-control-before-weld'
  if (reason === 'проверить даты сварки') return 'chain-date-order'
  if (reason === REPAIR_FORBIDDEN_BY_DIAMETER_REASON) return 'check-repair-diameter'
  if (reason === 'проверить клеймо') return 'check-welder-stamp'
  if (isIncompleteWeldStampGroupReason(reason)) return 'check-incomplete-stamps'
  if (reason === 'повторный стык уже заварен' || reason === 'повторный стык содержит данные') return 'repeated-obsolete-check'
  if (reason === UNOFFICIAL_REJECTED_WITH_COIL_REASON) return 'chain-consistency'
  return 'chain-consistency'
}

function isIncompleteWeldStampGroupReason(reason?: string) {
  return reason === 'дозаполнить клейма_1' || reason === 'дозаполнить клейма_2' || reason === 'дозаполнить дату сварки'
}
