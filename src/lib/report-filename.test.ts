import { expect, it } from 'vitest'
import { reportExcelFilename } from './report-filename'

it('uses the snapshot minute in Moscow, including midnight and a year rollover', () => {
  expect(reportExcelFilename('Ожидает ремонта', '2026-11-25T14:05:58Z')).toBe('Ожидает ремонта 25.11.2026 17꞉05.xlsx')
  expect(reportExcelFilename('ЛНК: текущая версия', '2026-12-31T21:03:09Z')).toBe('ЛНК — текущая версия 01.01.2027 00꞉03.xlsx')
})

it('keeps the timestamp and extension for long or filename-unsafe custom titles', () => {
  const time = new Date('2026-11-25T14:05Z')
  expect(reportExcelFilename(' /../ ', time)).toBe('Отчёт 25.11.2026 17꞉05.xlsx')
  expect(reportExcelFilename('Список документов: Этап "А/Б"', time)).toBe('Список документов — Этап А Б 25.11.2026 17꞉05.xlsx')
  const long = reportExcelFilename('📄'.repeat(100), time)
  expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(255)
  expect(long).toMatch(/^(?:📄)+ 25\.11\.2026 17꞉05\.xlsx$/)
})
