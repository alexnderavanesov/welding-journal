import {
  LNK_CONCLUSIONS_FIELDS,
  LNK_WAITING_NK_FIELDS,
  PSTO_RESULTS_FIELDS,
  PSTO_WAITING_REQUEST_FIELDS,
  WELDING_JOURNAL_SYSTEM_FIELDS,
  WELDING_JOURNAL_WAITING_REPAIR_FIELDS,
  WELDING_JOURNAL_WAITING_WELD_FIELDS,
} from '@/lib/report-config'
import {
  buildLnkConclusionsRows,
  buildLnkToRequestRows,
  buildLnkWaitingNkRows,
} from '@/lib/lnk-report-rows'
import {
  buildPstoResultsRows,
  buildPstoWaitingRequestRows,
} from '@/lib/psto-status'
import {
  buildWeldingJournalCancelledAcceptedRows,
  buildWeldingJournalRows,
  buildWeldingJournalRowsByStatus,
  buildWeldingJournalWaitingRepairRows,
} from '@/lib/welding-journal-report-rows'
import type { ReportRow } from '@/lib/report-row-actions'
import { buildTabularReport } from '@/lib/tabular-report'
import type { WeldField, WeldInput } from '@/lib/weld-fields'

const WAITING_LNK_FIELDS_WITH_STATUS = [
  ...LNK_WAITING_NK_FIELDS,
  { key: 'workflowStatus', dbName: '__workflow_status', label: 'Статус', kind: 'text', group: 'ЛНК', visible: true, virtual: true },
] as WeldField[]

export function buildLnkWaitingNkReport(rows: ReportRow[]) {
  return buildTabularReport({
    rows: buildLnkWaitingNkRows(rows) as WeldInput[],
    fields: WAITING_LNK_FIELDS_WITH_STATUS,
    sheetName: 'Ожидание НК',
    title: 'Ожидание НК',
    filename: 'lnk-waiting-nk.xlsx',
    emptyMessage: 'Нет стыков со статусом «ожидает НК»',
  })
}

export function buildLnkToRequestReport(rows: ReportRow[]) {
  return buildTabularReport({
    rows: buildLnkToRequestRows(rows) as WeldInput[],
    fields: WAITING_LNK_FIELDS_WITH_STATUS,
    sheetName: 'Ожидание заявки',
    title: 'Ожидание заявки',
    filename: 'lnk-waiting-request.xlsx',
    emptyMessage: 'Нет стыков, по которым нужно создать заявку ЛНК',
  })
}

export function buildLnkConclusionsReport(rows: ReportRow[]) {
  return buildTabularReport({
    rows: buildLnkConclusionsRows(rows) as WeldInput[],
    fields: LNK_CONCLUSIONS_FIELDS,
    sheetName: 'Заключения ЛНК',
    title: 'Заключения ЛНК',
    filename: 'lnk-conclusions.xlsx',
    emptyMessage: 'Нет заключений ЛНК для показа',
  })
}

export function buildPstoWaitingRequestReport(rows: ReportRow[]) {
  return buildTabularReport({
    rows: buildPstoWaitingRequestRows(rows) as WeldInput[],
    fields: PSTO_WAITING_REQUEST_FIELDS,
    sheetName: 'Ожидает заявку ПСТО',
    title: 'Ожидает заявку ПСТО',
    filename: 'psto-waiting-request.xlsx',
    emptyMessage: 'Нет стыков, по которым нужно создать заявку ПСТО',
  })
}

export function buildPstoResultsReport(rows: ReportRow[]) {
  return buildTabularReport({
    rows: buildPstoResultsRows(rows) as WeldInput[],
    fields: PSTO_RESULTS_FIELDS,
    sheetName: 'Результаты ПСТО',
    title: 'Результаты ПСТО',
    filename: 'psto-results.xlsx',
    emptyMessage: 'Нет результатов ПСТО для показа',
  })
}

export function buildCurrentReport(
  rows: WeldInput[],
  fields: WeldField[],
  title: string,
  filename: string,
) {
  return buildTabularReport({
    rows,
    fields,
    sheetName: 'Текущая версия',
    title,
    filename,
    emptyMessage: 'В текущем фильтре нет стыков для показа',
  })
}

export function buildWeldingJournalCurrentReport(rows: WeldInput[], fields: WeldField[]) {
  return buildCurrentReport(
    buildWeldingJournalRows(rows),
    fields,
    'Сварочный журнал: текущая версия',
    'welding-journal-current.xlsx',
  )
}

export function buildWeldingJournalWaitingWeldReport(rows: WeldInput[]) {
  return buildTabularReport({
    rows: buildWeldingJournalRowsByStatus(rows, 'ожидает сварку'),
    fields: WELDING_JOURNAL_WAITING_WELD_FIELDS,
    sheetName: 'Ожидает сварку',
    title: 'Сварочный журнал: ожидает сварку',
    filename: 'welding-journal-waiting-weld.xlsx',
    emptyMessage: 'Нет стыков со статусом «ожидает сварку»',
  })
}

export function buildWeldingJournalWaitingRequestReport(rows: WeldInput[]) {
  return buildTabularReport({
    rows: buildLnkToRequestRows(rows) as WeldInput[],
    fields: WAITING_LNK_FIELDS_WITH_STATUS,
    sheetName: 'Ожидание заявки',
    title: 'Сварочный журнал: ожидание заявки',
    filename: 'welding-journal-waiting-request.xlsx',
    emptyMessage: 'Нет стыков, по которым нужно создать заявку ЛНК',
  })
}

export function buildWeldingJournalWaitingControlReport(rows: WeldInput[]) {
  return buildTabularReport({
    rows: buildLnkWaitingNkRows(rows) as WeldInput[],
    fields: WAITING_LNK_FIELDS_WITH_STATUS,
    sheetName: 'Ожидание НК',
    title: 'Сварочный журнал: ожидание НК',
    filename: 'welding-journal-waiting-control.xlsx',
    emptyMessage: 'Нет стыков со статусом «ожидает НК»',
  })
}

export function buildWeldingJournalWaitingRepairReport(rows: WeldInput[]) {
  return buildTabularReport({
    rows: buildWeldingJournalWaitingRepairRows(rows),
    fields: WELDING_JOURNAL_WAITING_REPAIR_FIELDS,
    sheetName: 'Ожидает ремонт',
    title: 'Сварочный журнал: ожидает ремонт',
    filename: 'welding-journal-waiting-repair.xlsx',
    emptyMessage: 'Нет стыков со статусом «ожидает ремонт»',
  })
}

export function buildWeldingJournalCancelledAcceptedReport(rows: WeldInput[]) {
  return buildTabularReport({
    rows: buildWeldingJournalCancelledAcceptedRows(rows),
    fields: LNK_CONCLUSIONS_FIELDS,
    sheetName: 'Отмененные годные',
    title: 'Сварочный журнал: отмененные годные результаты',
    filename: 'welding-journal-cancelled-accepted.xlsx',
    emptyMessage: 'Нет отмененных годных результатов для показа',
  })
}

export function buildWeldingJournalSystemReport(rows: WeldInput[]) {
  return buildTabularReport({
    rows: buildWeldingJournalRows(rows),
    fields: WELDING_JOURNAL_SYSTEM_FIELDS,
    sheetName: 'Системная версия',
    title: 'Сварочный журнал: системная версия',
    filename: 'welding-journal-system.xlsx',
    emptyMessage: 'Нет стыков для показа в системной версии',
  })
}
