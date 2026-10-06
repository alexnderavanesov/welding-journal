export function isAngularConnectionType(value: unknown) {
  return String(value ?? '').trim().toLocaleUpperCase('ru').startsWith('У')
}

export function isTConnectionType(value: unknown) {
  return String(value ?? '').trim().toLocaleUpperCase('ru').startsWith('Т')
}
