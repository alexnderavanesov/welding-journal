import type { AccessIdentity } from '@/lib/access-permissions'
import { redactWeldData } from '@/lib/weld-field-access'

// These handlers return only their own registry/configuration/aggregate data.
// A coincident property name (for example connectionType) is not a weld fact.
// Activity details already apply entity-area and weld-field checks in SQL and
// projection; applying weld rules again would erase authorized registry history.
const ownDomainResults = new Set([
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

export function redactOperationResult<T>(identity: AccessIdentity, filename: string, name: string, value: T): T {
  const operation = `${filename.replaceAll('\\', '/').split('/').at(-1)}#${name}`
  if (ownDomainResults.has(operation)) return value
  const redacted = redactWeldData(identity, value)
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
