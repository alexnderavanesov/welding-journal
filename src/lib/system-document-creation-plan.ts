import type { WeldRow } from '@/lib/dispatcher-types'
import {
  addRowsToNamingPatternContext,
  buildSystemNameWithNumber,
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

export type SystemDocumentCreationGroup = {
  key: string
  label: string
  rowIds: number[]
  rows: WeldRow[]
  name: string
  useSystemName: boolean
  isMissingValueFallback: boolean
}

export type SystemDocumentCreationPlan = {
  type: SystemDocumentType
  methodCode?: string
  mode: SystemDocumentSplitMode
  groups: SystemDocumentCreationGroup[]
  missingSummary: string
  error: string
}

export function buildSystemDocumentCreationPlan({
  type,
  methodCode,
  date,
  rows,
  naming,
  settings,
  nextNumber,
  allowAllNamesEmpty = false,
}: {
  type: SystemDocumentType
  methodCode?: string
  date: string
  rows: WeldRow[]
  naming: RequestNamingState
  settings: RequestConclusionSettings
  nextNumber?: number
  allowAllNamesEmpty?: boolean
}): SystemDocumentCreationPlan {
  const settingId = getSystemDocumentSplitSettingId({ type, methodCode })
  const mode = settings.splitModes[settingId]
  const splitGroups = buildSystemDocumentSplitGroups(rows, mode)
  const groups = splitGroups.map((group, index) => ({
    key: group.key,
    label: group.label,
    rowIds: group.rowIds,
    rows: group.rows,
    name: buildGroupName({
      type,
      methodCode,
      date,
      group,
      groupIndex: index,
      groupCount: splitGroups.length,
      naming,
      settings,
      nextNumber,
    }),
    useSystemName: naming.mode === 'system',
    isMissingValueFallback: group.isMissingValueFallback,
  }))
  return {
    type,
    ...(methodCode ? { methodCode } : {}),
    mode,
    groups,
    missingSummary: getSystemDocumentSplitMissingSummary(splitGroups),
    error: getCreationPlanError(groups, allowAllNamesEmpty),
  }
}

function buildGroupName({
  type,
  methodCode,
  date,
  group,
  groupIndex,
  groupCount,
  naming,
  settings,
  nextNumber,
}: {
  type: SystemDocumentType
  methodCode?: string
  date: string
  group: SystemDocumentSplitGroup<WeldRow>
  groupIndex: number
  groupCount: number
  naming: RequestNamingState
  settings: RequestConclusionSettings
  nextNumber?: number
}) {
  if (naming.mode === 'custom') {
    if (groupCount > 1) {
      return String(naming.customGroupNames?.[group.key] ?? '').trim()
    }
    return naming.customName.trim()
  }

  const baseContext = type === 'pstoConclusion'
    ? getPstoConclusionDateParts(date)
    : {
        date: date ? new Date(`${date}T00:00:00`) : new Date(),
        ...(methodCode ? { methodCode } : {}),
      }
  return buildSystemNameWithNumber(
    settings[type].systemPattern,
    addRowsToNamingPatternContext(baseContext, group.rows),
    Math.max(1, Math.floor(nextNumber ?? 1)) + groupIndex,
  )
}

function getCreationPlanError(
  groups: SystemDocumentCreationGroup[],
  allowAllNamesEmpty: boolean,
) {
  if (groups.length === 0) return ''
  if (groups.some((group) => group.isMissingValueFallback)) {
    return 'Заполните поля, необходимые для выбранного разделения.'
  }
  if (allowAllNamesEmpty && groups.every((group) => !group.name.trim())) return ''
  if (groups.some((group) => !group.name.trim())) {
    return 'Укажите название для каждого создаваемого документа.'
  }
  const normalizedNames = groups.map((group) => group.name.trim().toLocaleLowerCase('ru-RU'))
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    return 'Названия создаваемых документов должны различаться.'
  }
  return ''
}
