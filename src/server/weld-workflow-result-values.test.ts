import { expect, it } from 'vitest'
import type { WeldJoint } from '@/db/schema'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import type { WeldInput } from '@/lib/weld-fields'
import { prepareServerWeldRecords, validateServerWeldRecords } from './weld-save-validation'

const context = { controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS, dataListSettings: DEFAULT_DATA_LIST_SETTINGS,
  otherSettings: DEFAULT_OTHER_SETTINGS, saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS,
  systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS, welderStamps: [], welderStampSuspensions: [], pstoLineAssignments: new Map() }
const fields = ['vikResult', 'rkResult', 'uzkResult', 'pvkResult', 'pstoResult', 'tvmtResult'] as const
const base = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1', connectionType: 'С17', weldDate: '2026-01-01' }

for (const field of fields) {
  it.each(['INVALID-RESULT', 'ожидает INVALID', 42, { result: 'годен' }])(`${field} rejects a newly submitted unknown value %j`, value => {
    const previous = { ...base, [field]: 'ожидает' } as unknown as WeldJoint
    const args = { records: [{ ...previous, [field]: value } as unknown as WeldInput], previousRows: new Map([[1, previous]]), context }
    prepareServerWeldRecords(args)
    expect(() => validateServerWeldRecords(args)).toThrow('не распознано')
  })
  it(`${field} preserves an unchanged unknown historical value during unrelated edits`, () => {
    const previous = { ...base, [field]: 'HISTORICAL-UNKNOWN' } as unknown as WeldJoint
    const args = { records: [{ ...previous, lnkNote: 'Уточнение' }], previousRows: new Map([[1, previous]]), context }
    prepareServerWeldRecords(args)
    expect(() => validateServerWeldRecords(args)).not.toThrow()
    expect(args.records[0][field]).toBe('HISTORICAL-UNKNOWN')
  })
}

it('checks every invalid result in a merged import row together', () => {
  const previous = { ...base, vikRequest: 'REQ', vikRequestDate: '2026-01-02' } as unknown as WeldJoint
  const args = { records: [{ ...previous, vikResult: 'INVALID-VIK', rkResult: 'INVALID-RK' }],
    previousRows: new Map([[1, previous]]), context, importMode: true }
  prepareServerWeldRecords(args)
  let message = ''
  try { validateServerWeldRecords(args) } catch (error) { message = (error as Error).message }
  expect(message).toContain('Результат ВИК')
  expect(message).toContain('Результат РК')
})
