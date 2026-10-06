import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import type { WeldInput } from '@/lib/weld-fields'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import { formatDisplayDate, getDateInputValidationReason, parseDateLikeToIso } from '@/lib/date-format'
import {
  hasPstoExecutionHistory,
} from '@/lib/psto-cycle'
import {
  isPreHeatTreatmentLnkMethodCode,
  type PreHeatTreatmentControlRecord,
  type PreHeatTreatmentLnkMethodCode,
} from '@/lib/lnk-control-stage'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { getPstoTvmtWorkflowState } from '@/lib/tvmt-cycle'
import { isPreHeatTreatmentStageEnabled } from '@/lib/pre-heat-treatment-policy'
import { getUnofficialLnkGoodResultReason } from './unofficial-lnk-result-guard'
import { buildPreHeatTreatmentToPrimaryTransfer, hasPrimaryLnkStageTrace } from './lnk-stage-transfer'

export type PstoLineIdentity = {
  projectTitle: string
  subtitleCode: string
  line: string
}

type PstoLineIdentityInput = {
  projectTitle?: unknown
  subtitleCode?: unknown
  line?: unknown
}

export type PstoLineRemovalDisposition = 'keepPrimary' | 'promoteBeforeHeatTreatment'
export type PstoLineActivationDisposition = 'keepPrimary' | 'movePrimaryToBeforeHeatTreatment'
export type PstoWeldLineMoveDisposition =
  | PstoLineRemovalDisposition
  | 'movePrimaryToBeforeHeatTreatment'
export type PstoWeldLineMoveDecision = {
  rowId: number
  disposition: PstoWeldLineMoveDisposition
}
export type WeldChainLineMovePlan = {
  expectedRowIds: number[]
  expectedVersions: WeldRowVersionTarget[]
  decisions: PstoWeldLineMoveDecision[]
}
export type PstoLineAssignmentAction = 'assign' | 'remove' | 'cancel' | 'reactivate'
export type PstoLineAssignmentState = 'assigned' | 'cancelled' | 'unassigned' | 'mixed'

export type PstoLineActivationDecision = {
  rowId: number
  disposition: PstoLineActivationDisposition
  methodCodes: PreHeatTreatmentLnkMethodCode[]
}

export type PstoLineAssignmentSummary = PstoLineIdentity & {
  key: string
  rowCount: number
  assignedCount: number
  cancelledCount: number
  historyRowCount: number
  preControlCount: number
  repeatCycleCount: number
}

export type PstoLineAssignmentFilter = 'all' | 'assigned' | 'cancelled' | 'unassigned' | 'partial'

export type PstoLineAssignmentPageRequest = {
  search?: string
  filter?: PstoLineAssignmentFilter
  page?: number
  pageSize?: number
}

export type PstoLineAssignmentPageResult = {
  rows: PstoLineAssignmentSummary[]
  totalCount: number
  page: number
  pageSize: number
  pageCount: number
  counts: Record<PstoLineAssignmentFilter, number>
}

export type PstoLineRemovalPreviewRow = {
  rowId: number
  joint: string
  spool: string
  preMethods: PreHeatTreatmentLnkMethodCode[]
  promotablePreMethods: PreHeatTreatmentLnkMethodCode[]
  pendingPreMethods: PreHeatTreatmentLnkMethodCode[]
  primaryMethods: PreHeatTreatmentLnkMethodCode[]
  pstoRequest: string
  pstoResult: string
  repeatCycleCount: number
  preservesPerformedHistory: boolean
  blocksActivation: boolean
  activationTransferBlockedMethods: PreHeatTreatmentLnkMethodCode[]
  activationTransferBlockedReason?: string | null
  promotionBlockedReason?: string | null
}

export type PstoWeldLineMovePreviewRow = PstoLineRemovalPreviewRow & {
  requiresDisposition: boolean
}

export type PstoLineRemovalPreview = {
  identity: PstoLineIdentity
  expectedVersions: WeldRowVersionTarget[]
  rowCount: number
  assignedCount: number
  historyRowCount: number
  requestOnlyCount: number
  completedPstoCount: number
  preControlCount: number
  completedPreControlCount: number
  pendingPreControlCount: number
  repeatCycleCount: number
  rows: PstoLineRemovalPreviewRow[]
}

export type PstoWeldLineMovePreview = {
  sourceIdentity: PstoLineIdentity
  targetIdentity: PstoLineIdentity
  targetState: 'assigned' | 'unassigned' | 'cancelled'
  rootRowId: number
  rootJoint: string
  isChainMove: boolean
  expectedRowIds: number[]
  expectedVersions: WeldRowVersionTarget[]
  requestOnlyCount: number
  completedPstoCount: number
  preControlCount: number
  completedPreControlCount: number
  pendingPreControlCount: number
  repeatCycleCount: number
  rows: PstoWeldLineMovePreviewRow[]
  row: PstoWeldLineMovePreviewRow
}

const PRIMARY_PSTO_DOCUMENT_KEYS = [
  'pstoRequest',
  'pstoRequestDate',
  'pstoDate',
  'heatTreatmentDiagram',
  'pstoNote',
  'tvmtRequest',
  'tvmtRequestDate',
  'tvmtConclusionDate',
  'tvmtConclusion',
] as const satisfies readonly (keyof WeldRow)[]

const PRIMARY_PSTO_WORKFLOW_KEYS = [
  'pstoRequest',
  'pstoRequestDate',
  'pstoDate',
  'heatTreatmentDiagram',
  'pstoNote',
  'tvmtRequest',
  'tvmtRequestDate',
  'tvmtConclusionDate',
  'tvmtConclusion',
] as const satisfies readonly (keyof WeldRow)[]

export function normalizePstoLineIdentity(value: PstoLineIdentityInput): PstoLineIdentity {
  return {
    projectTitle: normalizeText(value.projectTitle),
    subtitleCode: normalizeText(value.subtitleCode),
    line: normalizeText(value.line),
  }
}

export function getPstoLineIdentityKey(value: PstoLineIdentityInput) {
  const identity = normalizePstoLineIdentity(value)
  return JSON.stringify([
    normalizePstoLineIdentityPart(identity.projectTitle),
    normalizePstoLineIdentityPart(identity.subtitleCode),
    normalizePstoLineIdentityPart(identity.line),
  ])
}

export function normalizePstoLineIdentityPart(value: unknown) {
  return normalizeText(value).toLocaleLowerCase('ru-RU')
}

export function buildPstoRemovedRow(row: WeldRow): WeldRow {
  return {
    ...row,
    pstoRequired: null,
    pstoControlBasis: null,
    pstoCancellationDate: null,
  } as WeldRow
}

export function buildPstoAssignedKeepPrimaryValidationRow(row: WeldRow): WeldRow {
  return {
    ...row,
    pstoRequired: 'да',
    pstoControlBasis: null,
    pstoCancellationDate: null,
  }
}

export function buildPstoMovedToUnassignedLineRow({
  row,
  controls,
  disposition,
}: {
  row: WeldRow
  controls: readonly PreHeatTreatmentControlRecord[]
  disposition: PstoLineRemovalDisposition
}): WeldRow {
  const next = buildPstoMovedToCancelledLineRow({
    row,
    controls,
    disposition,
    cancellationDate: '',
    cancellationBasis: '',
  })
  return {
    ...next,
    pstoRequired: null,
    pstoControlBasis: null,
    pstoCancellationDate: null,
  } as WeldRow
}

/** Official cancellation changes the decision only; every stage stays in its original place. */
export function buildPstoCancelledRow({ row, cancellationDate, cancellationBasis }: {
  row: WeldRow; cancellationDate: string; cancellationBasis: string
  controls?: readonly PreHeatTreatmentControlRecord[]; disposition?: PstoLineRemovalDisposition
}): WeldRow {
  return { ...row, pstoRequired: 'отменен', pstoCancellationDate: cancellationDate, pstoControlBasis: cancellationBasis || null }
}

/** Explicit line-move stage resolution is a separate operation, not ordinary cancellation. */
export function buildPstoMovedToCancelledLineRow({
  row,
  controls,
  disposition,
  cancellationDate,
  cancellationBasis,
}: {
  row: WeldRow
  controls: readonly PreHeatTreatmentControlRecord[]
  disposition: PstoLineRemovalDisposition
  cancellationDate: string
  cancellationBasis: string
}): WeldRow {
  const next = {
    ...row,
    pstoRequired: 'отменен',
    pstoCancellationDate: cancellationDate,
    pstoControlBasis: cancellationBasis || null,
    preHeatTreatmentControls: [...controls],
  } as WeldRow
  if (disposition !== 'promoteBeforeHeatTreatment') return next
  const reason = getPstoLineMovePromotionBlockReason(next)
  if (reason) throw new Error(reason)
  const [transferred] = buildPreHeatTreatmentToPrimaryTransfer({ rows: [next], controls: [...controls] })
  return { ...transferred!, preHeatTreatmentControls: [] }
}

/** A line move never overwrites an existing method or discards request-only controls. */
export function getPstoLineMovePromotionBlockReason(row: WeldRow): string | null {
  if (hasPerformedPstoHistory(row)) return 'ПСТО уже выполнено: сохраните исходные этапы и историю контроля.'
  const controls = row.preHeatTreatmentControls ?? []
  if (!controls.length) return 'Нет комплекта НК до ТО для переноса.'
  const officiality = getPstoStageTransferOfficialityBlockReason(row, 'primary')
  if (officiality) return officiality
  for (const control of controls) {
    const method = normalizeText(control.method).toLocaleUpperCase('ru-RU')
    if (!isPreHeatTreatmentLnkMethodCode(method)) return `Неизвестный метод НК до ТО: ${method}. Сначала исправьте историю.`
    if (hasPrimaryLnkStageTrace(row, method)) return `Основной комплект ${method} уже заполнен. Сначала отдельно исправьте документы или сохраните этапы без изменений.`
  }
  return null
}

/** The line-move/line-activation choices obey the same stage-transfer rule as
 * document management, even when the destination primary set is empty. */
export function getPstoStageTransferOfficialityBlockReason(row: WeldRow, target: 'primary' | 'beforeHeatTreatment') {
  const facts = target === 'primary'
    ? (row.preHeatTreatmentControls ?? []).filter(hasCompletedPreHeatTreatmentResult)
      .map(control => ({ result: control.result, method: String(control.method) }))
    : LNK_METHODS.map(method => ({ result: row[method.resultKey], method: `${method.code} до ТО` }))
  for (const fact of facts) {
    const reason = getUnofficialLnkGoodResultReason(row, fact.result, null, fact.method)
    if (reason) return reason
  }
  return null
}

export function hasPerformedPstoHistory(row: WeldInput) {
  return hasPstoExecutionHistory(row)
}

export function isPstoCancelledValue(value: unknown) {
  return normalizeText(value).toLocaleLowerCase('ru-RU') === 'отменен'
}

export function getPstoLineAssignmentState(
  rows: readonly Pick<WeldInput, 'pstoRequired'>[],
): PstoLineAssignmentState {
  if (rows.length === 0) return 'unassigned'
  if (rows.every((row) => isControlEnabledValue(row.pstoRequired))) return 'assigned'
  if (rows.every((row) => isPstoCancelledValue(row.pstoRequired))) return 'cancelled'
  if (rows.every((row) => !isControlEnabledValue(row.pstoRequired) && !isPstoCancelledValue(row.pstoRequired))) {
    return 'unassigned'
  }
  return 'mixed'
}

export function assertPstoLineAssignmentActionAllowed(
  action: PstoLineAssignmentAction,
  state: PstoLineAssignmentState,
) {
  if (action === 'assign') {
    if (state === 'assigned') {
      throw new Error('ПСТО уже назначено на всю линию. Обновите программу ПСТО.')
    }
    if (state === 'cancelled') {
      throw new Error('ПСТО на линии уже официально отменено. Для повторного назначения используйте «Возобновить».')
    }
    return
  }
  if (action === 'reactivate') {
    if (state !== 'cancelled') {
      throw new Error('Возобновление доступно только для полностью отмененной линии ПСТО. Обновите программу ПСТО.')
    }
    return
  }
  if (state !== 'assigned') {
    throw new Error(
      action === 'remove'
        ? 'Ошибочное назначение можно убрать только с полностью назначенной линии. Обновите программу ПСТО.'
        : 'Официальную отмену можно оформить только для полностью назначенной линии. Обновите программу ПСТО.',
    )
  }
}

export function getPreHeatTreatmentMethodCodes(
  controls: readonly PreHeatTreatmentControlRecord[],
) {
  return [...new Set(controls.flatMap((control) => {
    const methodCode = normalizeText(control.method).toLocaleUpperCase('ru-RU')
    return isPreHeatTreatmentLnkMethodCode(methodCode) ? [methodCode] : []
  }))].sort(comparePreMethods)
}

export function getCompletedPreHeatTreatmentMethodCodes(
  controls: readonly PreHeatTreatmentControlRecord[],
) {
  return getPreHeatTreatmentMethodCodes(controls.filter(hasCompletedPreHeatTreatmentResult))
}

export function getPendingPreHeatTreatmentMethodCodes(
  controls: readonly PreHeatTreatmentControlRecord[],
) {
  return getPreHeatTreatmentMethodCodes(controls.filter((control) => !hasCompletedPreHeatTreatmentResult(control)))
}

export function hasCompletedPreHeatTreatmentResult(control: PreHeatTreatmentControlRecord) {
  const result = normalizeText(control.result).toLocaleLowerCase('ru-RU')
  return result === 'годен' || result === 'ремонт' || result === 'вырез'
}

export function getPrimaryStagedMethodCodes(row: WeldRow) {
  return LNK_METHODS.flatMap((method) => {
    if (!isPreHeatTreatmentLnkMethodCode(method.code)) return []
    const values: unknown[] = [
      row[method.requestKey],
      row[method.requestDateKey],
      row[method.conclusionDateKey],
      row[method.conclusionKey],
    ]
    if (isFinalLnkResult(row[method.resultKey])) values.push(row[method.resultKey])
    values.push(row[method.defectDescriptionKey])
    if (method.code === 'РК') {
      values.push(row.rkExposureConfirmedDiameter)
    }
    return values.some(hasText) ? [method.code] : []
  }).sort(comparePreMethods)
}

export function requiresPrimaryStageResolutionForAssignedPstoLine(row: WeldRow) {
  return (
    isPreHeatTreatmentStageEnabled(row) &&
    !isControlEnabledValue(row.pstoRequired) &&
    !hasPstoWorkflowStageData(row) &&
    getPrimaryStagedMethodCodes(row).length > 0
  )
}

export function blocksPstoLineActivation(row: WeldRow) {
  if (!isPreHeatTreatmentStageEnabled(row)) return false
  if (isControlEnabledValue(row.pstoRequired)) return false
  if (getPrimaryStagedMethodCodes(row).length === 0) return false
  const reactivatedRow = {
    ...row,
    pstoRequired: 'да',
    pstoCancellationDate: null,
    pstoControlBasis: null,
  } as WeldRow
  return getPstoTvmtWorkflowState(reactivatedRow) !== 'complete'
}

export function getPstoLineActivationBlockReason(rows: readonly WeldRow[]) {
  const blockedRows = rows.filter(blocksPstoLineActivation)
  if (blockedRows.length === 0) return ''
  const visibleJoints = blockedRows.slice(0, 8).map((row) => normalizeText(row.joint) || `ID ${row.id}`)
  const hiddenCount = blockedRows.length - visibleJoints.length
  const jointList = `${visibleJoints.join(', ')}${hiddenCount > 0 ? ` и еще ${hiddenCount}` : ''}`
  return (
    `У стыков ${jointList} уже есть основной комплект ЛНК. ` +
    'Выберите: сохранить его как фактический контроль после ТО и позднее оформить отдельный НК до ТО ' +
    'либо перенести комплект в «НК до ТО», если он был записан не на тот этап.'
  )
}

export function hasPstoWorkflowStageData(row: WeldInput) {
  const hydrated = row as WeldInput & {
    preHeatTreatmentControls?: unknown[]
    pstoRepeatCycles?: unknown[]
  }
  return (
    PRIMARY_PSTO_WORKFLOW_KEYS.some((key) => hasText(row[key])) ||
    isCompletedPstoResult(row.pstoResult) ||
    hasFinalTvmtResult(row.tvmtResult) ||
    (hydrated.preHeatTreatmentControls?.length ?? 0) > 0 ||
    (hydrated.pstoRepeatCycles?.length ?? 0) > 0
  )
}

export function hasPrimaryPstoHistory(row: WeldInput) {
  return (
    PRIMARY_PSTO_DOCUMENT_KEYS.some((key) => hasText(row[key])) ||
    isCompletedPstoResult(row.pstoResult) ||
    hasFinalTvmtResult(row.tvmtResult)
  )
}

export function hasPstoLifecycleData(row: WeldInput) {
  const hydrated = row as WeldInput & {
    preHeatTreatmentControls?: unknown[]
    pstoRepeatCycles?: unknown[]
  }
  return (
    hasPrimaryPstoHistory(row) ||
    (hydrated.preHeatTreatmentControls?.length ?? 0) > 0 ||
    (hydrated.pstoRepeatCycles?.length ?? 0) > 0
  )
}

export function getLatestPstoLifecycleEventDate(row: WeldInput) {
  const hydrated = row as WeldInput & {
    preHeatTreatmentControls?: PreHeatTreatmentControlRecord[]
    pstoRepeatCycles?: Array<{
      pstoRequestDate?: unknown
      pstoDate?: unknown
      tvmtRequestDate?: unknown
      tvmtConclusionDate?: unknown
    }>
  }
  return [
    row.pstoRequestDate,
    row.pstoDate,
    row.tvmtRequestDate,
    row.tvmtConclusionDate,
    ...(hydrated.preHeatTreatmentControls ?? []).flatMap((control) => [
      control.requestDate,
      control.conclusionDate,
    ]),
    ...(hydrated.pstoRepeatCycles ?? []).flatMap((cycle) => [
      cycle.pstoRequestDate,
      cycle.pstoDate,
      cycle.tvmtRequestDate,
      cycle.tvmtConclusionDate,
    ]),
  ]
    .map(parseDateLikeToIso)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? ''
}

export function assertPstoCancellationDateAfterHistory(
  rows: readonly WeldInput[],
  cancellationDate: string,
) {
  const normalizedCancellationDate = parseDateLikeToIso(cancellationDate)
  if (!normalizedCancellationDate) {
    throw new Error('Укажите корректную дату решения об отмене ПСТО.')
  }
  const dateReason = getDateInputValidationReason(
    normalizedCancellationDate,
    'Дата решения об отмене ПСТО',
  )
  if (dateReason) throw new Error(dateReason)
  const latest = rows
    .map(getLatestPstoLifecycleEventDate)
    .filter(Boolean)
    .sort()
    .at(-1)
  if (latest && normalizedCancellationDate < latest) {
    throw new Error(`Дата решения об отмене ПСТО (${formatDisplayDate(normalizedCancellationDate)}) не может быть раньше последнего сохраненного события (${formatDisplayDate(latest)}).`)
  }
}

function comparePreMethods(left: PreHeatTreatmentLnkMethodCode, right: PreHeatTreatmentLnkMethodCode) {
  const order: PreHeatTreatmentLnkMethodCode[] = ['ВИК', 'РК', 'УЗК', 'ПВК']
  return order.indexOf(left) - order.indexOf(right)
}

function hasText(value: unknown) {
  return normalizeText(value).length > 0
}

function isCompletedPstoResult(value: unknown) {
  const result = normalizeText(value).toLocaleLowerCase('ru-RU')
  return result === 'проведено' || result === 'проведено (отменен)' || result === 'да'
}

function hasFinalTvmtResult(value: unknown) {
  const result = normalizeText(value).toLocaleLowerCase('ru-RU')
  return Boolean(result) && !result.startsWith('ожидает')
}

function isFinalLnkResult(value: unknown) {
  const result = normalizeText(value).toLocaleLowerCase('ru-RU')
  return result === 'годен' || result === 'ремонт' || result === 'вырез'
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}
