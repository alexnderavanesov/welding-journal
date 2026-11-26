import { expect, type Locator } from '@playwright/test'
import { LNK_VISIBLE_FIELD_SECTIONS } from '../src/lib/lnk-visible-field-layout'
import { getReportHiddenFieldKeys, shouldMergePstoSections } from '../src/lib/report-field-state'
import { getAvailableWeldTableSections } from '../src/lib/weld-table-sections'

/** Check virtualized data headers outside any measured scroll gesture. */
export async function assertFullWeldReportColumns(grid: Locator) {
  const { report, headers } = await grid.evaluate(async element => {
    const report = element.closest('[data-weld-report-grid]')?.getAttribute('data-weld-report-grid')
    const viewport = element.querySelector<HTMLElement>('.ag-grid-viewport')!
    const start = viewport.scrollLeft
    const end = viewport.scrollWidth - viewport.clientWidth
    const settled = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const headers = new Set<string>()
    for (let left = 0; left < end + 500; left += 500) {
      viewport.scrollLeft = Math.min(left, end)
      await settled()
      for (const header of element.querySelectorAll('.ag-header-cell[col-id]')) headers.add(header.getAttribute('col-id')!)
    }
    viewport.scrollLeft = start
    await settled()
    return { report, headers: [...headers] }
  })
  if (report !== 'weldingJournal' && report !== 'lnk' && report !== 'heatTreatment') throw new Error(`Unknown weld report ${report}`)
  const fields = getAvailableWeldTableSections({
    hiddenFieldKeys: getReportHiddenFieldKeys(report), mergePstoSections: shouldMergePstoSections(report),
    sectionLayout: report === 'lnk' ? LNK_VISIBLE_FIELD_SECTIONS : undefined,
  }).flatMap(section => section.fields.map(field => field.key))
  expect(fields.filter(field => !headers.includes(field)), report).toEqual([])
  return fields.length
}
