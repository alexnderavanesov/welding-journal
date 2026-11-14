import { expect, it } from 'vitest'
import type { WeldJoint } from '@/db/schema'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import { getLnkResultRemovalBlockReason } from '@/lib/lnk-chronology-checks'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { prepareServerWeldRecords, validateServerWeldRecords } from './weld-save-validation'

const context = { controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS, dataListSettings: DEFAULT_DATA_LIST_SETTINGS,
  otherSettings: DEFAULT_OTHER_SETTINGS, saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS,
  systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS, welderStamps: [], welderStampSuspensions: [], pstoLineAssignments: new Map() }

for (const method of LNK_METHODS.filter(method => ['ВИК', 'ПВК'].includes(method.code))) {
  it.each(['годен', 'да', 'не годен', 'негоден'])(`${method.code} %s retains the mandatory deletion order for stored downstream results`, result => {
    const previous = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1', connectionType: 'С17', weldDate: '2026-01-01',
      [method.enabledKey]: 'да', [method.requestKey]: 'REQ', [method.requestDateKey]: '2026-01-02',
      [method.resultKey]: result, [method.conclusionKey]: 'CONCLUSION', [method.conclusionDateKey]: '2026-01-03',
      hasRk: 'да', rkRequest: 'RKREQ', rkRequestDate: '2026-01-03', rkResult: 'годен', rkConclusion: 'RKC', rkConclusionDate: '2026-01-04',
    } as unknown as WeldJoint
    const makeArgs = (patch: Partial<WeldJoint>) => ({ records: [{ ...previous, ...patch }], previousRows: new Map([[1, previous]]), context })
    const expected = `Результат ${method.code} нельзя удалить, пока сохранены результаты следующих видов НК: РК`
    expect(getLnkResultRemovalBlockReason(previous, method.requestKey, context.saveCheckSettings)).toContain(expected)
    const removal = makeArgs({ [method.resultKey]: null, [method.conclusionKey]: null, [method.conclusionDateKey]: null,
      [method.defectDescriptionKey]: null })
    prepareServerWeldRecords(removal)
    expect(() => validateServerWeldRecords(removal)).toThrow(expected)
    // Legacy facts remain editable for unrelated corrections; this is not a
    // normalization or a retroactive obligation to rewrite their result value.
    const note = makeArgs({ lnkNote: 'Уточнение' })
    prepareServerWeldRecords(note)
    expect(() => validateServerWeldRecords(note)).not.toThrow()
    expect(note.records[0][method.resultKey]).toBe(result)
  })
}
