import type { WeldRow } from '@/lib/dispatcher-types'
import type { ActiveReport } from '@/lib/home-state'

export type ReportRow = WeldRow

export type ReportRowActions = {
  onCreateRequest: (row: ReportRow) => void
  onAddResult: (row: ReportRow) => void
  canCreateRequest: (row: ReportRow) => boolean
  canAddResult: (row: ReportRow) => boolean
  headerLabel?: string
  createTitle?: string
  createDisabledTitle?: string
  createAriaLabel?: string
  resultTitle?: string
  resultDisabledTitle?: string
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
      createDisabledTitle: 'Заявка ПСТО по этому стыку уже создана',
      createAriaLabel: 'Создать заявку ПСТО на этот стык',
      resultTitle: 'Добавить результат ПСТО на этот стык',
      resultDisabledTitle: 'Сначала создайте заявку ПСТО на этот стык',
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
      createDisabledTitle: 'Все заявки ЛНК по этому стыку уже созданы',
      createAriaLabel: 'Создать заявку ЛНК на этот стык',
      resultTitle: 'Добавить результат ЛНК на этот стык',
      resultDisabledTitle: 'Сначала создайте заявку ЛНК на этот стык',
      resultAriaLabel: 'Добавить результат ЛНК на этот стык',
    }
  }

  return undefined
}
