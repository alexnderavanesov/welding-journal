import {
  createWeldJoint,
  createWeldJoints,
  massFillWeldJoints,
  replaceWeldJoints,
  updateWeldJoint,
  updateSystemWeldJoint,
  updateWeldJoints,
} from '@/server/welds'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { SystemDocumentSequenceUpdate } from '@/server/system-document-sequences'
import type { RepeatedJointRenameTask } from '@/lib/dispatcher-types'
import { normalizeDateLikeForStorage } from '@/lib/date-format'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'

type RowWithId = Pick<WeldRow, 'id'> & Partial<WeldInput>

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
  const savedRows = await createWeldJoints({
    data: { records: records.map((record) => normalizeDateFieldsForSave(record)) },
  })
  if (!savedRows.every(Boolean)) throw new Error(errorMessage)
  return savedRows
}

export async function updateWeldRowOrThrow<T extends RowWithId>(record: T, errorMessage = 'Запись не найдена') {
  const saved = await updateWeldJoint({ data: normalizeDateFieldsForSave(record) })
  if (!saved) throw new Error(errorMessage)
  return saved
}

export async function updateSystemWeldRowOrThrow(task: RepeatedJointRenameTask, errorMessage = 'Запись не найдена') {
  const saved = await updateSystemWeldJoint({
    data: {
      id: task.row.id,
      currentJoint: task.currentJoint,
      targetJoint: task.targetJoint,
    },
  })
  if (!saved) throw new Error(errorMessage)
  return saved
}

export async function updateWeldRowsOrThrow<T extends RowWithId>(
  records: T[],
  errorMessage = 'Не удалось сохранить часть записей',
  options: {
    systemDocumentSequence?: SystemDocumentSequenceUpdate
  } = {},
) {
  const savedRows = await updateWeldJoints({
    data: {
      records: records.map((record) => normalizeDateFieldsForSave(record)),
      systemDocumentSequence: options.systemDocumentSequence,
    },
  })
  if (!savedRows.every(Boolean)) throw new Error(errorMessage)
  return savedRows
}

export async function massFillWeldRowsOrThrow<T extends RowWithId>(
  records: T[],
  errorMessage = 'Не удалось сохранить часть записей массового заполнения',
) {
  const savedRows = await massFillWeldJoints({
    data: { records: records.map((record) => normalizeDateFieldsForSave(record)) },
  })
  if (!savedRows.every(Boolean)) throw new Error(errorMessage)
  return savedRows
}

export async function replaceWeldRowsOrThrow<T extends RowWithId>(
  records: T[],
  deleteIds: number[],
  expectedVersions: WeldRowVersionTarget[],
  errorMessage = 'Не удалось заменить часть записей',
) {
  const result = await replaceWeldJoints({
    data: {
      records: records.map((record) => normalizeDateFieldsForSave(record)),
      deleteIds,
      expectedVersions,
    },
  })
  if (!result.rows.every(Boolean)) throw new Error(errorMessage)
  return result
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
