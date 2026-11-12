import { JOURNAL_INLINE_FIELDS } from '@/lib/journal-inline-edit'
import { TECHNOLOGY_CARD_MATERIAL_FIELDS } from '@/lib/technology-card-materials'
import type { AuditFieldOrigin } from '@/lib/audit-value'
import { ALL_LNK_FIELD_METHODS } from '@/lib/lnk-report-config'
import { WELD_MUTATION_FIELD_KEYS } from './weld-mutation-policy'

// Classification is made once, on the server, while recording the operation.
// It never reinterprets old history and never accepts an origin supplied by a client.
type Row = Record<string, unknown>
export type AuditOriginResolver = (entity: string, before: Row | undefined, after: Row | undefined, key: string) => AuditFieldOrigin | undefined
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const list = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const fields = (value: string) => new Set(value.split(' '))
const technical = fields('id weldJointId documentId lineProgramId technologyCardId welderStampId fileName mimeType fileData fileDataBase64 blobKey sha256 sourceMetadata rowCount wdiTotal sequence')
const weldingFields = new Set<string>(WELD_MUTATION_FIELD_KEYS.welding)
const lnkFields = new Set<string>(WELD_MUTATION_FIELD_KEYS.lnk)
const pstoFields = new Set<string>(WELD_MUTATION_FIELD_KEYS.psto)
const stageFields: Record<string, Set<string>> = {
  pstoRequest: fields('pstoRequest pstoRequestDate'), pstoResult: fields('pstoResult pstoDate heatTreatmentDiagram'),
  tvmtRequest: fields('tvmtRequest tvmtRequestDate'), tvmtResult: fields('tvmtResult tvmtConclusionDate tvmtConclusion'),
}
const exposureFields = fields('rkExposureConfirmedDiameter defectDescription')
const resultOnlyFields = fields('result')
const preStageFields: Record<string, Set<string>> = {
  request: fields('method requestName requestDate'),
  result: fields('result conclusionDate conclusionName defectDescription rkExposureConfirmedDiameter'),
}
// These operations directly act on their primary records. Related records are
// effects of the same action, not additional actions by the named operator.
const primaryEntities: Record<string, string[]> = {
  saveDuplicateControl: ['duplicate_controls'], saveDuplicateControls: ['duplicate_controls'], deleteDuplicateControl: ['duplicate_controls'],
  saveRemoteGeneratedDocuments: ['generated_documents'], deleteRemoteGeneratedDocument: ['generated_documents'], applyDocumentOperation: ['generated_documents'],
  saveRemoteDocumentTemplate: ['document_templates'], updateRemoteDocumentTemplate: ['document_templates'], deleteRemoteDocumentTemplate: ['document_templates'], cleanupRemoteDocumentTemplateFiles: ['document_templates'],
  saveSpecialist: ['specialists'], archiveSpecialist: ['specialists'],
  saveWelderStampRecords: ['welder_stamps'], saveWelderStampSuspensionRecords: ['welder_stamp_suspensions'],
  changeTechnologyCard: ['technology_cards', 'technology_card_names'],
  saveLineProgram: ['line_programs'], deleteLineProgram: ['line_programs'],
  savePstoChainException: ['psto_chain_exceptions'], closeEmptyPstoChainException: ['psto_chain_exceptions'],
  changeLineProgramApprovals: ['dispatcher_accepted_warnings'],
  acceptDispatcherWarning: ['dispatcher_accepted_warnings'], revokeDispatcherAcceptedWarning: ['dispatcher_accepted_warnings'],
  saveAppSetting: ['app_settings'], resetSystemDocumentSequence: ['app_settings'], resetRemoteGeneratedDocumentSequence: ['app_settings'],
}
const directWeldFields: Record<string, Set<string>> = {
  extendLnkRequest: fields('vikRequest vikRequestDate rkRequest rkRequestDate uzkRequest uzkRequestDate pvkRequest pvkRequestDate'),
  clearLnkRequestPosition: fields('vikRequest vikRequestDate rkRequest rkRequestDate uzkRequest uzkRequestDate pvkRequest pvkRequestDate'),
  manageLnkRequestDocument: fields('vikRequest vikRequestDate rkRequest rkRequestDate uzkRequest uzkRequestDate pvkRequest pvkRequestDate'),
  managePstoRequestDocument: fields('pstoRequest pstoRequestDate'),
  updateLnkDefectDescription: fields('vikDefectDescription lnkDefectDescription uzkDefectDescription pvkDefectDescription'),
  applyLnkOfficialityChange: fields('officiality'), setChainActuality: fields('revisionActuality'),
  updateSystemWeldJoint: fields('joint'),
  applyTechnologyCardAssignmentBatch: new Set(['technologyCardNumber', ...TECHNOLOGY_CARD_MATERIAL_FIELDS.map(([field]) => field)]),
  saveJournalCellEdits: new Set(JOURNAL_INLINE_FIELDS), pasteJournalCells: new Set(JOURNAL_INLINE_FIELDS),
  changeLayeredControl: fields('layeredControlAssigned'),
  applyLineProgramControl: fields('hasRk hasUzk hasPvk hasVik'),
  savePstoLineAssignment: fields('pstoRequired pstoControlBasis pstoCancellationDate pstoExceptionBasis'),
  recalculateWdi: fields('wdi'),
}
function resultIsAutomatic(key: string, before: Row | undefined, after: Row | undefined) {
  if (key === 'finalStatus' || key === 'pstoResult' && after?.[key] === 'проведено') return true
  // Waiting is established by a workflow, never entered as a factual result.
  if (/Result$/.test(key) || key === 'result') return typeof after?.[key] === 'string' && String(after[key]).startsWith('ожидает')
  // Changing a result can clear its now-inapplicable defect details.
  if (/DefectDescription$/.test(key) || key === 'defectDescription' || key === 'rkExposureConfirmedDiameter') {
    const resultKey = key === 'defectDescription' || key === 'rkExposureConfirmedDiameter' && Object.hasOwn(after ?? before ?? {}, 'result') ? 'result' : key === 'lnkDefectDescription' || key === 'rkExposureConfirmedDiameter' ? 'rkResult' : key.replace('DefectDescription', 'Result')
    if (after?.[key] === 'ДНО' && after?.[resultKey] === 'годен') return true
    if (after?.[key] == null && before?.[key] != null) return before?.[resultKey] !== after?.[resultKey]
  }
  return false
}
export function createAuditOriginResolver(operation: string, input: unknown, settings: { auditWdiSystem?: boolean } = {}): AuditOriginResolver {
  const data = object(input)
  const simple = primaryEntities[operation]
  const direct = directWeldFields[operation]
  const weldSave = ['createWeldJoint', 'updateWeldJoint', 'updateWeldJoints', 'massFillWeldJoints', 'importWeldJoints', 'replaceWeldJoints', 'moveWeldJointChain'].includes(operation)
  const weldDelete = ['deleteWeldJoint', 'deleteWeldJoints', 'deleteObsoleteRepeatedJoint'].includes(operation)
  const psto = ['savePstoRepeatWorkflow', 'correctPstoCycleStage', 'correctPstoTvmtAndRemoveLaterCycles'].includes(operation)
  const pre = ['savePreHeatTreatmentLnkWorkflow', 'correctPreHeatTreatmentLnkResult', 'savePreHeatTreatmentLnkResultEdits', 'updatePreHeatTreatmentRkExposure'].includes(operation)
  const preBatch = operation === 'savePreHeatTreatmentBatch'
  const fill = operation === 'savePreHeatTreatmentFill' || Boolean(preBatch ? data.fill : object(data.preHeatTreatmentConfirmation).fill)
  const fillOptions = object(operation === 'savePreHeatTreatmentFill' ? data.options : preBatch ? data.fill : object(data.preHeatTreatmentConfirmation).fill)
  const documentEdit = ['assignDocumentSpecialists', 'changeSystemDocumentDate'].includes(operation)
  const documentDateFields = getDocumentDateFields(object(data.reference))
  const known = Boolean(simple || direct || weldSave || weldDelete || psto || pre || preBatch || fill || documentEdit || operation === 'createWeldJoints')
  const scope = data.mutationScope === 'lnk' ? lnkFields : data.mutationScope === 'psto' ? pstoFields : weldingFields
  // Server preparation can fill/replace fields on the original import objects.
  // Capture only the accepted scope's submitted values before that happens;
  // strings are shared, and nested row metadata/history is excluded from this projection.
  const records = weldSave ? (Array.isArray(data.records) ? list(data.records) : [data]) : []
  const byId = new Map<number, Row>(), byIdentity = new Map<string, Row>()
  for (const record of records) {
    const submitted: Row = {}
    for (const key of Object.keys(record)) if (scope.has(key)) {
      const value = record[key]
      submitted[key] = value instanceof Date ? new Date(value.getTime()) : value
    }
    if (record.id != null) byId.set(Number(record.id), submitted)
    else byIdentity.set(jointIdentity(record), submitted)
  }
  const sequences = [...list(data.systemDocumentSequences), ...(data.systemDocumentSequence ? [object(data.systemDocumentSequence)] : [])]
  const generatedNames = new Map<string, Set<unknown>>()
  for (const sequence of sequences) for (const key of Array.isArray(sequence.fieldKeys) ? sequence.fieldKeys : []) {
    if (typeof key !== 'string') continue
    const names = generatedNames.get(key) ?? new Set(); names.add(sequence.provisionalName); generatedNames.set(key, names)
  }
  const removed = new Set(Array.isArray(data.deleteIds) ? data.deleteIds.map(Number) : [])
  const groups = list(data.groups)
  const pstoNames = new Map<number, boolean>()
  const preNames = new Map<string, boolean>()
  for (const group of groups) {
    for (const id of Array.isArray(group.rowIds) ? group.rowIds : []) pstoNames.set(Number(id), group.useSystemName === true)
    for (const position of list(group.positions)) preNames.set(`${position.rowId}:${position.methodCode}`, group.useSystemName === true)
  }
  return (entity, before, after, key) => {
    if (!known) return undefined // New/unclassified workflows stay neutral, never guessed.
    if (technical.has(key) || resultIsAutomatic(key, before, after)) return 'automatic'
    const row = after ?? before ?? {}
    if (fill && entity === 'pre_heat_treatment_controls') {
      const action = key.startsWith('request') ? 'request' : 'result'
      const override = object(object(fillOptions.overrides)[`${row.weldJointId}:${action}:${action === 'request' ? 'all' : row.method}`])
      if (key === 'result') return 'user'
      if (key.endsWith('Name')) return override.name !== undefined ? 'user' : 'automatic'
      if (key.endsWith('Date')) return override.date !== undefined ? 'user' : 'automatic'
      return 'automatic'
    }
    if (operation === 'savePreHeatTreatmentFill') return entity === 'generated_documents' && key === 'specialists' ? 'user' : 'automatic'
    if (preBatch) {
      if (entity === 'weld_joints' && key === 'preHeatTreatmentRequired') return 'user'
      if (entity === 'generated_documents' && key === 'specialists' && fill) return 'user'
      return 'automatic'
    }
    if (entity === 'generated_documents' && key === 'specialists' && list(object(data.documentGrouping).specialists).length) return 'user'
    if (weldSave) {
      if (entity === 'weld_joints' && key === 'preHeatTreatmentRequired' && object(data.newPreHeatTreatmentChoice).required === true) return 'user'
      if (entity === 'weld_joints' && key === 'preHeatTreatmentRequired' && typeof object(data.preHeatTreatmentConfirmation).required === 'boolean') return Number(row.id) === Number(data.id) ? 'user' : 'automatic'
      if (entity !== 'weld_joints' || key === 'hasVik') return 'automatic'
      if (key === 'revisionActuality' && ['updateWeldJoint', 'moveWeldJointChain'].includes(operation) &&
        object(data.chainActualityConfirmation).confirmed === true) return 'user'
      if (!after && removed.has(Number(row.id))) return 'user'
      const submitted = byId.get(Number(row.id)) ?? (!before ? byIdentity.get(jointIdentity(row)) : undefined)
      if (!submitted) return 'automatic'
      if (!scope.has(key) || !Object.hasOwn(submitted, key)) return 'automatic'
      if (generatedNames.get(key)?.has(submitted[key])) return 'automatic'
      // A full editor snapshot can carry a value inherited from another line.
      // Only an accepted submitted value is a direct edit, not the server's replacement.
      if (!sameSubmittedValue(submitted[key], row[key])) return 'automatic'
      // The snapshot may already contain a client-calculated WDI. Use the mode
      // actually read by server validation, never infer manual entry from equality.
      if (key === 'wdi') return settings.auditWdiSystem === true ? 'automatic' : settings.auditWdiSystem === false ? 'user' : undefined
      return 'user'
    }
    if (weldDelete) return entity === 'weld_joints' ? 'user' : 'automatic'
    if (operation === 'createWeldJoints') return entity === 'weld_joints' && !before && key === 'joint' ? 'user' : 'automatic'
    if (psto) {
      if (entity !== 'weld_joints' && entity !== 'psto_repeat_cycles') return 'automatic'
      const action = String(data.stage ?? data.action ?? (operation === 'correctPstoTvmtAndRemoveLaterCycles' ? 'tvmtResult' : ''))
      if (!stageFields[action]?.has(key)) return 'automatic'
      if (data.rowId != null && (Number(entity === 'weld_joints' ? row.id : row.weldJointId) !== Number(data.rowId) || Number(entity === 'weld_joints' ? 1 : row.sequence) !== Number(data.sequence))) return 'automatic'
      if (['pstoRequest', 'heatTreatmentDiagram', 'tvmtRequest', 'tvmtConclusion'].includes(key) && pstoNames.get(Number(entity === 'weld_joints' ? row.id : row.weldJointId))) return 'automatic'
      return 'user'
    }
    if (pre) {
      if (entity !== 'pre_heat_treatment_controls') return 'automatic'
      const action = operation === 'savePreHeatTreatmentLnkWorkflow' ? String(data.action) : String(data.stage ?? 'result')
      const allowed = operation === 'updatePreHeatTreatmentRkExposure' ? exposureFields : operation === 'savePreHeatTreatmentLnkResultEdits' ? resultOnlyFields : preStageFields[action]
      if (!allowed?.has(key)) return 'automatic'
      if (['requestName', 'conclusionName'].includes(key) && preNames.get(`${row.weldJointId}:${row.method}`)) return 'automatic'
      return 'user'
    }
    if (documentEdit) {
      if (entity === 'generated_documents') return (operation === 'assignDocumentSpecialists' ? key === 'specialists' : ['periodFrom', 'periodTo'].includes(key)) ? 'user' : 'automatic'
      if (operation === 'changeSystemDocumentDate' && ['weld_joints', 'psto_repeat_cycles', 'pre_heat_treatment_controls'].includes(entity) && documentDateFields.has(key)) return 'user'
      return 'automatic'
    }
    if (operation === 'updateLnkDefectDescription' && data.stage === 'beforeHeatTreatment') return entity === 'pre_heat_treatment_controls' && key === 'defectDescription' ? 'user' : 'automatic'
    if (direct) return entity === 'weld_joints' && direct.has(key) ? 'user' : 'automatic'
    return simple?.includes(entity) ? 'user' : 'automatic'
  }
}
function getDocumentDateFields(reference: Row): Set<string> {
  if (reference.type === 'pstoRequest') return fields('pstoRequestDate')
  if (reference.type === 'pstoConclusion') return fields('pstoDate')
  const request = reference.type === 'lnkRequest'
  if (!request && reference.type !== 'lnkConclusion') return new Set()
  if (reference.sourceKind === 'beforeHeatTreatment') return fields(request ? 'requestDate' : 'conclusionDate')
  return new Set(ALL_LNK_FIELD_METHODS.filter(method => reference.methodCode ? method.code === reference.methodCode : method.code !== 'ТВМТ')
    .map(method => request ? method.requestDateKey : method.conclusionDateKey))
}
function jointIdentity(row: Row) {
  return JSON.stringify(['projectTitle', 'subtitleCode', 'line', 'joint'].map(key => String(row[key] ?? '').trim()))
}

function sameSubmittedValue(submitted: unknown, saved: unknown): boolean {
  if (submitted == null || submitted === '') return saved == null || saved === ''
  if (typeof saved === 'number') return Number.isFinite(Number(submitted)) && Number(submitted) === saved
  if (submitted instanceof Date) return submitted.toISOString().slice(0, 10) === saved
  if (typeof submitted === 'object' || typeof saved === 'object') return JSON.stringify(submitted) === JSON.stringify(saved)
  return String(submitted).trim() === String(saved ?? '').trim()
}
