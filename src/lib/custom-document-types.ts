export const CUSTOM_DOCUMENT_TYPES = ['custom1', 'custom2'] as const
export type CustomDocumentType = typeof CUSTOM_DOCUMENT_TYPES[number]
export type CustomDocumentNames = Record<CustomDocumentType, string>

export const DEFAULT_CUSTOM_DOCUMENT_NAMES: CustomDocumentNames = {
  custom1: 'Пользовательский 1',
  custom2: 'Пользовательский 2',
}

export function isCustomDocumentType(value: unknown): value is CustomDocumentType {
  return CUSTOM_DOCUMENT_TYPES.includes(value as CustomDocumentType)
}

export function normalizeCustomDocumentNames(value: unknown): CustomDocumentNames {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries(CUSTOM_DOCUMENT_TYPES.map(type => [type,
    typeof source[type] === 'string' && source[type].trim()
      ? source[type].replace(/\s+/g, ' ').trim().slice(0, 100)
      : DEFAULT_CUSTOM_DOCUMENT_NAMES[type],
  ])) as CustomDocumentNames
}

export function validateCustomDocumentNames(value: unknown): CustomDocumentNames {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  for (const type of CUSTOM_DOCUMENT_TYPES) {
    if (typeof source[type] !== 'string' || !source[type].trim() || source[type].trim().length > 100) {
      throw new Error('Укажите название каждого пользовательского документа: от 1 до 100 символов.')
    }
  }
  const names = normalizeCustomDocumentNames(value)
  if (names.custom1.toLocaleLowerCase('ru') === names.custom2.toLocaleLowerCase('ru')) {
    throw new Error('Названия двух пользовательских документов должны различаться.')
  }
  return names
}
