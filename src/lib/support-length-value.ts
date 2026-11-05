/** Keep NUMERIC values as decimal text: Number would discard significant digits. */
export function normalizeSupportWeldLength(value: unknown): string | null {
  const text = String(value ?? '').trim().replace(',', '.')
  if (!text) return null
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text)
  if (!match || !(match[2] || match[3])) return text
  const exponent = Number(match[4] ?? 0)
  // PostgreSQL NUMERIC's representable exponent range, not a product limit.
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 147455) return text
  const digits = match[2] + (match[3] ?? '')
  const point = match[2].length + exponent
  const whole = (point <= 0 ? '0' : point >= digits.length ? digits + '0'.repeat(point - digits.length) : digits.slice(0, point)).replace(/^0+(?=\d)/, '') || '0'
  const fraction = (point <= 0 ? '0'.repeat(-point) + digits : point >= digits.length ? '' : digits.slice(point)).replace(/0+$/, '')
  const absolute = whole + (fraction ? `.${fraction}` : '')
  return match[1] === '-' && absolute !== '0' ? `-${absolute}` : absolute
}

export const isSupportLengthDecimal = (value: string) => /^-?\d+(?:\.\d+)?$/.test(value)
export const SUPPORT_LENGTH_STORAGE_LIMIT_REASON = 'Длина шва выходит за технический диапазон хранения: допустимо до 131072 цифр до запятой и до 16383 после неё.'
function normalizedSupportLengthError(normalized: string): string | null {
  if (!isSupportLengthDecimal(normalized) || normalized.startsWith('-') || normalized === '0') return 'Длина шва должна быть положительным числом или пустой.'
  const [whole, fraction = ''] = normalized.split('.')
  // Bounds of unconstrained PostgreSQL NUMERIC, not an application length limit.
  // https://www.postgresql.org/docs/current/datatype-numeric.html
  return whole.length > 131072 || fraction.length > 16383 ? SUPPORT_LENGTH_STORAGE_LIMIT_REASON : null
}

export function getSupportWeldLengthError(value: unknown): string | null {
  const normalized = normalizeSupportWeldLength(value)
  return normalized === null ? null : normalizedSupportLengthError(normalized)
}

export function isPositiveSupportWeldLength(value: unknown) {
  const normalized = normalizeSupportWeldLength(value)
  return normalized !== null && normalizedSupportLengthError(normalized) === null
}

/** Decimal addition for L totals; no conversion of the mantissa to Number. */
export function createSupportLengthSum() {
  let total = 0n, scale = 0
  return {
    add(value: unknown): boolean {
      const normalized = normalizeSupportWeldLength(value)
      if (normalized === null || !isSupportLengthDecimal(normalized)) return false
      const negative = normalized.startsWith('-')
      const [whole, fraction = ''] = (negative ? normalized.slice(1) : normalized).split('.')
      if (fraction.length > scale) { total *= 10n ** BigInt(fraction.length - scale); scale = fraction.length }
      total += (negative ? -1n : 1n) * BigInt(whole + fraction) * 10n ** BigInt(scale - fraction.length)
      return true
    },
    value(): string {
      const digits = (total < 0n ? -total : total).toString().padStart(scale + 1, '0')
      const decimal = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits
      return normalizeSupportWeldLength((total < 0n ? '-' : '') + decimal)!
    },
  }
}

export function formatSupportLengthDecimal(value: string) {
  const [whole, fraction] = value.split('.')
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + (fraction ? `,${fraction}` : '')
}
