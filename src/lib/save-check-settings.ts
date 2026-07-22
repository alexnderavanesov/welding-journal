import { useEffect, useState } from 'react'
import { loadOtherSettings } from '@/lib/other-settings'

export const SAVE_CHECK_SETTINGS_EVENT = 'save-check-settings-change'

const SAVE_CHECK_SETTINGS_STORAGE_KEY = 'welding-save-check-settings'

export type SaveCheckSettingId =
  | 'officialRegistry'
  | 'officialArchive'
  | 'officialNaksDate'
  | 'officialSuspension'
  | 'officialWeldingMethod'
  | 'officialMaterialGroup'
  | 'officialDiameter'
  | 'officialThickness'
  | 'officialDls'
  | 'requiredRootStampWithWeldDate'
  | 'dateFormat'
  | 'weldDateNotFuture'
  | 'lnkResultControlDateRequired'
  | 'lnkResultControlDateFormat'
  | 'lnkResultDateAfterWeldDate'
  | 'lnkResultRequestDateOrder'
  | 'lnkResultVikDateBeforeOther'
  | 'lnkResultVikRequiredBeforeOther'
  | 'lnkResultConclusionRequired'
  | 'lnkResultRepairRules'
  | 'pstoResultDateRequired'
  | 'pstoResultDateFormat'
  | 'pstoResultDateAfterWeldDate'
  | 'pstoResultRequestDateOrder'
  | 'pstoResultDiagramRequired'
  | 'manualJointName'
  | 'controlHistoryProtection'
  | 'systemJointRenameProtection'

export type SaveCheckSettings = Record<SaveCheckSettingId, boolean>

export type SaveCheckSettingItem = {
  id: SaveCheckSettingId
  label: string
  description: string
  example: string
}

export type SaveCheckSettingGroup = {
  id: string
  title: string
  description: string
  items: SaveCheckSettingItem[]
}

export const SAVE_CHECK_SETTING_CODES: Record<SaveCheckSettingId, string> = {
  officialRegistry: 'ЗВ-01',
  officialArchive: 'ЗВ-02',
  officialNaksDate: 'ЗВ-03',
  officialSuspension: 'ЗВ-04',
  officialWeldingMethod: 'ЗВ-05',
  officialMaterialGroup: 'ЗВ-06',
  officialDiameter: 'ЗВ-07',
  officialThickness: 'ЗВ-08',
  officialDls: 'ЗВ-09',
  requiredRootStampWithWeldDate: 'ЗВ-10',
  dateFormat: 'ЗВ-11',
  weldDateNotFuture: 'ЗВ-12',
  lnkResultControlDateRequired: 'ЗВ-13',
  lnkResultControlDateFormat: 'ЗВ-14',
  lnkResultDateAfterWeldDate: 'ЗВ-15',
  lnkResultRequestDateOrder: 'ЗВ-16',
  lnkResultVikDateBeforeOther: 'ЗВ-17',
  lnkResultVikRequiredBeforeOther: 'ЗВ-18',
  lnkResultConclusionRequired: 'ЗВ-19',
  lnkResultRepairRules: 'ЗВ-20',
  pstoResultDateRequired: 'ЗВ-21',
  pstoResultDateFormat: 'ЗВ-22',
  pstoResultDateAfterWeldDate: 'ЗВ-23',
  pstoResultRequestDateOrder: 'ЗВ-24',
  pstoResultDiagramRequired: 'ЗВ-25',
  manualJointName: 'ЗВ-26',
  controlHistoryProtection: 'ЗВ-27',
  systemJointRenameProtection: 'ЗВ-28',
}

const SAVE_CHECK_REASON_CODE_PATTERN = /^ЗВ-\d+\s·\s/

const OFFICIAL_STAMP_SAVE_CHECK_ITEMS: SaveCheckSettingItem[] = [
  {
    id: 'officialRegistry',
    label: 'Реестр клейм',
    description: 'Официальное клеймо должно быть заведено в справочнике клейм.',
    example: 'Если в Корень_1 указано ABC1, но ABC1 нет в справочнике, стык нельзя сохранить.',
  },
  {
    id: 'officialArchive',
    label: 'Архив клейм',
    description: 'Запрещает сохранить новый или отредактированный стык, если в официальном поле выбрано архивное клеймо.',
    example: 'Архивное клеймо можно видеть в выпадающем списке, если включена настройка “Учитывать архив клейм в форме стыка”, но эта проверка не даст случайно использовать его как действующее.',
  },
  {
    id: 'officialNaksDate',
    label: 'Срок НАКС',
    description: 'Дата сварки должна попадать в срок действия НАКС.',
    example: 'Если дата сварки позже срока НАКС, сохранение будет заблокировано.',
  },
  {
    id: 'officialSuspension',
    label: 'Отстранения',
    description: 'Дата сварки не должна попадать в период отстранения сварщика.',
    example: 'Если сварщик отстранен с 10.07 по 20.07, стык от 15.07 сохранить нельзя.',
  },
  {
    id: 'officialWeldingMethod',
    label: 'Способ сварки',
    description: 'Официальные клейма должны покрывать выбранный способ сварки.',
    example: 'РАД+РД может быть закрыт командой сварщиков, если вместе они покрывают оба способа.',
  },
  {
    id: 'officialMaterialGroup',
    label: 'Группа материалов',
    description: 'Каждое официальное клеймо должно иметь допуск на группу материалов стыка.',
    example: 'Если стык M01, то каждый официальный сварщик в стыке должен иметь M01.',
  },
  {
    id: 'officialDiameter',
    label: 'Диаметры D1/D2',
    description: 'Оба диаметра стыка должны попадать в диапазон НАКС.',
    example: 'Если у НАКС D до 100, а в стыке D2 = 144, сохранить нельзя.',
  },
  {
    id: 'officialThickness',
    label: 'Толщины T1/T2',
    description: 'Обе толщины стыка должны попадать в диапазон НАКС.',
    example: 'Если у НАКС T до 8, а в стыке T2 = 10, сохранить нельзя.',
  },
  {
    id: 'officialDls',
    label: 'Требовать подходящий ДЛС',
    description: 'Каждое официальное клеймо должно иметь ДЛС по способу, группе материалов, D, T и дате.',
    example: 'Если у ДЛС T до 8, а в стыке T2 = 10, сохранить нельзя.',
  },
]

const FORM_SAVE_CHECK_ITEMS: SaveCheckSettingItem[] = [
  {
    id: 'requiredRootStampWithWeldDate',
    label: 'Корень при дате сварки',
    description: 'Если указана дата сварки, должен быть заполнен хотя бы Корень_1.',
    example: 'Дата сварки стоит, а Корень_1 пустой: система попросит указать корневое клеймо.',
  },
  {
    id: 'dateFormat',
    label: 'Формат дат',
    description: 'Все даты в форме должны быть реальными датами в понятном формате.',
    example: '31.02.2026 или текст вместо даты не дадут сохранить стык.',
  },
  {
    id: 'weldDateNotFuture',
    label: 'Дата сварки не в будущем',
    description: 'Дата сварки не может быть позже сегодняшней даты.',
    example: 'Сегодня 17.07.2026, дата сварки 20.07.2026: сохранение будет заблокировано.',
  },
]

const LNK_RESULT_SAVE_CHECK_ITEMS: SaveCheckSettingItem[] = [
  {
    id: 'lnkResultControlDateRequired',
    label: 'Дата контроля обязательна',
    description: 'Если в ЛНК вводится фактический результат, должна быть указана дата контроля.',
    example: 'По РК выбран результат “годен”, но дата контроля пустая: система попросит заполнить дату.',
  },
  {
    id: 'lnkResultControlDateFormat',
    label: 'Формат даты контроля',
    description: 'Дата контроля должна быть реальной датой в понятном формате.',
    example: '31.02.2026 или произвольный текст в дате контроля будут заблокированы.',
  },
  {
    id: 'lnkResultDateAfterWeldDate',
    label: 'Дата контроля не раньше сварки',
    description: 'Дата контроля ЛНК не должна быть раньше даты сварки выбранного стыка.',
    example: 'Стык сварен 03.07.2026, а дата РК 01.07.2026: сохранение результата будет заблокировано.',
  },
  {
    id: 'lnkResultRequestDateOrder',
    label: 'Даты сварки, заявки и заключения',
    description: 'Проверяет порядок дат: дата сварки должна быть не позже даты заявки, а дата заявки не позже даты заключения.',
    example: 'Стык сварен 01.07, заявка РК от 08.07, а заключение РК от 05.07: сохранить такое заключение нельзя.',
  },
  {
    id: 'lnkResultVikDateBeforeOther',
    label: 'ВИК раньше остальных НК',
    description: 'Дата заключения ВИК должна быть не позже даты заключения любого другого вида ЛНК.',
    example: 'ВИК от 10.07, а РК от 09.07: система попросит исправить даты, потому что сначала выполняется ВИК.',
  },
  {
    id: 'lnkResultVikRequiredBeforeOther',
    label: 'ВИК обязателен перед другими НК',
    description: 'Не дает сохранить результат другого вида НК, если по стыку еще нет результата ВИК.',
    example: 'Пользователь пытается сохранить РК “годен”, но ВИК по стыку еще не заполнен: сохранение будет заблокировано.',
  },
  {
    id: 'lnkResultConclusionRequired',
    label: 'Заключение обязательно',
    description: 'Если вводится фактический результат ЛНК, должно быть указано наименование заключения.',
    example: 'Результат ВИК “годен” без номера/имени заключения сохранить нельзя.',
  },
  {
    id: 'lnkResultRepairRules',
    label: 'Правила ремонта',
    description: 'Не дает выбрать или оставить результат “ремонт”, если по стыку ремонт недоступен.',
    example: 'Для диаметра до 89 мм ремонт недоступен: в результате ЛНК нужно выбрать другой статус, а в карточке стыка нельзя сохранить D1/D2, которые делают уже внесенный ремонт недопустимым.',
  },
]

const PSTO_RESULT_SAVE_CHECK_ITEMS: SaveCheckSettingItem[] = [
  {
    id: 'pstoResultDateRequired',
    label: 'Дата ПСТО обязательна',
    description: 'Если вводится результат ПСТО, должна быть указана дата ПСТО.',
    example: 'Выбран результат “проведено”, но дата ПСТО пустая: система попросит заполнить дату.',
  },
  {
    id: 'pstoResultDateFormat',
    label: 'Формат даты ПСТО',
    description: 'Дата ПСТО должна быть реальной датой в понятном формате.',
    example: '31.02.2026 или произвольный текст в дате ПСТО будут заблокированы.',
  },
  {
    id: 'pstoResultDateAfterWeldDate',
    label: 'Дата ПСТО не раньше сварки',
    description: 'Дата результата ПСТО не должна быть раньше даты сварки выбранного стыка.',
    example: 'Стык сварен 04.07.2026, а ПСТО указано 01.07.2026: результат сохранить нельзя.',
  },
  {
    id: 'pstoResultRequestDateOrder',
    label: 'Даты сварки, заявки и результата ПСТО',
    description: 'Проверяет порядок дат: дата сварки должна быть не позже даты заявки ПСТО, а дата заявки - не позже даты результата ПСТО.',
    example: 'Заявка ПСТО от 08.07, а результат ПСТО от 05.07: сохранить такой результат нельзя.',
  },
  {
    id: 'pstoResultDiagramRequired',
    label: 'Диаграмма обязательна',
    description: 'Если вводится результат ПСТО, должно быть указано имя или номер диаграммы термообработки.',
    example: 'Результат ПСТО “проведено” без диаграммы сохранить нельзя.',
  },
]

const DANGEROUS_FORM_SAVE_CHECK_ITEMS: SaveCheckSettingItem[] = [
  {
    id: 'manualJointName',
    label: 'Имя обычного стыка',
    description: 'Проверяет имя стыка, которое пользователь вводит вручную: оно должно начинаться с базовой буквы стыка и не должно выглядеть как системный ремонт, вырез, катушка, официальный или неофициальный повтор.',
    example: 'Обычный новый стык можно назвать S13 или F5A. А имя вроде F1R1, F1W1 или F1Y1 лучше создавать через диспетчер/цепочку, потому что R/W/Y имеют системный смысл.',
  },
  {
    id: 'controlHistoryProtection',
    label: 'Защита истории ЛНК/ПСТО',
    description: 'Не дает снять назначение контроля через “пусто”, если по стыку уже есть результат, дата или заключение.',
    example: 'В РК есть заключение и результат, а пользователь меняет назначение РК на пусто: система попросит выбрать “отменен” или очистить результат в отчете.',
  },
  {
    id: 'systemJointRenameProtection',
    label: 'Имена R/W/Y/S/F',
    description: 'Запрещает вручную переименовывать стыки с системными индексами ремонта, выреза, катушки, официальности и неофициальности.',
    example: 'F1R1 нельзя вручную превратить в F1W1. Если заказчик ведет свою нумерацию и цепочки не нужны, эту защиту можно отключить осознанно.',
  },
]

export const SAVE_CHECK_SETTING_GROUPS: SaveCheckSettingGroup[] = [
  {
    id: 'official-stamps',
    title: 'Официальные клейма в форме стыка',
    description:
      'Проверяются только официальные поля клейм: Корень_1, Заполнение_1, Облицовка_1 и второй комплект. Фактические клейма этими правилами не блокируются.',
    items: OFFICIAL_STAMP_SAVE_CHECK_ITEMS,
  },
  {
    id: 'weld-form',
    title: 'Неопасные проверки формы стыка',
    description:
      'Это рабочие проверки ввода: даты и корневое клеймо при заполненной сварке. Они не меняют цепочки, заявки, результаты и системную логику.',
    items: FORM_SAVE_CHECK_ITEMS,
  },
  {
    id: 'lnk-result-form',
    title: 'Результаты ЛНК',
    description:
      'Эти проверки работают при вводе и редактировании результатов ЛНК. Если их отключить, данные можно сохранить, но диспетчер все равно сможет показать диагностическую задачу по уже сохраненной ошибке, если такой тип задач включен.',
    items: LNK_RESULT_SAVE_CHECK_ITEMS,
  },
  {
    id: 'psto-result-form',
    title: 'Результаты ПСТО',
    description:
      'Эти проверки работают при создании заявки ПСТО и вводе результата ПСТО. Если их отключить, данные можно сохранить, но диспетчер сможет показать диагностическую задачу по уже сохраненной ошибке, если такой тип задач включен.',
    items: PSTO_RESULT_SAVE_CHECK_ITEMS,
  },
  {
    id: 'dangerous-weld-form',
    title: 'Опасные проверки формы стыка',
    description:
      'Эти проверки защищают ручное имя стыка, историю контроля и системную логику имен стыков. Отключайте их только для проектов, где заказчик сам ведет нумерацию, контроль и связанные документы, а система используется почти как один сварочный журнал.',
    items: DANGEROUS_FORM_SAVE_CHECK_ITEMS,
  },
]

export const SAVE_CHECK_SETTING_ITEMS: SaveCheckSettingItem[] = SAVE_CHECK_SETTING_GROUPS.flatMap((group) => group.items)

export const DEFAULT_SAVE_CHECK_SETTINGS: SaveCheckSettings = {
  officialRegistry: true,
  officialArchive: true,
  officialNaksDate: true,
  officialSuspension: true,
  officialWeldingMethod: true,
  officialMaterialGroup: true,
  officialDiameter: true,
  officialThickness: true,
  officialDls: false,
  requiredRootStampWithWeldDate: true,
  dateFormat: true,
  weldDateNotFuture: true,
  lnkResultControlDateRequired: true,
  lnkResultControlDateFormat: true,
  lnkResultDateAfterWeldDate: true,
  lnkResultRequestDateOrder: true,
  lnkResultVikDateBeforeOther: true,
  lnkResultVikRequiredBeforeOther: true,
  lnkResultConclusionRequired: true,
  lnkResultRepairRules: true,
  pstoResultDateRequired: true,
  pstoResultDateFormat: true,
  pstoResultDateAfterWeldDate: true,
  pstoResultRequestDateOrder: true,
  pstoResultDiagramRequired: true,
  manualJointName: true,
  controlHistoryProtection: true,
  systemJointRenameProtection: true,
}

export function useSaveCheckSettings() {
  const [settings, setSettings] = useState<SaveCheckSettings>(() => loadSaveCheckSettings())

  useEffect(() => {
    const syncSettings = () => setSettings(loadSaveCheckSettings())
    window.addEventListener(SAVE_CHECK_SETTINGS_EVENT, syncSettings)
    window.addEventListener('storage', syncSettings)
    return () => {
      window.removeEventListener(SAVE_CHECK_SETTINGS_EVENT, syncSettings)
      window.removeEventListener('storage', syncSettings)
    }
  }, [])

  return settings
}

export function loadSaveCheckSettings(): SaveCheckSettings {
  if (typeof window === 'undefined') return DEFAULT_SAVE_CHECK_SETTINGS

  try {
    const rawValue = window.localStorage.getItem(SAVE_CHECK_SETTINGS_STORAGE_KEY)
    if (!rawValue) return { ...DEFAULT_SAVE_CHECK_SETTINGS, officialDls: loadOtherSettings().requireDlsForOfficialStamps }
    return normalizeSaveCheckSettings(JSON.parse(rawValue))
  } catch {
    return { ...DEFAULT_SAVE_CHECK_SETTINGS, officialDls: loadOtherSettings().requireDlsForOfficialStamps }
  }
}

export function saveSaveCheckSettings(settings: SaveCheckSettings) {
  if (typeof window === 'undefined') return
  const normalizedSettings = normalizeSaveCheckSettings(settings)
  window.localStorage.setItem(SAVE_CHECK_SETTINGS_STORAGE_KEY, JSON.stringify(normalizedSettings))
  window.dispatchEvent(new Event(SAVE_CHECK_SETTINGS_EVENT))
}

export function normalizeSaveCheckSettings(value: unknown): SaveCheckSettings {
  const source = typeof value === 'object' && value ? (value as Partial<Record<SaveCheckSettingId, unknown>>) : {}
  return Object.fromEntries(
    Object.entries(DEFAULT_SAVE_CHECK_SETTINGS).map(([id, defaultValue]) => {
      const key = id as SaveCheckSettingId
      const fallback = key === 'officialDls' ? loadOtherSettings().requireDlsForOfficialStamps : defaultValue
      return [key, typeof source[key] === 'boolean' ? source[key] : fallback]
    }),
  ) as SaveCheckSettings
}

export function getSaveCheckSettingCode(id: SaveCheckSettingId) {
  return SAVE_CHECK_SETTING_CODES[id]
}

export function formatSaveCheckBlockReason(id: SaveCheckSettingId, message: string) {
  if (!message) return message
  if (SAVE_CHECK_REASON_CODE_PATTERN.test(message)) return message
  return `${getSaveCheckSettingCode(id)} · ${message}`
}
