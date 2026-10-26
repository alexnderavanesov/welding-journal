import { expect, it } from 'vitest'
import { isJournalRevisionError, journalReadErrorMessage, JOURNAL_CHANGED_MESSAGE } from './journal-read-error'

it.each(['Failed query: select weld_joints.id from weld_joints\nparams: 1', 'column "joint" must appear in the GROUP BY clause',
  'TypeError: Cannot read properties of undefined', 'Connection lost', 'Ошибка SQLSTATE 42803: select id from weld_joints'])('does not show technical details: %s', message => {
  expect(journalReadErrorMessage(new Error(message))).toBe('Не удалось загрузить данные. Повторите загрузку таблицы.')
})
it.each([JOURNAL_CHANGED_MESSAGE, 'Дождитесь загрузки раскрытых групп.', 'Выборка или диапазон изменились. Повторите копирование.'])('preserves actionable guidance: %s', message => {
  expect(journalReadErrorMessage(new Error(message))).toBe(message)
})
it('recognizes only a real revision conflict and explains clipboard permission separately', () => {
  expect(isJournalRevisionError(new Error(JOURNAL_CHANGED_MESSAGE))).toBe(true)
  expect(isJournalRevisionError(new Error('Failed query: select id'))).toBe(false)
  expect(journalReadErrorMessage(new DOMException('Permission denied', 'NotAllowedError'))).toContain('Браузер не разрешил копирование')
})
