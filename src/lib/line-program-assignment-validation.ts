import type { WeldRow } from './dispatcher-types'
import { applyProgramPatch, type ProgramPatch } from './line-program-workspace'
import { getNewControlAvailabilityReportHistoryReason } from './weld-form-save-reasons'
import { getControlAssignmentRemovalReason } from './control-assignment-history'
import { loadSaveCheckSettings } from './save-check-settings'

/** UI explanation only; preview and save still run all authoritative weld-card checks. */
export function getProgramAssignmentError(row: WeldRow, values: ProgramPatch, historyProtection = loadSaveCheckSettings().controlHistoryProtection) {
  try {
    const next = applyProgramPatch(row, values)
    return getControlAssignmentRemovalReason(next, row) || (historyProtection ? getNewControlAvailabilityReportHistoryReason(next, row) : null) || ''
  } catch (error) { return error instanceof Error ? error.message : String(error) }
}
