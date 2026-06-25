export function formatDisplayDate(value: unknown) {
  const text = String(value ?? '').trim()
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return text
  return `${match[3]}.${match[2]}.${match[1]}`
}
