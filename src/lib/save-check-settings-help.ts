import { SAVE_CHECK_SETTING_CODES, SAVE_CHECK_SETTING_ITEMS, type SaveCheckSettingId } from './save-check-settings'
import { getSystemRule } from './system-rule-catalog'

export type SaveCheckSettingHelp = { meaning: string; example: string }

// The only switchable guards are described by their visible catalog. Legacy
// policy ids resolve to the same mandatory rule as validation, never stale help.
export const SAVE_CHECK_SETTING_HELP = Object.fromEntries(
  Object.entries(SAVE_CHECK_SETTING_CODES).map(([id, code]) => {
    const item = SAVE_CHECK_SETTING_ITEMS.find(item => item.id === id)
    const rule = getSystemRule(code)
    return [id, {
      meaning: item?.description ?? (rule ? `${rule.effect} ${rule.correction}` : 'Заполненная дата должна существовать в календаре и быть не раньше 01.01.2024.'),
      example: item?.example ?? rule?.examples[0] ?? '31.02.2026 сохранить нельзя.',
    }]
  }),
) as Record<SaveCheckSettingId, SaveCheckSettingHelp>
