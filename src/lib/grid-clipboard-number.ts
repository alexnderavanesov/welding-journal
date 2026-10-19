/** Preserve precision and use the spreadsheet's decimal comma, without touching codes or dates. */
export function gridClipboardNumber(value: unknown): string {
  const text = String(value ?? '').trim()
  const compact = text.replace(/[\s\u00a0\u202f]/g, '')
  return /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(compact)
    && Number.isFinite(Number(compact.replace(',', '.'))) ? compact.replace('.', ',') : text
}
