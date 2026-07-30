type XlsxModule = typeof import('xlsx')

let xlsxModule: XlsxModule | null = null
let xlsxModulePromise: Promise<XlsxModule> | null = null

async function loadXlsx() {
  if (xlsxModule) return xlsxModule
  xlsxModulePromise ??= import('xlsx').then((module) => {
    xlsxModule = module
    return module
  })
  return xlsxModulePromise
}

export async function readFirstSheetRows(data: ArrayBuffer | string, type: 'array' | 'string') {
  const XLSX = await loadXlsx()
  const workbook = XLSX.read(data, { type, raw: true, cellDates: false })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  return XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, raw: true, defval: null })
}
