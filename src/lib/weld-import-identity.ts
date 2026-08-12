import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export const REQUIRED_WELD_IMPORT_IDENTITY_FIELDS: ReadonlyArray<{
  fieldKey: WeldFieldKey
  label: string
}> = [
  { fieldKey: 'projectTitle', label: 'Проект' },
  { fieldKey: 'subtitleCode', label: 'Шифр' },
  { fieldKey: 'line', label: 'Линия' },
  { fieldKey: 'joint', label: 'Стык' },
]

export function getMissingWeldImportIdentityFields(record: WeldInput) {
  return REQUIRED_WELD_IMPORT_IDENTITY_FIELDS.filter(
    ({ fieldKey }) => !String(record[fieldKey] ?? '').trim(),
  )
}
