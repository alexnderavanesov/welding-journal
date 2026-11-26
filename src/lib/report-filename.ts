import { BUSINESS_TIME_ZONE } from './business-date'

const reportTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

export function reportExcelFilename(title: string, generatedAt: string | Date) {
  const parts = Object.fromEntries(reportTime.formatToParts(new Date(generatedAt)).map(part => [part.type, part.value]))
  // Browsers replace an ASCII colon with an underscore when saving a download.
  const suffix = ` ${parts.day}.${parts.month}.${parts.year} ${parts.hour}꞉${parts.minute}.xlsx`
  const name = title.replace(/:\s+/g, ' — ').replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/^\.+/, '').trim() || 'Отчёт'
  // Leave room for the date and extension even for long user-defined register names.
  const encoder = new TextEncoder()
  const buffer = new Uint8Array(255 - encoder.encode(suffix).length)
  const { written } = encoder.encodeInto(name, buffer)
  return new TextDecoder().decode(buffer.subarray(0, written)).trimEnd() + suffix
}
