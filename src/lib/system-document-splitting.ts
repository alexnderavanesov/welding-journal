export const SYSTEM_DOCUMENT_SPLIT_SETTING_IDS = [
  'lnkRequest',
  'lnkConclusionVik',
  'lnkConclusionRk',
  'lnkConclusionUzk',
  'lnkConclusionPvk',
  'lnkConclusionOther',
  'pstoRequest',
  'pstoConclusion',
] as const

export type SystemDocumentSplitSettingId =
  (typeof SYSTEM_DOCUMENT_SPLIT_SETTING_IDS)[number]

export const SYSTEM_DOCUMENT_SPLIT_MODES = [
  'none',
  'project',
  'subtitle',
  'line',
  'joint',
] as const

export type SystemDocumentSplitMode =
  (typeof SYSTEM_DOCUMENT_SPLIT_MODES)[number]

export type SystemDocumentSplitSettings = Record<
  SystemDocumentSplitSettingId,
  SystemDocumentSplitMode
>

export type SystemDocumentSplitRow = {
  id: number
  projectTitle?: unknown
  subtitleCode?: unknown
  line?: unknown
  joint?: unknown
}

export type SystemDocumentSplitGroup<Row extends SystemDocumentSplitRow = SystemDocumentSplitRow> = {
  key: string
  label: string
  rows: Row[]
  rowIds: number[]
  missingFields: Array<'projectTitle' | 'subtitleCode' | 'line'>
  isMissingValueFallback: boolean
}

export const DEFAULT_SYSTEM_DOCUMENT_SPLIT_SETTINGS: SystemDocumentSplitSettings =
  Object.fromEntries(
    SYSTEM_DOCUMENT_SPLIT_SETTING_IDS.map((id) => [id, 'none']),
  ) as SystemDocumentSplitSettings

export const SYSTEM_DOCUMENT_SPLIT_MODE_OPTIONS: Array<{
  id: SystemDocumentSplitMode
  label: string
  description: string
}> = [
  {
    id: 'none',
    label: 'Без разделения',
    description: 'Все выбранные позиции попадут в один документ.',
  },
  {
    id: 'project',
    label: 'По проекту',
    description: 'Отдельный документ для каждого проекта.',
  },
  {
    id: 'subtitle',
    label: 'По шифру',
    description: 'Группа учитывает проект и шифр.',
  },
  {
    id: 'line',
    label: 'По линии',
    description: 'Группа учитывает проект, шифр и линию.',
  },
  {
    id: 'joint',
    label: 'По стыку',
    description: 'Каждый стык становится отдельным документом.',
  },
]

const SPLIT_MODE_SET = new Set<string>(SYSTEM_DOCUMENT_SPLIT_MODES)

export function normalizeSystemDocumentSplitSettings(
  value: unknown,
): SystemDocumentSplitSettings {
  const source = typeof value === 'object' && value
    ? value as Partial<Record<SystemDocumentSplitSettingId, unknown>>
    : {}
  return Object.fromEntries(
    SYSTEM_DOCUMENT_SPLIT_SETTING_IDS.map((id) => {
      const mode = String(source[id] ?? '')
      return [id, SPLIT_MODE_SET.has(mode) ? mode : 'none']
    }),
  ) as SystemDocumentSplitSettings
}

export function getSystemDocumentSplitSettingId({
  type,
  methodCode,
}: {
  type: 'lnkRequest' | 'lnkConclusion' | 'pstoRequest' | 'pstoConclusion'
  methodCode?: string
}): SystemDocumentSplitSettingId {
  if (type !== 'lnkConclusion') return type
  const normalizedMethod = normalizeText(methodCode).toLocaleUpperCase('ru-RU')
  if (normalizedMethod === 'ВИК') return 'lnkConclusionVik'
  if (normalizedMethod === 'РК') return 'lnkConclusionRk'
  if (normalizedMethod === 'УЗК') return 'lnkConclusionUzk'
  if (normalizedMethod === 'ПВК') return 'lnkConclusionPvk'
  return 'lnkConclusionOther'
}

export function getSystemDocumentSplitModeLabel(mode: SystemDocumentSplitMode) {
  return SYSTEM_DOCUMENT_SPLIT_MODE_OPTIONS.find((option) => option.id === mode)?.label ?? 'Без разделения'
}

export function buildSystemDocumentSplitGroups<Row extends SystemDocumentSplitRow>(
  rows: readonly Row[],
  mode: SystemDocumentSplitMode,
): SystemDocumentSplitGroup<Row>[] {
  if (rows.length === 0) return []
  if (mode === 'none') {
    return [{
      key: 'none',
      label: 'Все выбранные позиции',
      rows: [...rows],
      rowIds: rows.map((row) => row.id),
      missingFields: [],
      isMissingValueFallback: false,
    }]
  }

  const groups = new Map<string, SystemDocumentSplitGroup<Row>>()
  for (const row of rows) {
    const missingFields = getMissingSplitFields(row, mode)
    const isMissingValueFallback = missingFields.length > 0
    const key = isMissingValueFallback
      ? JSON.stringify(['missing', row.id])
      : buildSplitKey(row, mode)
    const existing = groups.get(key)
    if (existing) {
      existing.rows.push(row)
      existing.rowIds.push(row.id)
      continue
    }
    groups.set(key, {
      key,
      label: buildSplitGroupLabel(row, mode, isMissingValueFallback),
      rows: [row],
      rowIds: [row.id],
      missingFields,
      isMissingValueFallback,
    })
  }
  return [...groups.values()]
}

export function getSystemDocumentSplitMissingSummary(
  groups: readonly SystemDocumentSplitGroup[],
) {
  const fallbackGroups = groups.filter((group) => group.isMissingValueFallback)
  if (fallbackGroups.length === 0) return ''
  const fieldLabels = Array.from(
    new Set(fallbackGroups.flatMap((group) => group.missingFields.map(getMissingFieldLabel))),
  )
  const count = fallbackGroups.reduce((total, group) => total + group.rows.length, 0)
  return `У ${count} ${formatWeldCount(count)} не заполнено: ${fieldLabels.join(', ')}. Заполните данные стыков перед сохранением документа.`
}

function getMissingSplitFields(
  row: SystemDocumentSplitRow,
  mode: SystemDocumentSplitMode,
) {
  const requiredFields = mode === 'project'
    ? ['projectTitle'] as const
    : mode === 'subtitle'
      ? ['projectTitle', 'subtitleCode'] as const
      : mode === 'line'
        ? ['projectTitle', 'subtitleCode', 'line'] as const
        : []
  return requiredFields.filter((field) => !normalizeText(row[field]))
}

function buildSplitKey(
  row: SystemDocumentSplitRow,
  mode: SystemDocumentSplitMode,
) {
  if (mode === 'project') return JSON.stringify(['project', normalizeText(row.projectTitle)])
  if (mode === 'subtitle') {
    return JSON.stringify([
      'subtitle',
      normalizeText(row.projectTitle),
      normalizeText(row.subtitleCode),
    ])
  }
  if (mode === 'line') {
    return JSON.stringify([
      'line',
      normalizeText(row.projectTitle),
      normalizeText(row.subtitleCode),
      normalizeText(row.line),
    ])
  }
  return JSON.stringify(['joint', row.id])
}

function buildSplitGroupLabel(
  row: SystemDocumentSplitRow,
  mode: SystemDocumentSplitMode,
  isMissingValueFallback: boolean,
) {
  const joint = normalizeText(row.joint) || `ID ${row.id}`
  if (isMissingValueFallback) {
    const missingLabel = getMissingSplitFields(row, mode)
      .map(getMissingFieldLabel)
      .join(', ')
    return `Не заполнено: ${missingLabel} · стык ${joint}`
  }
  if (mode === 'project') return normalizeText(row.projectTitle)
  if (mode === 'subtitle') {
    return `${normalizeText(row.projectTitle)} · ${normalizeText(row.subtitleCode)}`
  }
  if (mode === 'line') {
    return [row.projectTitle, row.subtitleCode, row.line]
      .map(normalizeText)
      .join(' · ')
  }
  return `Стык ${joint}`
}

function getMissingFieldLabel(field: 'projectTitle' | 'subtitleCode' | 'line') {
  if (field === 'projectTitle') return 'проект'
  if (field === 'subtitleCode') return 'шифр'
  return 'линия'
}

function formatWeldCount(count: number) {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'стыков'
  if (mod10 === 1) return 'стыка'
  if (mod10 >= 2 && mod10 <= 4) return 'стыков'
  return 'стыков'
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}
