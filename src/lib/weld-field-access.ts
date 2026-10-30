import { hasPermission, type AccessIdentity } from './access-permissions'
import { LNK_PROFILE_FIELD_KEYS, PSTO_PROFILE_FIELD_KEYS, WELDING_PROFILE_FIELD_KEYS } from '@/server/weld-mutation-policy'
import { WELD_FIELDS } from './weld-fields'
const welding = new Set<string>(WELDING_PROFILE_FIELD_KEYS)
// These identify a record in the other sections without granting access to welding facts/notes.
const sharedIdentity = new Set(['projectTitle', 'subtitleCode', 'line', 'joint', 'isometry', 'sheet', 'revisionNumber', 'spool', 'spoolId', 'groupName', 'category', 'connectionType', 'd1', 'd2', 't1', 't2', 'officiality'])
const lnk = new Set<string>(LNK_PROFILE_FIELD_KEYS)
const psto = new Set<string>(PSTO_PROFILE_FIELD_KEYS)
const transportFields: Record<string, string> = { chainStates: 'programChainState', emptyRepairRequirementIds: 'programRepairRequirements' }
export const SERVICE_DATE_FIELDS = new Set(['createdAt', 'updatedAt', 'weldingUpdatedAt', 'lnkCreatedAt', 'lnkUpdatedAt', 'pstoCreatedAt', 'pstoUpdatedAt'])
export const RESTRICTED_WELD_FIELDS = new Set<string>([...WELD_FIELDS.map(field => field.key),
  'preHeatTreatmentControls', 'preHeatTreatmentLnkEnabled', 'pstoRepeatCycles', 'duplicateControls', 'pstoExceptionBasis', 'pvkControlPercent', 'layeredControlAssigned',
  'activeDispatcherTasks', 'programRepairRequirements', 'programChainState', 'chainContinuation',
  'jsrDocumentId', 'checklistDocumentId', 'zniDocumentId', 'layeredVikEdgesDocumentId', 'layeredVikLayersDocumentId', 'layeredPvkEdgesDocumentId', 'layeredPvkLayersDocumentId'])
export function canViewWeldField(identity: AccessIdentity, key: string) {
  if (identity.role !== 'user') return true
  if (key === 'officiality') return ['welding.view', 'lnk.view', 'psto.view'].some(permission => hasPermission(identity, permission as any))
  if (['finalStatus', 'dispatcherTasks', 'activeDispatcherTasks', 'controlBasisSummary', 'programChainState', 'chainContinuation'].includes(key)) return ['welding.view', 'lnk.view', 'psto.view'].every(permission => identity.permissions.includes(permission as any))
  if (key === 'programRepairRequirements' || key.startsWith('layered')) return hasPermission(identity, 'lnk.view')
  if (['jsrDocumentId', 'checklistDocumentId', 'zniDocumentId'].includes(key)) return hasPermission(identity, 'welding.view') || hasPermission(identity, 'documents.view')
  if (key.startsWith('pre') || key === 'duplicateControls' || key === 'layeredControlAssigned' || key === 'pvkControlPercent') return hasPermission(identity, 'lnk.view')
  if (key === 'pstoRepeatCycles' || key === 'pstoExceptionBasis') return hasPermission(identity, 'psto.view')
  if (sharedIdentity.has(key)) return ['welding.view', 'lnk.view', 'psto.view', 'documents.view', 'lines.view'].some(permission => identity.permissions.includes(permission as any))
  if (welding.has(key) && hasPermission(identity, 'welding.view')) return true
  if (psto.has(key)) return hasPermission(identity, 'psto.view')
  if (lnk.has(key)) return hasPermission(identity, 'lnk.view')
  if (welding.has(key)) return false
  if (key.startsWith('lnk') || key === 'rkExposureScheme') return hasPermission(identity, 'lnk.view')
  if (key.startsWith('psto')) return hasPermission(identity, 'psto.view')
  if (key.startsWith('welding') || ['jsrDocument', 'checklistDocument', 'zniDocument'].includes(key)) return hasPermission(identity, 'welding.view')
  return ['welding.view', 'lnk.view', 'psto.view', 'documents.view', 'lines.view'].some(permission => identity.permissions.includes(permission as any))
}
export function redactWeldData<T>(identity: AccessIdentity, value: T): T {
  if (identity.role !== 'user' || value == null || typeof value !== 'object' || value instanceof Date) return value
  if (Array.isArray(value)) return value.map(entry => redactWeldData(identity, entry)) as T
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value
  // Compact line-program payloads move these fields outside individual rows.
  // Apply the original field policy before the client restores that metadata.
  return Object.fromEntries(Object.entries(value).filter(([key]) => {
    const field = transportFields[key] ?? key
    return !RESTRICTED_WELD_FIELDS.has(field) || canViewWeldField(identity, field)
  }).map(([key, entry]) => [key, key === 'nullFields' && Array.isArray(entry)
    ? entry.filter(field => typeof field === 'string' && canViewWeldField(identity, field))
    : redactWeldData(identity, entry)])) as T
}
