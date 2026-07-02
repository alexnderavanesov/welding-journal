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
import { openNonEmptyTabularReportWindow } from '@/lib/report-window'
import type { WeldField, WeldInput } from '@/lib/weld-fields'

export function openLnkWaitingNkReportWindow(rows: ReportRow[]) {
  return openNonEmptyTabularReportWindow({
    rows: buildLnkWaitingNkRows(rows) as WeldInput[],
    fields: LNK_WAITING_NK_FIELDS,
    sheetName: 'Ожидание НК',
    title: 'Ожидание НК',
    filename: 'lnk-waiting-nk.xlsx',
    emptyMessage: 'Нет стыков со статусом «ожидает НК»',
  })
}

export function openLnkToRequestReportWindow(rows: ReportRow[]) {
  return openNonEmptyTabularReportWindow({
    rows: buildLnkToRequestRows(rows) as WeldInput[],
    fields: LNK_WAITING_NK_FIELDS,
    sheetName: 'Ожидание заявки',
    title: 'Ожидание заявки',
    filename: 'lnk-waiting-request.xlsx',
    emptyMessage: 'Нет стыков, по которым нужно создать заявку ЛНК',
  })
}

export function openLnkConclusionsReportWindow(rows: ReportRow[]) {
  return openNonEmptyTabularReportWindow({
    rows: buildLnkConclusionsRows(rows) as WeldInput[],
    fields: LNK_CONCLUSIONS_FIELDS,
    sheetName: 'Заключения ЛНК',
    title: 'Заключения ЛНК',
    filename: 'lnk-conclusions.xlsx',
    emptyMessage: 'Нет заключений ЛНК для показа',
  })
}

export function openPstoWaitingRequestReportWindow(rows: ReportRow[]) {
  return openNonEmptyTabularReportWindow({
    rows: buildPstoWaitingRequestRows(rows) as WeldInput[],
    fields: PSTO_WAITING_REQUEST_FIELDS,
    sheetName: 'Ожидает заявку ПСТО',
    title: 'Ожидает заявку ПСТО',
    filename: 'psto-waiting-request.xlsx',
    emptyMessage: 'Нет стыков, по которым нужно создать заявку ПСТО',
  })
}

export function openPstoResultsReportWindow(rows: ReportRow[]) {
  return openNonEmptyTabularReportWindow({
    rows: buildPstoResultsRows(rows) as WeldInput[],
    fields: PSTO_RESULTS_FIELDS,
    sheetName: 'Результаты ПСТО',
    title: 'Результаты ПСТО',
    filename: 'psto-results.xlsx',
    emptyMessage: 'Нет результатов ПСТО для показа',
  })
}

export function openCurrentReportWindow(
  rows: WeldInput[],
  fields: WeldField[],
  title: string,
  filename: string,
) {
  return openNonEmptyTabularReportWindow({
    rows,
    fields,
    sheetName: 'Текущая версия',
    title,
    filename,
    emptyMessage: 'В текущем фильтре нет стыков для показа',
  })
}

export function openWeldingJournalCurrentReportWindow(rows: WeldInput[], fields: WeldField[]) {
  return openCurrentReportWindow(
    buildWeldingJournalRows(rows),
    fields,
    'Сварочный журнал: текущая версия',
    'welding-journal-current.xlsx',
  )
}

export function openWeldingJournalWaitingWeldReportWindow(rows: WeldInput[]) {
  return openNonEmptyTabularReportWindow({
    rows: buildWeldingJournalRowsByStatus(rows, 'ожидает сварку'),
    fields: WELDING_JOURNAL_WAITING_WELD_FIELDS,
    sheetName: 'Ожидает сварку',
    title: 'Сварочный журнал: ожидает сварку',
    filename: 'welding-journal-waiting-weld.xlsx',
    emptyMessage: 'Нет стыков со статусом «ожидает сварку»',
  })
}

export function openWeldingJournalWaitingRequestReportWindow(rows: WeldInput[]) {
  return openNonEmptyTabularReportWindow({
    rows: buildLnkToRequestRows(rows) as WeldInput[],
    fields: LNK_WAITING_NK_FIELDS,
    sheetName: 'Ожидание заявки',
    title: 'Сварочный журнал: ожидание заявки',
    filename: 'welding-journal-waiting-request.xlsx',
    emptyMessage: 'Нет стыков, по которым нужно создать заявку ЛНК',
  })
}

export function openWeldingJournalWaitingControlReportWindow(rows: WeldInput[]) {
  return openNonEmptyTabularReportWindow({
    rows: buildLnkWaitingNkRows(rows) as WeldInput[],
    fields: LNK_WAITING_NK_FIELDS,
    sheetName: 'Ожидание НК',
    title: 'Сварочный журнал: ожидание НК',
    filename: 'welding-journal-waiting-control.xlsx',
    emptyMessage: 'Нет стыков со статусом «ожидает НК»',
  })
}

export function openWeldingJournalWaitingRepairReportWindow(rows: WeldInput[]) {
  return openNonEmptyTabularReportWindow({
    rows: buildWeldingJournalWaitingRepairRows(rows),
    fields: WELDING_JOURNAL_WAITING_REPAIR_FIELDS,
    sheetName: 'Ожидает ремонт',
    title: 'Сварочный журнал: ожидает ремонт',
    filename: 'welding-journal-waiting-repair.xlsx',
    emptyMessage: 'Нет стыков со статусом «ожидает ремонт»',
  })
}

export function openWeldingJournalCancelledAcceptedReportWindow(rows: WeldInput[]) {
  return openNonEmptyTabularReportWindow({
    rows: buildWeldingJournalCancelledAcceptedRows(rows),
    fields: LNK_CONCLUSIONS_FIELDS,
    sheetName: 'Отмененные годные',
    title: 'Сварочный журнал: отмененные годные результаты',
    filename: 'welding-journal-cancelled-accepted.xlsx',
    emptyMessage: 'Нет отмененных годных результатов для показа',
  })
}

export function openWeldingJournalSystemReportWindow(rows: WeldInput[]) {
  return openNonEmptyTabularReportWindow({
    rows: buildWeldingJournalRows(rows),
    fields: WELDING_JOURNAL_SYSTEM_FIELDS,
    sheetName: 'Системная версия',
    title: 'Сварочный журнал: системная версия',
    filename: 'welding-journal-system.xlsx',
    emptyMessage: 'Нет стыков для показа в системной версии',
  })
}
