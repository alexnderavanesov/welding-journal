import { expect, it } from 'vitest'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import type { WeldInput } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import { prepareServerWeldRecords, validateServerWeldRecords } from './weld-save-validation'
import { assertImportedWeldFields } from './access-payload'

it.each(['programChainState', 'programRepairRequirements', 'preHeatTreatmentControls', 'pstoRepeatCycles',
  'duplicateControls', 'layeredControlAssigned', 'layeredControlRequest', 'earlyCoilDecisionAccepted',
  'lineProgramId', 'pvkControlPercent', 'preHeatTreatmentMode', 'technologyCardSelection', 'systemDocumentIds',
  'groupPhysicalRoot', 'chainContinuation'])('import cannot provide internal field %s', field => {
  expect(() => assertImportedWeldFields({ projectTitle: 'P', line: 'L', joint: 'F2', [field]: {} })).toThrow('недоступно для импорта')
})

it('rejects historical workflow facts as well as forged relation objects', () => {
  expect(() => assertImportedWeldFields({ projectTitle: 'P', line: 'L', joint: 'F2', hasVik: 'да',
    vikRequest: 'R', vikRequestDate: '2026-11-01', vikResult: 'годен', vikConclusion: 'C', vikConclusionDate: '2026-11-02' })).toThrow('недоступны для импорта')
})

it('new imported independent joints cannot inherit pre-TO requirements from a submitted chain state', () => {
  const root: WeldRow = { id: 10, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1',
    connectionType: 'С17', hasVik: 'да', preHeatTreatmentRequired: true }
  const context = { controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS, dataListSettings: DEFAULT_DATA_LIST_SETTINGS,
    otherSettings: DEFAULT_OTHER_SETTINGS, saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS,
    systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS, welderStamps: [], welderStampSuspensions: [],
    pstoLineAssignments: new Map(), programRules: { rows: [root], approved: new Set<string>() } }
  const record: WeldInput = { projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F2', connectionType: 'С17', hasVik: 'да',
    ...{ programChainState: { kind: 'repair', weldJointId: -1, physicalRootId: root.id, sourceRowId: root.id,
      coilParentId: null, coilSide: null, replacedByCoil: false } } }
  const args = { records: [record], previousRows: new Map(), context, importMode: true }
  prepareServerWeldRecords(args)
  expect(() => validateServerWeldRecords(args)).not.toThrow()
  expect(record.preHeatTreatmentRequired).toBe(false)
})
