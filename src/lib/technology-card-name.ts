/** A TK name is an identifier. Keep internal whitespace, case and punctuation;
 * only trim its edges and retain the journal's existing empty '-' marker. */
export function normalizeTechnologyCardName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  return name === '-' ? '' : name
}
