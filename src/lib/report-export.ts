import {
  VISIBLE_FIELD_SECTIONS,
  VISIBLE_FIELDS,
  type WeldFieldKey,
} from '@/lib/weld-fields'
import {
  ALWAYS_VISIBLE_FIELD_KEYS as alwaysVisibleFieldKeys,
  COLLAPSED_SECTIONS_STORAGE_PREFIX as collapsedSectionsStoragePrefix,
  HEAT_TREATMENT_EDITABLE_FIELD_KEYS as heatTreatmentEditableFieldKeys,
  LNK_EDITABLE_FIELD_KEYS as lnkEditableFieldKeys,
  PSTO_SECTION_FIELD_KEYS as pstoSectionFieldKeys,
  WELDING_JOURNAL_BLOCKED_FIELD_KEYS as weldingJournalBlockedFieldKeys,
} from '@/lib/report-config'
import type { WeldTableSection } from '@/lib/weld-table-sections'

export type ReportKind = 'weldingJournal' | 'heatTreatment' | 'lnk' | 'welderStamps'

export function getReportExportFields({
  storageKey,
  hiddenFieldKeys,
  mergePstoSections,
  sectionLayout = VISIBLE_FIELD_SECTIONS,
}: {
  storageKey: string
  hiddenFieldKeys: ReadonlySet<WeldFieldKey>
  mergePstoSections: boolean
  sectionLayout?: readonly WeldTableSection[]
}) {
  const collapsedSections = readCollapsedSections(storageKey)
  const reportAlwaysVisibleFieldKeys = new Set(alwaysVisibleFieldKeys)
  if (mergePstoSections) {
    for (const fieldKey of pstoSectionFieldKeys) {
      reportAlwaysVisibleFieldKeys.add(fieldKey)
    }
  }
  const availableSections = getReportExportSections(hiddenFieldKeys, mergePstoSections, sectionLayout)

  return availableSections.flatMap((group) => {
    const isCollapsed = collapsedSections.has(group.section) && canCollapseExportSection(group.fields, reportAlwaysVisibleFieldKeys)
    return isCollapsed ? group.fields.filter((field) => reportAlwaysVisibleFieldKeys.has(field.key)) : group.fields
  })
}

export function getReportExportSections(
  hiddenFieldKeys: ReadonlySet<WeldFieldKey>,
  mergePstoSections: boolean,
  sectionLayout: readonly WeldTableSection[] = VISIBLE_FIELD_SECTIONS,
) {
  const sections = sectionLayout.map((group) => ({
    ...group,
    fields: group.fields.filter((field) => !hiddenFieldKeys.has(field.key)),
  })).filter((group) => group.fields.length > 0)

  if (!mergePstoSections) return sections

  const pstoFields = sections.flatMap((group) => group.fields).filter((field) => pstoSectionFieldKeys.has(field.key))
  const finalStatusFields = sections.flatMap((group) => group.fields).filter((field) => field.key === 'finalStatus')
  const sectionsWithoutPsto = sections
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) => !pstoSectionFieldKeys.has(field.key) && field.key !== 'finalStatus'),
    }))
    .filter((group) => group.fields.length > 0)
  const resultSection = finalStatusFields.length > 0 ? [{ section: 'Результат', fields: finalStatusFields }] : []
  const weldingIndex = sectionsWithoutPsto.findIndex((group) => group.section === 'Сварка')
  const sectionsWithResult =
    weldingIndex === -1
      ? [...sectionsWithoutPsto, ...resultSection]
      : [
          ...sectionsWithoutPsto.slice(0, weldingIndex + 1),
          ...resultSection,
          ...sectionsWithoutPsto.slice(weldingIndex + 1),
        ]
  const miscIndex = sectionsWithResult.findIndex((group) => group.section === 'Прочее')
  const pstoSection = pstoFields.length > 0 ? [{ section: 'ПСТО', fields: pstoFields }] : []
  if (miscIndex === -1) return [...sectionsWithResult, ...pstoSection]

  return [...sectionsWithResult.slice(0, miscIndex), ...pstoSection, ...sectionsWithResult.slice(miscIndex)]
}

export function getReportReadOnlyFieldKeys(activeReport: ReportKind) {
  if (activeReport === 'weldingJournal') return weldingJournalBlockedFieldKeys
  if (activeReport === 'lnk') {
    return new Set(VISIBLE_FIELDS.map((field) => field.key as WeldFieldKey).filter((fieldKey) => !lnkEditableFieldKeys.has(fieldKey)))
  }
  return new Set(
    VISIBLE_FIELDS.map((field) => field.key as WeldFieldKey).filter((fieldKey) => !heatTreatmentEditableFieldKeys.has(fieldKey)),
  )
}

export function formatWdiTotal(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function canCollapseExportSection(
  fields: readonly WeldTableSection['fields'][number][],
  reportAlwaysVisibleFieldKeys: ReadonlySet<WeldFieldKey>,
) {
  return fields.some((field) => !reportAlwaysVisibleFieldKeys.has(field.key as WeldFieldKey))
}

function readCollapsedSections(storageKey: string) {
  if (typeof window === 'undefined') return new Set<string>()

  try {
    const stored = window.localStorage.getItem(`${collapsedSectionsStoragePrefix}:${storageKey}`)
    if (!stored) return new Set<string>()
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? new Set(parsed.filter((value): value is string => typeof value === 'string')) : new Set<string>()
  } catch {
    return new Set<string>()
  }
}
