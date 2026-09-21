import type { WeldRow } from '@/lib/dispatcher-types'

export const REPORT_QUICK_SEARCH_FILTER_KEY = 'search'

const WELD_QUICK_SEARCH_FIELD_KEYS = [
  'projectTitle',
  'subtitleCode',
  'joint',
  'line',
  'isometry',
  'spool',
  'element1',
  'element2',
  'material1',
  'material2',
  'materialUniqueNumber1',
  'materialUniqueNumber2',
  'materialFullName1',
  'materialFullName2',
  'materialNormativeDocument1',
  'materialNormativeDocument2',
  'materialCertificateNumber1',
  'materialCertificateNumber2',
  'technologyCardNumber',
  'weldingElectrodes',
  'weldingElectrodesCertificateNumber',
  'fillerWire',
  'fillerWireCertificateNumber',
  'shieldingGas',
  'shieldingGasCertificateNumber',
  'responsible',
] as const satisfies readonly (keyof WeldRow)[]

export function splitReportQuickSearch(filters: Record<string, string>) {
  const columnFilters = { ...filters }
  const search = String(columnFilters[REPORT_QUICK_SEARCH_FILTER_KEY] ?? '').trim()
  delete columnFilters[REPORT_QUICK_SEARCH_FILTER_KEY]
  return { search, columnFilters }
}

export function matchesReportQuickSearch(row: WeldRow, value: string) {
  const query = value.trim().toLocaleLowerCase('ru-RU')
  if (!query) return true
  return WELD_QUICK_SEARCH_FIELD_KEYS.some((key) =>
    String(row[key] ?? '').toLocaleLowerCase('ru-RU').includes(query),
  )
}
