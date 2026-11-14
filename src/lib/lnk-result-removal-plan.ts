import { LNK_METHODS } from './lnk-report-config'
import type { WeldInput } from './weld-fields'

export type LnkResultRemovalTarget = {
  rowId: number
  methodKey: 'vikRequest' | 'rkRequest' | 'uzkRequest' | 'pvkRequest'
  expectedVersion: string
}
export type LnkResultRemovalRequest = {
  targets: LnkResultRemovalTarget[]
  specialistCorrectionConfirmation?: string
}

function assertFields(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new Error('Недопустимые поля операции удаления результатов ЛНК.')
  }
}

export function normalizeLnkResultRemoval(value: LnkResultRemovalRequest): LnkResultRemovalRequest {
  assertFields(value, ['targets', 'specialistCorrectionConfirmation'])
  if (!Array.isArray(value.targets) || !value.targets.length) throw new Error('Выберите результаты ЛНК для удаления.')
  if (value.specialistCorrectionConfirmation !== undefined && typeof value.specialistCorrectionConfirmation !== 'string') {
    throw new Error('Недопустимое подтверждение изменения специалистов.')
  }
  const versions = new Map<number, string>()
  const targets = new Set<string>()
  for (const target of value.targets) {
    assertFields(target, ['rowId', 'methodKey', 'expectedVersion'])
    if (!Number.isSafeInteger(target.rowId) || target.rowId <= 0 ||
      !['vikRequest', 'rkRequest', 'uzkRequest', 'pvkRequest'].includes(target.methodKey) ||
      typeof target.expectedVersion !== 'string' || !target.expectedVersion.trim()) {
      throw new Error('Исходная версия или метод результата ЛНК недоступны. Обновите отчет.')
    }
    const key = `${target.rowId}:${target.methodKey}`
    if (targets.has(key)) throw new Error('Результат ЛНК повторяется в удалении.')
    targets.add(key)
    if (versions.has(target.rowId) && versions.get(target.rowId) !== target.expectedVersion) {
      throw new Error('Изменения одного стыка имеют разные исходные версии.')
    }
    versions.set(target.rowId, target.expectedVersion)
  }
  return value
}

/** Only the server chooses changed fields. Stored facts and business checks are
 * resolved under the locks in the shared atomic weld mutation pipeline. */
export function buildLnkResultRemovalBatch(value: LnkResultRemovalRequest) {
  const request = normalizeLnkResultRemoval(value)
  const records = new Map<number, WeldInput>()
  const versions = new Map<number, string>()
  for (const target of request.targets) {
    const method = LNK_METHODS.find(method => method.requestKey === target.methodKey)!
    const record = records.get(target.rowId) ?? { id: target.rowId }
    records.set(target.rowId, { ...record, [method.resultKey]: null, [method.conclusionKey]: null,
      [method.conclusionDateKey]: null, [method.defectDescriptionKey]: null,
      ...(method.code === 'РК' ? { rkExposureConfirmedDiameter: null } : {}) })
    versions.set(target.rowId, target.expectedVersion)
  }
  return { records: [...records.values()], expectedVersions: [...versions].map(([id, version]) => ({ id, version })),
    mutationScope: 'lnk' as const, specialistCorrectionConfirmation: request.specialistCorrectionConfirmation }
}
