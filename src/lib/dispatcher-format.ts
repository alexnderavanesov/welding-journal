export function formatTaskCount(count: number) {
  const lastTwoDigits = count % 100
  const lastDigit = count % 10
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return `${count} задач`
  if (lastDigit === 1) return `${count} задача`
  if (lastDigit >= 2 && lastDigit <= 4) return `${count} задачи`
  return `${count} задач`
}

export function formatReminderCount(count: number) {
  const lastTwoDigits = count % 100
  const lastDigit = count % 10
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return `${count} напоминаний`
  if (lastDigit === 1) return `${count} напоминание`
  if (lastDigit >= 2 && lastDigit <= 4) return `${count} напоминания`
  return `${count} напоминаний`
}

export function formatDaysLeft(daysLeft: number) {
  const days = Math.max(0, daysLeft)
  const lastTwoDigits = days % 100
  const lastDigit = days % 10
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return `${days} дней`
  if (lastDigit === 1) return `${days} день`
  if (lastDigit >= 2 && lastDigit <= 4) return `${days} дня`
  return `${days} дней`
}
