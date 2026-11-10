import type { AccessIdentity } from '@/lib/access-permissions'
import { canViewWeldField, redactWeldData } from '@/lib/weld-field-access'
import type { SchemeJoint, SchemeWeldInfo } from '@/lib/line-schemes'
import { projectControlWorkflowAccess } from './control-workflow-access'

// These handlers return only their own registry/configuration/aggregate data.
// A coincident property name (for example connectionType) is not a weld fact.
// Activity details already apply entity-area and weld-field checks in SQL and
// projection; applying weld rules again would erase authorized registry history.
const ownDomainResults = new Set([
  // Scheme labels/statuses have their own permission. Tooltip welding facts
  // are projected separately below using their original field permissions.
  'line-schemes-api.ts#getLineSchemes',
  'line-schemes-api.ts#getLineSchemeFilterOptions',
  'line-schemes-api.ts#openLineScheme',
  'line-schemes-api.ts#keepLineSchemeLease',
  'line-schemes-api.ts#getLineSchemeJoints',
  'line-schemes-api.ts#getLineSchemePoints',
  'line-schemes-api.ts#getLineSchemeDraftStates',
  'line-schemes-api.ts#saveLineSchemePoints',
  'line-schemes-api.ts#changeLineSchemeRevision',
  'document-connections.ts#getDocumentConnections',
  // The collector checks documents and each requested work area itself.
  'document-participants-api.ts#getDocumentTemplateParticipants',
  'document-save-recovery-api.ts#checkDocumentSave',
  // Registry IDs and configuration keys may also be called id, connectionType
  // or pstoRequest. They are not restricted weld facts; their operation policy
  // and (for accounts/history) internal checks remain mandatory.
  'app-settings.ts#listAppSettingsSnapshot',
  'app-settings.ts#saveAppSetting',
  'account-api.ts#listAccounts',
  'account-api.ts#inviteAccount',
  'account-api.ts#changeAccount',
  'account-api.ts#sendManagedLink',
  'account-api.ts#deleteAccount',
  'account-api.ts#updateOwnProfile',
  'account-api.ts#changeOwnPassword',
  'specialists.ts#listSpecialists',
  'specialists.ts#saveSpecialist',
  'specialists.ts#archiveSpecialist',
  'welder-stamps.ts#loadWelderStampRegistrySnapshot',
  'welder-stamps.ts#saveWelderStampRecords',
  'welder-stamps.ts#saveWelderStampSuspensionRecords',
  'document-templates-api.ts#listRemoteDocumentTemplatesWithFiles',
  'document-templates-api.ts#getRemoteDocumentTemplateInventory',
  'document-templates-api.ts#listRemoteDocumentTemplateIds',
  'document-templates-api.ts#getRemoteDocumentTemplate',
  'document-templates-api.ts#saveRemoteDocumentTemplate',
  'document-templates-api.ts#updateRemoteDocumentTemplate',
  'document-templates-api.ts#deleteRemoteDocumentTemplate',
  'document-templates-api.ts#cleanupRemoteDocumentTemplateFiles',
  'document-grouping-preferences.ts#getDocumentGroupingDefaults',
  'system-document-sequences.ts#getSystemDocumentSequences',
  'system-document-sequences.ts#getSystemDocumentSequence',
  'system-document-sequences.ts#resetSystemDocumentSequence',
  'system-document-sequences.ts#previewSystemDocumentNames',
  'technology-cards-api.ts#getTechnologyCardPage',
  'technology-cards-api.ts#getTechnologyCardSnapshot',
  'technology-cards-api.ts#changeTechnologyCard',
  'statistics.ts#getStatisticsServerResult',
  'weld-read-api.ts#getWeldDataUsageSummary',
  'activity-api.ts#getActivityDetails',
  'activity-api.ts#listActivityHistory',
  'activity-api.ts#getActivityFilters',
  'line-program.ts#findLineProgram',
  'line-program.ts#saveLineProgram',
  'line-program.ts#getLineProgramsForImport',
])
const lineConfigurationFields = ['projectTitle', 'subtitleCode', 'line', 'category', 'groupName', 'weldControlPercent', 'pvkControlPercent']
const schemeWeldFields = {
  date: 'weldDate', material1: 'material1', material2: 'material2', element1: 'element1', element2: 'element2',
  d1: 'd1', d2: 'd2', t1: 't1', t2: 't2',
  stamp1: 'stamp1K', stamp1Fact: 'stamp1KFact', stamp2: 'stamp1Z', stamp2Fact: 'stamp1ZFact',
} satisfies Record<keyof SchemeWeldInfo, string>

function projectSchemeJointAccess(identity: AccessIdentity, joint: SchemeJoint): SchemeJoint {
  if (identity.role !== 'user' || !joint.weldInfo) return joint
  const weldInfo = Object.fromEntries(Object.entries(schemeWeldFields).map(([key, field]) => [key,
    canViewWeldField(identity, field) ? joint.weldInfo![key as keyof SchemeWeldInfo] : null,
  ])) as SchemeWeldInfo
  return { ...joint, weldInfo }
}

export function redactOperationResult<T>(identity: AccessIdentity, filename: string, name: string, value: T): T {
  const operation = `${filename.replaceAll('\\', '/').split('/').at(-1)}#${name}`
  // These DTOs rename weldDate/stamp fields, so generic key-based redaction
  // alone cannot enforce their source policy. Do not redact scheme identity,
  // coordinates, or its explicitly authorized aggregate production state.
  if (value && typeof value === 'object') {
    if (operation === 'line-schemes-api.ts#getLineSchemeJoints') {
      const source = value as unknown as { rows: SchemeJoint[] }
      return { ...source, rows: source.rows.map(joint => projectSchemeJointAccess(identity, joint)) } as T
    }
    if (operation === 'line-schemes-api.ts#getLineSchemePoints') {
      const source = value as unknown as { points: { joint: SchemeJoint }[] }
      return { ...source, points: source.points.map(point => ({ ...point, joint: projectSchemeJointAccess(identity, point.joint) })) } as T
    }
    if (operation === 'line-schemes-api.ts#getLineSchemeDraftStates') {
      return (value as SchemeJoint[]).map(joint => projectSchemeJointAccess(identity, joint)) as T
    }
  }
  if (ownDomainResults.has(operation)) return value
  const redacted = redactWeldData(identity, value, (source, result) => projectControlWorkflowAccess(identity, source, result))
  if (!value || typeof value !== 'object' || !redacted || typeof redacted !== 'object') return redacted
  // These mixed responses have explicit line records alongside calculations.
  // Joint-page and explanation rows deliberately keep normal field redaction.
  const preserveLine = (record: Record<string, unknown>, filtered: Record<string, unknown>) => ({
    ...filtered, ...Object.fromEntries(lineConfigurationFields.filter(key => Object.hasOwn(record, key)).map(key => [key, record[key]])),
  })
  const source = value as Record<string, any>, result = redacted as Record<string, any>
  if (['line-program.ts#getLineProgramPage', 'line-program.ts#getLineProgramSection'].includes(operation) && Array.isArray(source.rows)) {
    return { ...result, rows: source.rows.map((row: Record<string, unknown>, index: number) => preserveLine(row, result.rows[index])) } as T
  }
  if (operation === 'line-program.ts#getLineProgramCalculation' && source.line) {
    return { ...result, line: preserveLine(source.line, result.line) } as T
  }
  return redacted
}
