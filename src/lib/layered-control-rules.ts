import { isAngularConnectionType, isTConnectionType } from '@/lib/connection-type'
import { normalizeControlAvailabilityStorageText } from '@/lib/control-availability-values'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { hasRejectedLineProgramControl, isCompletedLineProgramResult, isRejectedLineProgramResult } from '@/lib/line-program-calculation'
import { EXCLUDED_CONTROL_ASSIGNMENT_REASON, isActiveOfficialWeld } from './control-assignment-eligibility'

export function getLayeredControlSaveError(
  current: Partial<WeldRow>,
  previous?: Partial<WeldRow>,
  pvkGoodOnly = false,
) {
  return getLayeredControlSaveIssues(current, previous, pvkGoodOnly)[0]?.message ?? null
}

/** The LNK context command completes an already performed main PVK. Planning
 * through the card/program keeps its separate, earlier entry point. */
export function getLayeredControlContextActionBlockReason(row: WeldRow) {
  if (!isActiveOfficialWeld(row)) return EXCLUDED_CONTROL_ASSIGNMENT_REASON
  if (String(row.pvkResult ?? '').trim().toLowerCase() !== 'годен') {
    return 'Сначала внесите собственный основной результат ПВК «годен». Заранее назначить послойный контроль можно в карточке или программе линии.'
  }
  return getLayeredControlSaveError({ ...row, hasVik: 'да', hasPvk: 'да', layeredControlAssigned: true }, row)
}

/** The same rules at save time and in import preview, without hiding overlapping errors. */
export function getLayeredControlSaveIssues(
  current: Partial<WeldRow>,
  previous?: Partial<WeldRow>,
  pvkGoodOnly = false,
) {
  const issues: { message: string; fieldKeys: WeldFieldKey[] }[] = []
  const add = (message: string, ...fieldKeys: WeldFieldKey[]) => { issues.push({ message, fieldKeys }) }
  if (current.layeredControlAssigned && !previous?.layeredControlAssigned && !isActiveOfficialWeld(current)) add(EXCLUDED_CONTROL_ASSIGNMENT_REASON, 'hasPvk')
  if (isTConnectionType(current.connectionType) && ['да', 'дополнительный'].includes(normalizeControlAvailabilityStorageText(current.hasRk) ?? '') &&
    (!isTConnectionType(previous?.connectionType) || normalizeControlAvailabilityStorageText(current.hasRk) !== normalizeControlAvailabilityStorageText(previous?.hasRk))) {
    add('РК не назначается на Т-стыки. Полная программа Т/ОП реализуется отдельно.', 'hasRk', 'connectionType')
  }
  if (current.layeredControlAssigned) {
    if (current.duplicateControls?.length) {
      add('Послойный контроль несовместим с любым сохранённым дубль-контролем, включая годный и ожидающий результат.', 'hasPvk')
    }
    if (!isAngularConnectionType(current.connectionType)) add('Послойный контроль доступен только для У-стыков.', 'connectionType')
    if (normalizeControlAvailabilityStorageText(current.hasPvk) !== 'да') add('Послойный контроль требует назначения ПВК = «да».', 'hasPvk')
    // Excluding a disabled stage from the line norm never erases its history
    // or authorizes a layered assignment over an existing rejected result.
    if (hasRejectedLineProgramControl(current as WeldRow, { includeDisabledStageHistory: true })) {
      add('При послойном контроле нельзя сохранить «ремонт» или «вырез» по ВИК, РК, УЗК или ПВК на обоих этапах и в дублях. Сначала уберите послойный контроль.', 'hasPvk')
    }
  }
  if (previous?.layeredControlAssigned && !current.layeredControlAssigned) {
    add('Уберите послойный контроль отдельной командой «Убрать послойный контроль».', 'hasPvk')
  }
  if (previous?.layeredControlAssigned && isCompletedLineProgramResult(previous.pvkResult) &&
    !isCompletedLineProgramResult(current.pvkResult)) {
    add('Сначала уберите послойный контроль отдельной командой, затем удалите основной результат ПВК.', 'pvkResult')
  }
  if (pvkGoodOnly) {
    if (isRejectedLineProgramResult(current.pvkResult) && current.pvkResult !== previous?.pvkResult) {
      add('Включена настройка «ПВК — только годен»: негодный основной результат ПВК недоступен.', 'pvkResult')
    }
    const previousControls = new Map((previous?.preHeatTreatmentControls ?? []).map((control) => [control.method, control.result]))
    if ((current.preHeatTreatmentControls ?? []).some((control) => control.method === 'ПВК' &&
      isRejectedLineProgramResult(control.result) && previousControls.get('ПВК') !== control.result)) {
      add('Включена настройка «ПВК — только годен»: негодный результат ПВК до ТО недоступен.', 'pvkResult')
    }
  }
  return issues
}

export function buildLayeredControlAssignment(row: WeldRow, confirmPvk: boolean): WeldRow {
  if (!isActiveOfficialWeld(row)) throw new Error(EXCLUDED_CONTROL_ASSIGNMENT_REASON)
  const value = normalizeControlAvailabilityStorageText(row.hasPvk)
  if ((value === 'отменен' || value === 'дополнительный') && !confirmPvk) {
    throw new Error('Подтвердите перевод ПВК в «да» вместе с назначением послойного контроля.')
  }
  const next = { ...row, hasVik: 'да', hasPvk: 'да', layeredControlAssigned: true }
  const error = getLayeredControlSaveError(next, row)
  if (error) throw new Error(error)
  return next
}
