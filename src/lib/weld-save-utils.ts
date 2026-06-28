import { updateWeldJoint } from '@/server/welds'
import type { WeldInput } from '@/lib/weld-fields'

type RowWithId = WeldInput & { id: number }

export async function updateWeldRowOrThrow<T extends RowWithId>(record: T, errorMessage = 'Запись не найдена') {
  const saved = await updateWeldJoint({ data: record })
  if (!saved) throw new Error(errorMessage)
  return saved
}

export async function updateWeldRowsOrThrow<T extends RowWithId>(
  records: T[],
  errorMessage = 'Не удалось сохранить часть записей',
) {
  const savedRows = await Promise.all(records.map((record) => updateWeldJoint({ data: record })))
  if (!savedRows.every(Boolean)) throw new Error(errorMessage)
  return savedRows
}
