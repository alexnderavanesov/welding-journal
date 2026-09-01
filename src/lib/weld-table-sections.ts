import { canCollapseSection } from '@/lib/weld-table-section-state'
import { VISIBLE_FIELD_SECTIONS, WELD_FIELDS, type WeldFieldKey } from '@/lib/weld-fields'

type WeldTableField = (typeof WELD_FIELDS)[number]

const PSTO_SECTION_FIELD_KEYS = new Set<WeldFieldKey>([
  'pstoRequired',
  'pstoRequest',
  'pstoRequestDate',
  'pstoDate',
  'pstoResult',
  'pstoCycleSummary',
  'heatTreatmentDiagram',
  'tvmtRequest',
  'tvmtRequestDate',
  'tvmtResult',
  'tvmtConclusionDate',
  'tvmtConclusion',
  'pstoNote',
  'pstoCancellationDate',
  'pstoControlBasis',
])
const PSTO_SECTION_FIELD_ORDER: readonly WeldFieldKey[] = [
  'pstoRequired',
  'pstoCycleSummary',
  'pstoRequest',
  'pstoRequestDate',
  'heatTreatmentDiagram',
  'pstoDate',
  'pstoResult',
  'tvmtRequest',
  'tvmtRequestDate',
  'tvmtConclusion',
  'tvmtConclusionDate',
  'tvmtResult',
  'pstoNote',
  'pstoCancellationDate',
  'pstoControlBasis',
]
const ALWAYS_VISIBLE_FIELD_KEYS = new Set<WeldFieldKey>([
  'projectTitle',
  'subtitleCode',
  'line',
  'weldControlPercent',
  'spool',
  'joint',
  'wdi',
  'weldDate',
  'finalStatus',
])

export type WeldTableSection = {
  section: string
  fields: WeldTableField[]
}

export type WeldTableDisplaySection = WeldTableSection & {
  collapsed: boolean
}

export function getAlwaysVisibleFieldKeys(mergePstoSections: boolean) {
  const fieldKeys = new Set(ALWAYS_VISIBLE_FIELD_KEYS)
  if (mergePstoSections) {
    for (const fieldKey of PSTO_SECTION_FIELD_KEYS) {
      fieldKeys.add(fieldKey)
    }
  }
  return fieldKeys
}

export function getAvailableWeldTableSections({
  hiddenFieldKeys,
  mergePstoSections,
  sectionLayout = VISIBLE_FIELD_SECTIONS,
}: {
  hiddenFieldKeys: ReadonlySet<WeldFieldKey>
  mergePstoSections: boolean
  sectionLayout?: readonly WeldTableSection[]
}) {
  const sections = sectionLayout.map((group) => ({
    ...group,
    fields: group.fields.filter((field) => !hiddenFieldKeys.has(field.key)),
  })).filter((group) => group.fields.length > 0)

  if (!mergePstoSections) return sections

  const pstoFieldsByKey = new Map(
    sections.flatMap((group) => group.fields)
      .filter((field) => PSTO_SECTION_FIELD_KEYS.has(field.key))
      .map((field) => [field.key, field]),
  )
  const pstoFields = PSTO_SECTION_FIELD_ORDER.flatMap((fieldKey) => {
    const field = pstoFieldsByKey.get(fieldKey)
    return field ? [field] : []
  })
  const finalStatusFields = sections.flatMap((group) => group.fields).filter((field) => field.key === 'finalStatus')
  const sectionsWithoutPsto = sections
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) => !PSTO_SECTION_FIELD_KEYS.has(field.key) && field.key !== 'finalStatus'),
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

export function getFilteredWeldTableSections({
  availableSections,
  collapsedSections,
  alwaysVisibleFieldKeys,
}: {
  availableSections: WeldTableSection[]
  collapsedSections: ReadonlySet<string>
  alwaysVisibleFieldKeys: ReadonlySet<string>
}) {
  return availableSections
    .map((group) => ({
      ...group,
      collapsed: collapsedSections.has(group.section) && canCollapseSection(group.fields, alwaysVisibleFieldKeys),
      fields: collapsedSections.has(group.section)
        ? group.fields.filter((field) => alwaysVisibleFieldKeys.has(field.key))
        : group.fields,
    }))
    .filter((group) => group.fields.length > 0)
}
