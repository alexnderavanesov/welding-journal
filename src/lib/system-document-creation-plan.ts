import type { WeldRow } from '@/lib/dispatcher-types'
import { ALL_LNK_FIELD_METHODS } from '@/lib/lnk-report-config'
import {
  addRowsToNamingPatternContext,
  buildSystemNameWithNumber,
  getRequestConclusionNamingKind,
  getPstoConclusionDateParts,
  type RequestConclusionSettings,
} from '@/lib/request-conclusion-settings'
import type { RequestNamingState } from '@/lib/request-naming-state'
import {
  buildSystemDocumentSplitGroups,
  getSystemDocumentSplitMissingSummary,
  getSystemDocumentSplitSettingId,
  type SystemDocumentSplitGroup,
  type SystemDocumentSplitMode,
} from '@/lib/system-document-splitting'
import type { SystemDocumentType } from '@/lib/system-document-types'
import { getDraftSpecialists, getSpecialistDocumentProfile, type SpecialistSelection } from './document-specialists'

export type SystemDocumentCreationGroup = {
  specialists?: SpecialistSelection
  specialistDefaults?: SpecialistSelection
  key: string
  label: string
  rowIds: number[]
  rows: WeldRow[]
  name: string
  useSystemName: boolean
  isMissingValueFallback: boolean
  splitMode?: SystemDocumentSplitMode
  splitSettingId?: ReturnType<typeof getSystemDocumentSplitSettingId>
  positions?: SystemDocumentCreationPosition[]
  membership?: string
  requiresNameReview?: boolean
}

export type SystemDocumentCreationPosition = { rowId: number; method: string; stage: string; cycle?: number; source?: string }

export type SystemDocumentCreationPlan = {
  type: SystemDocumentType
  date?: string
  sourceKind?: 'beforeHeatTreatment'
  methodCode?: string
  mode: SystemDocumentSplitMode
  groups: SystemDocumentCreationGroup[]
  missingSummary: string
  error: string
  documentCount?: number
}

export type SystemDocumentCreationPartition = {
  key: string
  label: string
}

export function buildSystemDocumentCreationPlan({
  type,
  sourceKind,
  methodCode,
  date,
  rows,
  naming,
  settings,
  nextNumber,
  partitionBy,
  positionDetails,
}: {
  type: SystemDocumentType
  sourceKind?: 'beforeHeatTreatment'
  methodCode?: string
  date: string
  rows: WeldRow[]
  naming: RequestNamingState
  settings: RequestConclusionSettings
  nextNumber?: number
  partitionBy?: (row: WeldRow) => SystemDocumentCreationPartition
  positionDetails?: (row: WeldRow) => Array<Omit<SystemDocumentCreationPosition, 'rowId'>>
}): SystemDocumentCreationPlan {
  const settingId = getSystemDocumentSplitSettingId({ type, methodCode })
  const mode = naming.splitModes?.[settingId] ?? settings.splitModes[settingId]
  const splitGroups = partitionSystemDocumentSplitGroups(
    buildSystemDocumentSplitGroups(rows, mode),
    partitionBy,
  )
  const manualMembers = new Map<string, string>()
  const manualRows = new Set<number>()
  for (const [key, members] of Object.entries(naming.customGroupMembers ?? {})) {
    if ((naming.groupModes?.[key] ?? naming.mode) !== 'custom') continue
    manualMembers.set(members, naming.customGroupNames?.[key] ?? naming.customName)
    try {
      for (const position of JSON.parse(members) as unknown[]) if (Array.isArray(position) && typeof position[0] === 'number') manualRows.add(position[0])
    } catch { /* Old drafts have no reusable exact-position identity. */ }
  }
  let systemGroupIndex = 0
  const groups = splitGroups.map((group) => {
    const positions = group.rows.flatMap(row => (positionDetails?.(row) ?? [{ method: methodCode ?? (type.startsWith('psto') ? 'ПСТО' : ''), stage: type.startsWith('psto') || methodCode === 'ТВМТ' ? 'Цикл ПСТО' : 'Основной контроль', ...(type.startsWith('psto') || methodCode === 'ТВМТ' ? { cycle: 1 } : {}) }]).map(position => ({ ...position, source: position.source ?? creationSource(row, type, position.method), rowId: row.id })))
    const membership = JSON.stringify(positions.map(p => [p.rowId, p.method, p.stage, p.cycle ?? null, p.source ?? '']).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
    // A regrouped manual draft requires review; it must not silently become
    // system-named simply because its grouping key has changed.
    const inheritedManual = naming.mode === 'custom' || group.rowIds.some(id => manualRows.has(id))
    const useSystemName = (naming.groupModes?.[group.key] ?? (inheritedManual ? 'custom' : 'system')) === 'system'
    return {
    key: group.key,
    label: group.label,
    rowIds: group.rowIds,
    rows: group.rows,
    name: buildGroupName({
      type,
      sourceKind,
      methodCode,
      date,
      group,
      groupIndex: useSystemName ? systemGroupIndex++ : 0,
      groupCount: splitGroups.length,
      naming,
      settings,
      nextNumber,
      membership,
      useSystemName,
      matchingManualName: manualMembers.get(membership),
    }),
    useSystemName,
    isMissingValueFallback: group.isMissingValueFallback,
    splitMode: mode,
    splitSettingId: settingId,
    positions,
    membership,
    ...(getSpecialistDocumentProfile(type, methodCode) ? { specialists: getDraftSpecialists(naming.specialists, membership), specialistDefaults: naming.specialists?.common } : {}),
    requiresNameReview: !useSystemName && group.rowIds.some(id => manualRows.has(id)) && !manualMembers.has(membership),
    }
  })
  return {
    type,
    date,
    sourceKind,
    ...(methodCode ? { methodCode } : {}),
    mode,
    groups,
    documentCount: groups.length,
    missingSummary: getSystemDocumentSplitMissingSummary(splitGroups),
    error: naming.groupingDefaultsState === 'loading' ? 'Загружаем актуальные правила документов…'
      : naming.groupingDefaultsState === 'error' ? 'Не удалось загрузить правила документов. Повторите загрузку рядом с разделением.'
      : getCreationPlanError(groups),
  }
}

function partitionSystemDocumentSplitGroups(
  groups: SystemDocumentSplitGroup<WeldRow>[],
  partitionBy?: (row: WeldRow) => SystemDocumentCreationPartition,
) {
  if (!partitionBy) return groups
  return groups.flatMap((group) => {
    const partitions = new Map<string, {
      partition: SystemDocumentCreationPartition
      rows: WeldRow[]
    }>()
    for (const row of group.rows) {
      const partition = partitionBy(row)
      const current = partitions.get(partition.key) ?? { partition, rows: [] }
      current.rows.push(row)
      partitions.set(partition.key, current)
    }
    const entries = [...partitions.values()]
    return entries.map(({ partition, rows }) => ({
      ...group,
      key: `${group.key}::${partition.key}`,
      label: entries.length > 1 ? `${group.label} · ${partition.label}` : group.label,
      rowIds: rows.map((row) => row.id),
      rows,
    }))
  })
}

function buildGroupName({
  type,
  sourceKind,
  methodCode,
  date,
  group,
  groupIndex,
  groupCount,
  naming,
  settings,
  nextNumber,
  membership,
  useSystemName,
  matchingManualName,
}: {
  type: SystemDocumentType
  sourceKind?: 'beforeHeatTreatment'
  methodCode?: string
  date: string
  group: SystemDocumentSplitGroup<WeldRow>
  groupIndex: number
  groupCount: number
  naming: RequestNamingState
  settings: RequestConclusionSettings
  nextNumber?: number
  membership: string
  useSystemName: boolean
  matchingManualName?: string
}) {
  if (!useSystemName) {
    const expectedMembers = naming.customGroupMembers?.[group.key]
    if (expectedMembers && expectedMembers !== membership) return ''
    if (Object.hasOwn(naming.customGroupNames ?? {}, group.key)) return String(naming.customGroupNames![group.key]).trim()
    if (matchingManualName !== undefined) return matchingManualName.trim()
    if (groupCount > 1) {
      return String(naming.customGroupNames?.[group.key] ?? '').trim()
    }
    return Object.keys(naming.customGroupMembers ?? {}).length ? '' : naming.customName.trim()
  }

  const baseContext = type === 'pstoConclusion'
    ? getPstoConclusionDateParts(date)
    : {
        date: date ? new Date(`${date}T00:00:00`) : new Date(),
        ...(methodCode ? { methodCode } : {}),
      }
  const pattern = settings[getRequestConclusionNamingKind({ type, methodCode, sourceKind })].systemPattern
  const preview = naming.systemGroupNames?.[group.key]
  if (preview?.signature === systemNamePreviewSignature({ type, sourceKind, methodCode, date }, { membership, rows: group.rows }, pattern)) return preview.name
  return buildSystemNameWithNumber(
    pattern,
    addRowsToNamingPatternContext(baseContext, group.rows),
    Math.max(1, Math.floor(nextNumber ?? 1)) + groupIndex,
  )
}

export function systemNamePreviewSignature(plan: Pick<SystemDocumentCreationPlan, 'type' | 'sourceKind' | 'methodCode' | 'date'>, group: { membership?: string; rows: WeldRow[] }, pattern: string) {
  const context = addRowsToNamingPatternContext({ date: new Date(0) }, group.rows)
  return JSON.stringify([plan.type, plan.sourceKind, plan.methodCode, plan.date, pattern, group.membership, context.projectTitle, context.subtitleCode, context.line])
}

function creationSource(row: WeldRow, type: SystemDocumentType, method: string): string | undefined {
  if (type === 'pstoConclusion') return String(row.pstoRequest ?? '') || undefined
  if (type !== 'lnkConclusion') return undefined
  const field = ALL_LNK_FIELD_METHODS.find(candidate => candidate.code === method)?.requestKey
  return field ? String(row[field] ?? '') || undefined : undefined
}

function getCreationPlanError(
  groups: SystemDocumentCreationGroup[],
) {
  if (groups.length === 0) return ''
  if (groups.some((group) => group.isMissingValueFallback)) {
    return 'Заполните поля, необходимые для выбранного разделения.'
  }
  if (groups.some(group => group.requiresNameReview && !group.name.trim())) return 'Состав изменился. Проверьте названия новых групп перед сохранением.'
  if (groups.some((group) => !group.name.trim())) {
    return 'Укажите название для каждого создаваемого документа.'
  }
  const normalizedNames = groups.map((group) => group.name.trim().toLocaleLowerCase('ru-RU'))
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    return 'Названия создаваемых документов должны различаться.'
  }
  return ''
}
