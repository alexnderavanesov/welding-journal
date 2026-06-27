import { canCollapseSection } from '@/lib/weld-table-utils'
import { VISIBLE_FIELD_SECTIONS, type WeldField, type WeldFieldKey } from '@/lib/weld-fields'

const PSTO_SECTION_FIELD_KEYS = new Set<WeldFieldKey>([
  'pstoRequired',
  'pstoRequest',
  'pstoDate',
  'pstoResult',
  'heatTreatmentDiagram',
  'pstoNote',
])
const ALWAYS_VISIBLE_FIELD_KEYS = new Set<WeldFieldKey>([
  'projectTitle',
  'subtitleCode',
  'line',
  'spool',
  'joint',
  'wdi',
  'weldDate',
  'finalStatus',
])

export type WeldTableSection = {
  section: string
  fields: WeldField[]
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
}: {
  hiddenFieldKeys: ReadonlySet<WeldFieldKey>
  mergePstoSections: boolean
}) {
  const sections = VISIBLE_FIELD_SECTIONS.map((group) => ({
    ...group,
    fields: group.fields.filter((field) => !hiddenFieldKeys.has(field.key)),
  })).filter((group) => group.fields.length > 0)

  if (!mergePstoSections) return sections

  const pstoFields = sections.flatMap((group) => group.fields).filter((field) => PSTO_SECTION_FIELD_KEYS.has(field.key))
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
  alwaysVisibleFieldKeys: ReadonlySet<WeldFieldKey>
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
