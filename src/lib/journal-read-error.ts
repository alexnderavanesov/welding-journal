export const JOURNAL_CHANGED_MESSAGE = 'Данные журнала изменились. Обновите таблицу и повторите действие.'

export function isJournalRevisionError(error: unknown) {
  return error instanceof Error && error.message === JOURNAL_CHANGED_MESSAGE
}

/** Keep actionable messages, but never display SQL/stack traces in the grid. */
export function journalReadErrorMessage(error: unknown, fallback = 'Не удалось загрузить данные. Повторите загрузку таблицы.') {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (error && typeof error === 'object' && 'name' in error && error.name === 'NotAllowedError' || /clipboard permission denied/i.test(message)) return 'Браузер не разрешил копирование. Разрешите доступ к буферу обмена и повторите.'
  if (/^[А-ЯЁ]/.test(message) && message.length <= 500 && !/[\r\n]|failed query|\b(?:select|insert|update|delete)\s|SQLSTATE|\b\w*Error\b|\.[jt]sx?:\d/i.test(message)) return message
  return fallback
}
