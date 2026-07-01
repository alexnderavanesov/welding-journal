import { createWeldJoint, updateWeldJoint } from '@/server/welds'
import type { WeldRow } from '@/lib/dispatcher-types'
import { normalizeDateLikeForStorage } from '@/lib/date-format'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'

type RowWithId = WeldRow

export async function createWeldRowOrThrow<T extends WeldInput>(
  record: T,
  errorMessage = 'Не удалось создать запись',
) {
  const saved = await createWeldJoint({ data: normalizeDateFieldsForSave(record) })
  if (!saved) throw new Error(errorMessage)
  return saved
}

export async function createWeldRowsOrThrow<T extends WeldInput>(
  records: T[],
  errorMessage = 'Не удалось создать записи',
) {
  const savedRows = await Promise.all(records.map((record) => createWeldJoint({ data: normalizeDateFieldsForSave(record) })))
  if (!savedRows.every(Boolean)) throw new Error(errorMessage)
  return savedRows
}

export async function updateWeldRowOrThrow<T extends RowWithId>(record: T, errorMessage = 'Запись не найдена') {
  const saved = await updateWeldJoint({ data: normalizeDateFieldsForSave(record) })
  if (!saved) throw new Error(errorMessage)
  return saved
}

export async function updateWeldRowsOrThrow<T extends RowWithId>(
  records: T[],
  errorMessage = 'Не удалось сохранить часть записей',
) {
  const savedRows = await Promise.all(records.map((record) => updateWeldJoint({ data: normalizeDateFieldsForSave(record) })))
  if (!savedRows.every(Boolean)) throw new Error(errorMessage)
  return savedRows
}

function normalizeDateFieldsForSave<T extends WeldInput>(record: T): T {
  let nextRecord: T | null = null
  for (const fieldKey of dateFieldKeys) {
    const normalizedValue = normalizeDateLikeForStorage(record[fieldKey])
    const nextValue = normalizedValue ?? null
    if ((record[fieldKey] ?? null) !== nextValue) {
      nextRecord = { ...(nextRecord ?? record), [fieldKey]: nextValue } as T
    }
  }
  return nextRecord ?? record
}

const dateFieldKeys = [...FIELD_BY_KEY.entries()]
  .filter(([, field]) => field.kind === 'date')
  .map(([fieldKey]) => fieldKey as WeldFieldKey)
