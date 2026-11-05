import type { WeldInput } from './weld-fields'
import { normalizeControlAvailabilityStorageText } from './control-availability-values'

export function getControlPairAssignmentIssues(row: WeldInput, previous?: WeldInput) {
  // Preserve unrelated corrections to stored history; this never permits
  // creating a pair or changing either assignment into a new pair.
  if (previous && (['hasRk', 'hasUzk'] as const).every(field =>
    normalizeControlAvailabilityStorageText(previous[field]) === 'да' &&
    normalizeControlAvailabilityStorageText(row[field]) === 'да')) return []
  return normalizeControlAvailabilityStorageText(row.hasRk) === 'да' && normalizeControlAvailabilityStorageText(row.hasUzk) === 'да'
    ? [{ fieldKeys: ['hasRk', 'hasUzk'] as const,
      message: 'РК и УЗК нельзя одновременно назначить как «Да». Для второго метода выберите «Дополнительный» и укажите основание.' }]
    : []
}
