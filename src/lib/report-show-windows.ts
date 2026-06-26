import {
  LNK_CONCLUSIONS_FIELDS,
  LNK_WAITING_NK_FIELDS,
  PSTO_RESULTS_FIELDS,
  PSTO_WAITING_REQUEST_FIELDS,
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
import { openNonEmptyTabularReportWindow } from '@/lib/report-window'
import type { WeldInput } from '@/lib/weld-fields'

type ReportRow = WeldInput & { id: number }

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
