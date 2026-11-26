export function isAngularConnectionType(value: unknown) {
  return String(value ?? '').trim().toLocaleUpperCase('ru').startsWith('У')
}

export function isTConnectionType(value: unknown) {
  return String(value ?? '').trim().toLocaleUpperCase('ru').startsWith('Т')
}

export function getConclusionJointFamily(connectionType: unknown) {
  // Standard stored codes dominate bulk previews. Preserve the existing Unicode
  // normalization for legacy values, including surrounding whitespace.
  if (typeof connectionType === 'string') {
    if (connectionType.startsWith('Т')) return 'Т'
    if (connectionType.startsWith('С') || connectionType.startsWith('У')) return 'С/У'
  }
  return isTConnectionType(connectionType) ? 'Т' : 'С/У'
}

export function assertSameConclusionJointFamily(families: Iterable<string>) {
  if (new Set(families).size > 1) {
    throw new Error('Стыки С/У и Т должны входить в разные заключения. Проверьте состав документов.')
  }
}
