import type { OtherSettings } from '@/lib/other-settings'
import {
  isExistingRowsImportLockedField,
  isMassFillFieldLocked,
  isSystemImportField,
} from '@/lib/report-import-template'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { isSystemWdiMode } from '@/lib/wdi'

export type ExistingRowImportMode = 'massFill' | 'replaceData'

export function assertExistingRowsImportPayload({
  records,
  previousRows,
  mode,
  otherSettings,
}: {
  records: readonly WeldInput[]
  previousRows: ReadonlyMap<number, WeldInput>
  mode: ExistingRowImportMode
  otherSettings: Pick<OtherSettings, 'wdiCalculationMode'>
}) {
  records.forEach((record, index) => {
    const id = Number(record.id)
    const rowNumber = index + 2
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Импорт остановлен: строка ${rowNumber}. Не передан корректный ID записи.`)
    }

    const previous = previousRows.get(id)
    if (!previous) {
      throw new Error(`Импорт остановлен: запись с ID ${id} больше не существует. Скачайте свежий шаблон.`)
    }

    for (const rawKey of Object.keys(record)) {
      if (rawKey === 'id') continue
      const field = FIELD_BY_KEY.get(rawKey as WeldFieldKey)
      if (!field) {
        throw new Error(`Импорт остановлен: строка ${rowNumber}. Поле "${rawKey}" не поддерживается.`)
      }
      if (isExistingRowsImportLockedField(field)) {
        throwLockedFieldError(rowNumber, field.label)
      }

      if (field.key === 'wdi' && isSystemWdiMode(otherSettings)) {
        const hasWdiInputUpdate = ['connectionType', 'd1', 'd2', 't1', 't2'].some((key) => Object.hasOwn(record, key))
        if (!hasWdiInputUpdate) throwLockedFieldError(rowNumber, field.label)
        continue
      }

      if (mode === 'massFill') {
        if (!hasImportValue(record[field.key])) {
          throw new Error(`Импорт остановлен: строка ${rowNumber}. Массовое заполнение не очищает поле "${field.label}".`)
        }
        if (isMassFillFieldLocked('weldingJournal', field, previous)) {
          throwLockedFieldError(rowNumber, field.label)
        }
        continue
      }

      if (isSystemImportField('weldingJournal', field, previous)) {
        throwLockedFieldError(rowNumber, field.label)
      }
    }
  })
}

function throwLockedFieldError(rowNumber: number, label: string): never {
  throw new Error(`Импорт остановлен: строка ${rowNumber}. Поле "${label}" недоступно для этого режима или этой записи.`)
}

function hasImportValue(value: unknown) {
  if (value === null || value === undefined) return false
  return String(value).trim() !== ''
}
