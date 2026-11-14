import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { getWorkflowResultValueIssues } from './workflow-result-values'
import { FIELD_BY_KEY, type WeldInput } from './weld-fields'
import { getReportImportTemplateFields } from './report-import-template'
import { buildReportImportPreview } from './report-import-preview'

const fields = ['vikResult', 'rkResult', 'uzkResult', 'pvkResult', 'pstoResult', 'tvmtResult'] as const
for (const field of fields) {
  it(`${field} accepts only known facts and existing workflow placeholders without rewriting them`, () => {
    const facts = field === 'pstoResult' ? ['проведено', 'да', 'проведено (отменен)']
      : ['годен', 'ремонт', 'вырез', 'да', 'годен (отменен)', ...(field === 'tvmtResult' ? ['не годен', 'негоден'] : [])]
    const allowed = [null, undefined, '', ' ', 'ожидает', 'ожидает НК', 'ожидает заявку', 'отменен', ...facts,
      ...facts.map(value => `${value} · назначение отменено`)]
    for (const value of allowed) {
      const record = { [field]: value } as WeldInput
      expect(getWorkflowResultValueIssues(record), `${field}=${value}`).toEqual([])
      expect(record[field]).toBe(value)
    }
    for (const value of ['unexpected', 'ожидает arbitrary', 'unexpected · назначение отменено', [], {}, true, 42]) {
      expect(getWorkflowResultValueIssues({ [field]: value } as WeldInput)).toHaveLength(1)
    }
    expect(getWorkflowResultValueIssues({ [field]: 'LEGACY', lnkNote: 'Note' }, { [field]: 'LEGACY' })).toEqual([])
    expect(getWorkflowResultValueIssues({ [field]: 'NEW' }, { [field]: 'LEGACY' })).toHaveLength(1)
  })
}

it('does not accept another process outcome as a new PSTO fact, while retaining old history', () => {
  for (const pstoResult of ['годен', 'ремонт', 'вырез', 'не годен']) {
    expect(getWorkflowResultValueIssues({ pstoResult })).toHaveLength(1)
    expect(getWorkflowResultValueIssues({ pstoResult, pstoNote: 'History' }, { pstoResult })).toEqual([])
  }
})

it('a new LNK rejection requires the explicit repair/cut outcome; unknown old rejection text is retained', () => {
  for (const field of ['vikResult', 'rkResult', 'uzkResult', 'pvkResult'] as const) for (const value of ['не годен', 'негоден']) {
    expect(getWorkflowResultValueIssues({ [field]: value })).toHaveLength(1)
    expect(getWorkflowResultValueIssues({ [field]: value, lnkNote: 'History' }, { [field]: value })).toEqual([])
  }
})

it('the raw result validator aggregates all six invalid fields independently of the protected Excel template', () => {
  const record = Object.fromEntries(fields.map(field => [field, 'INVALID-RESULT'])) as WeldInput
  const issues = getWorkflowResultValueIssues(record)
  expect(issues).toHaveLength(6)
  expect(issues.flatMap(issue => issue.fieldKeys)).toEqual(fields)
  for (const field of fields) expect(issues.find(issue => issue.fieldKeys.includes(field))?.message).toContain(FIELD_BY_KEY.get(field)!.label)
})

it.each([false, true])('journal XLSX ignores protected system cells and collects editable errors (invalid=%s)', async invalidEditable => {
  const fields = getReportImportTemplateFields('weldingJournal')
  const ignored = ['vikResult', 'pstoResult', 'vikConclusionDate', 'pstoDate'] as const
  for (const key of ignored) expect(fields.some(field => field.key === key)).toBe(true)
  const values: Record<string, unknown> = { projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1',
    vikResult: 'INVALID-RESULT', pstoResult: 'INVALID-PSTO', vikConclusionDate: 'not-a-date', pstoDate: 'not-a-date',
    ...(invalidEditable ? { weldDate: 'not-a-weld-date', d1: 'not-a-diameter' } : { d1: 159 }) }
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([fields.map(field => field.label),
    fields.map(field => values[field.key] ?? '')]), 'Import')
  const buffer = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const file = { name: 'results.xlsx', arrayBuffer: async () => buffer, text: async () => '' } as File
  const preview = await buildReportImportPreview({ activeReport: 'weldingJournal', file, weldFormStampSelectOptions: {}, welderStamps: [], welderStampSuspensions: [] })
  for (const row of [...preview.records, ...preview.validRecords]) {
    for (const key of ignored) expect(row).not.toHaveProperty(key)
  }
  if (invalidEditable) {
    expect(preview.validRecords).toEqual([])
    expect(preview.errors).toHaveLength(1)
    expect(preview.errors[0].fieldKeys).toEqual(expect.arrayContaining(['weldDate', 'd1']))
    for (const field of ['weldDate', 'd1'] as const) expect(preview.errors[0].message).toContain(FIELD_BY_KEY.get(field)!.label)
    for (const field of ignored) expect(preview.errors[0].fieldKeys).not.toContain(field)
  } else {
    expect(preview.errors).toEqual([])
    expect(preview.validRecords).toHaveLength(1)
    expect(preview.validRecords[0].d1).toBe(159)
  }
})
