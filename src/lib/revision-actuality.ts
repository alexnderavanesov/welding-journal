export function isRevisionNotActual(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('ru') === 'не актуален'
}
