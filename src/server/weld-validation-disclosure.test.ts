import { getPstoLineIdentityKey } from '@/lib/psto-line-assignment'
import { describe, expect, it } from 'vitest'
import type { WeldJoint } from '@/db/schema'
import type { Permission } from '@/lib/access-permissions'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import { accessContext } from './access-store'
import { validateServerWeldRecords, mergeWeldRecordsWithPrevious, type ServerWeldValidationContext } from './weld-save-validation'

const context = { controlProcessSettings: { ...DEFAULT_CONTROL_PROCESS_SETTINGS, preHeatTreatmentLnkEnabled: false },
  saveCheckSettings: { ...DEFAULT_SAVE_CHECK_SETTINGS, requiredRootStampWithWeldDate: false,
    requiredMaterialGroupWithWeldDate: false, requiredConnectionTypeWithWeldDate: false, requiredWeldingMethodWithWeldDate: false },
  dataListSettings: DEFAULT_DATA_LIST_SETTINGS, otherSettings: DEFAULT_OTHER_SETTINGS,
  systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS, welderStamps: [], welderStampSuspensions: [], pstoLineAssignments: new Map(),
} as unknown as ServerWeldValidationContext

for (const area of ['lnk', 'psto'] as const) describe(`${area} validation disclosure`, () => {
  for (const viewer of ['limited', 'all-facts', 'owner'] as const) it(`${viewer}: rejects invalid chronology without disclosing a hidden weld date`, () => {
    const previous = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1',
      preHeatTreatmentLnkEnabled: false, weldDate: '2026-10-11', hasVik: 'да', pstoRequired: area === 'psto' ? 'да' : 'нет',
    } as unknown as WeldJoint
    const previousRows = new Map([[1, previous]])
    const patch = area === 'lnk' ? { id: 1, vikRequest: 'V-1', vikRequestDate: '2026-10-01', vikResult: 'ожидает НК' }
      : { id: 1, pstoRequest: 'P-1', pstoRequestDate: '2026-10-01' }
    const records = mergeWeldRecordsWithPrevious([patch], previousRows)
    const permissions: Permission[] = [`${area}.view`, `${area}.edit`, ...(viewer === 'all-facts' ? ['welding.view' as const] : [])]
    const error = accessContext.run({ identity: { id: 'test', name: 'Test', email: '', title: '',
      role: viewer === 'owner' ? 'owner' : 'user', permissions, revision: 1 },
    operation: 'updateWeldJoints', operationId: 'test', area, permissions }, () => {
      try { validateServerWeldRecords({ records, previousRows, context: { ...context, pstoLineAssignments: new Map([[getPstoLineIdentityKey(previous), { rowCount: 1, assignedCount: 1 }]]) } }); return '' }
      catch (error) { return (error as Error).message }
    })
    expect(error).toMatch(/СП-04.*раньше даты сварки/)
    if (viewer === 'limited') {
      expect(error).not.toContain('11.10.2026')
      expect(error).not.toContain('2026-10-11')
    } else expect(error).toContain('11.10.2026')
    expect(previous.weldDate).toBe('2026-10-11')
  })
})

for (const importMode of [false, true]) it(`welding-only ${importMode ? 'import' : 'save'} hides LNK dates after merging stored facts`, () => {
  const previous = { id: 1, joint: 'F1', weldDate: '2026-10-01', hasVik: 'да', pstoRequired: 'нет',
    projectTitle: 'P', subtitleCode: 'S', line: 'L', vikRequest: 'V-1', vikRequestDate: '2026-10-05',
  } as unknown as WeldJoint
  const previousRows = new Map([[1, previous]])
  const records = mergeWeldRecordsWithPrevious([{ id: 1, weldDate: '2026-10-11' }], previousRows)
  const permissions: Permission[] = ['welding.view', 'welding.edit', 'welding.import']
  const error = accessContext.run({ identity: { id: 'test', name: 'Test', email: '', title: '', role: 'user', permissions, revision: 1 },
    operation: importMode ? 'importWeldJoints' : 'updateWeldJoints', operationId: 'test', area: 'welding', permissions }, () => {
    try { validateServerWeldRecords({ records, previousRows, context, importMode }); return '' }
    catch (error) { return (error as Error).message }
  })
  expect(error).toMatch(/СП-04.*раньше даты сварки/)
  expect(error).not.toMatch(/05\.10\.2026|2026-10-05/)
})
