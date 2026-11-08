import { LNK_METHODS } from '@/lib/lnk-report-config'
import { FIELD_BY_KEY, type WeldFieldKey } from '@/lib/weld-field-definitions'
import type { WeldTableSection } from '@/lib/weld-table-sections'

const BASE_SECTIONS: Array<{ section: string; fieldKeys: WeldFieldKey[] }> = [
  {
    section: 'Проект',
    fieldKeys: [
      'projectTitle', 'subtitleCode', 'line', 'groupName', 'category', 'weldControlPercent',
      'isometry', 'sheet', 'revisionNumber',
    ],
  },
  { section: 'Статус', fieldKeys: ['officiality', 'revisionActuality'] },
  { section: 'Спул', fieldKeys: ['spool', 'spoolId'] },
  { section: 'Стык', fieldKeys: ['joint', 'finalStatus'] },
  { section: 'Материалы', fieldKeys: ['element1', 'element2', 'material1', 'material2'] },
  {
    section: 'Сварка',
    fieldKeys: ['weldingMethod', 'connectionType', 'materialGroup', 'd1', 'd2', 't1', 't2', 'weldLength', 'wdi', 'weldDate', 'responsible'],
  },
  {
    section: 'Клейма',
    fieldKeys: [
      'stamp1K', 'stamp1KFact', 'stamp1Z', 'stamp1ZFact',
    ],
  },
  {
    section: 'Назначения',
    fieldKeys: ['hasVik', 'hasRk', 'hasUzk', 'hasPvk', 'controlBasisSummary', 'pstoRequired'],
  },
  {
    section: 'Послойный контроль',
    fieldKeys: ['layeredVikDocuments', 'layeredPvkDocuments'],
  },
  {
    section: 'НК до ТО',
    fieldKeys: [
      'preVikRequest', 'preVikRequestDate', 'preVikResult', 'preVikConclusionDate', 'preVikConclusion',
      'preVikDefectDescription',
      'preRkRequest', 'preRkRequestDate', 'preRkResult', 'preRkExposureScheme', 'preRkDefectDescription',
      'preRkConclusionDate', 'preRkConclusion',
      'preUzkRequest', 'preUzkRequestDate', 'preUzkResult', 'preUzkConclusionDate', 'preUzkConclusion',
      'preUzkDefectDescription',
      'prePvkRequest', 'prePvkRequestDate', 'prePvkResult', 'prePvkConclusionDate', 'prePvkConclusion',
      'prePvkDefectDescription',
    ],
  },
]

const METHOD_SECTIONS: Array<{ section: string; fieldKeys: WeldFieldKey[] }> = LNK_METHODS.map((method) => ({
  section: method.code,
  fieldKeys: [
    method.requestKey,
    method.requestDateKey,
    method.resultKey,
    ...(method.code === 'РК' ? ['rkExposureScheme', 'lnkDefectDescription'] as WeldFieldKey[] : []),
    method.conclusionDateKey,
    method.conclusionKey,
    ...(method.code === 'РК' ? [] : [method.defectDescriptionKey]),
  ],
}))

const LNK_SECTION_LAYOUT: Array<{ section: string; fieldKeys: WeldFieldKey[] }> = [
  ...BASE_SECTIONS,
  ...METHOD_SECTIONS,
  {
    section: 'Прочее',
    fieldKeys: ['lnkNote', 'dispatcherTasks', 'id', 'lnkCreatedAt', 'lnkUpdatedAt'],
  },
]

export function getLnkVisibleFieldSections(): WeldTableSection[] {
  return LNK_SECTION_LAYOUT
    .map(({ section, fieldKeys }) => ({
      section,
      fields: fieldKeys.map((fieldKey) => {
        const field = FIELD_BY_KEY.get(fieldKey)
        if (!field) throw new Error(`Unknown LNK report field: ${fieldKey}`)
        return field
      }),
    }))
}

export const LNK_VISIBLE_FIELD_SECTIONS = getLnkVisibleFieldSections()
