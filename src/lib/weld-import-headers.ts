import { EXCEL_FIELDS, normalizeHeader } from './weld-fields'

export function normalizeImportHeaders(values: unknown[]) {
  return values.map(normalizeHeader)
}

export function mapHeadersToFields(headers: string[]) {
  const seen = new Map<string, number>()

  return headers.map((header) => {
    const count = seen.get(header) ?? 0
    seen.set(header, count + 1)
    const candidates = EXCEL_FIELDS.filter((field) => field.label === header)
    return candidates[count] ?? candidates[0] ?? null
  })
}
