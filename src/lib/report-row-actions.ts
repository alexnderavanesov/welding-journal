import type { WeldRow } from '@/lib/dispatcher-types'
import type { ActiveReport } from '@/lib/home-state'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import {
  getPreHeatTreatmentControls,
  getPrimaryLnkStageBlockReason,
  getPrimaryLnkRequestAccess,
} from '@/lib/lnk-control-stage'
import { getPendingLnkResultMethods } from '@/lib/lnk-result-navigation'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { hasRejectedLnkResult } from '@/lib/lnk-status'
import {
  getPstoWorkflowRequestBlockReason,
  getPstoWorkflowResultBlockReason,
} from '@/lib/psto-status'

export type ReportRow = WeldRow

export type ReportRowActions = {
  onCreateRequest: (row: ReportRow) => void
  onAddResult: (row: ReportRow) => void
  canCreateRequest: (row: ReportRow) => boolean
  canAddResult: (row: ReportRow) => boolean
  headerLabel?: string
  createTitle?: string
  createDisabledTitle?: string | ((row: ReportRow) => string)
  createAriaLabel?: string
  resultTitle?: string
  resultDisabledTitle?: string | ((row: ReportRow) => string)
  resultAriaLabel?: string
}

export type ReportRowActionHandlers = {
  openCreatePstoRequestModalForRow: (row: ReportRow) => void
  openAddPstoResultModalForRow: (row: ReportRow) => void
  canCreatePstoRequest: (row: ReportRow) => boolean
  canAddPstoResult: (row: ReportRow) => boolean
  openCreateLnkRequestModalForRow: (row: ReportRow) => void
  openAddLnkResultModalForRow: (row: ReportRow) => void
  canCreateLnkRequest: (row: ReportRow) => boolean
  canAddLnkResult: (row: ReportRow) => boolean
}

export function getReportRowActions(
  activeReport: ActiveReport,
  handlers: ReportRowActionHandlers,
): ReportRowActions | undefined {
  if (activeReport === 'heatTreatment') {
    return {
      onCreateRequest: handlers.openCreatePstoRequestModalForRow,
      onAddResult: handlers.openAddPstoResultModalForRow,
      canCreateRequest: handlers.canCreatePstoRequest,
      canAddResult: handlers.canAddPstoResult,
      headerLabel: 'Действия ПСТО',
      createTitle: 'Создать заявку ПСТО на этот стык',
      createDisabledTitle: getPstoWorkflowRequestBlockReason,
      createAriaLabel: 'Создать заявку ПСТО на этот стык',
      resultTitle: 'Добавить результат ПСТО на этот стык',
      resultDisabledTitle: getPstoWorkflowResultBlockReason,
      resultAriaLabel: 'Добавить результат ПСТО на этот стык',
    }
  }

  if (activeReport === 'lnk') {
    return {
      onCreateRequest: handlers.openCreateLnkRequestModalForRow,
      onAddResult: handlers.openAddLnkResultModalForRow,
      canCreateRequest: handlers.canCreateLnkRequest,
      canAddResult: handlers.canAddLnkResult,
      headerLabel: 'Действия ЛНК',
      createTitle: 'Создать заявку ЛНК на этот стык',
      createDisabledTitle: getLnkWorkflowRequestBlockReason,
      createAriaLabel: 'Создать заявку ЛНК на этот стык',
      resultTitle: 'Добавить результат ЛНК на этот стык',
      resultDisabledTitle: getLnkWorkflowResultBlockReason,
      resultAriaLabel: 'Добавить результат ЛНК на этот стык',
    }
  }

  return undefined
}

export function getLnkWorkflowRequestBlockReason(row: ReportRow) {
  const enabledMethods = LNK_METHODS.filter((method) => isControlEnabledValue(row[method.enabledKey]))
  if (enabledMethods.length === 0) return 'Нет назначенных видов ЛНК для создания заявки.'
  if (hasRejectedLnkResult(row)) {
    return 'Новая заявка недоступна: сначала обработайте негодный результат и создайте требуемый R/W-стык.'
  }

  const blockedMethod = enabledMethods.find((method) => (
    !text(row[method.requestKey]) && getPrimaryLnkRequestAccess(row, method.code).status === 'blocked'
  ))
  if (blockedMethod) return getPrimaryLnkRequestAccess(row, blockedMethod.code).reason

  return 'Все доступные позиции ЛНК по этому стыку уже включены в заявки.'
}

export function getLnkWorkflowResultBlockReason(row: ReportRow) {
  const pendingMethods = getPendingLnkResultMethods(row)
  const blockedMethod = pendingMethods.find((method) => getPrimaryLnkStageBlockReason(row, method.code))
  if (blockedMethod) return getPrimaryLnkStageBlockReason(row, blockedMethod.code)
  if (hasRejectedLnkResult(row)) {
    return 'Новый результат недоступен: по стыку уже есть негодный результат. Продолжите ремонтную цепочку через задачу диспетчера.'
  }

  const hasRequest = LNK_METHODS.some((method) => text(row[method.requestKey]))
    || getPreHeatTreatmentControls(row).some((control) => text(control.requestName))
  return hasRequest
    ? 'Все созданные позиции ЛНК по этому стыку уже имеют результат.'
    : 'Сначала создайте заявку ЛНК на этот стык.'
}

function text(value: unknown) {
  return String(value ?? '').trim()
}
