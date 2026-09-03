import { isControlEnabledValue } from '@/lib/control-availability-values'
import { isAngularConnectionType } from '@/lib/connection-type'
import {
  LAYERED_CONTROL_DOCUMENT_TYPES,
  type GeneratedDocumentFieldKey,
  type LayeredControlDocumentType,
} from '@/lib/generated-document-types'
import type { WeldInput } from '@/lib/weld-fields'

export type LayeredControlMethod = 'ВИК' | 'ПВК'
export type LayeredControlStage = 'edges' | 'layers'
export type LayeredControlCompositeFieldKey = 'layeredVikDocuments' | 'layeredPvkDocuments'

export const LAYERED_CONTROL_DOCUMENT_PROFILES = {
  layeredVikEdges: {
    method: 'ВИК',
    assignmentKey: 'hasVik',
    stage: 'edges',
    stageLabel: 'Кромки',
    fallbackStageLabel: 'кромки',
    templateLabel: 'ВИК кромок',
    templateDescription: 'Заключение послойного ВИК входного контроля кромок одного У-стыка.',
    fieldKey: 'layeredVikEdgesDocument',
    idKey: 'layeredVikEdgesDocumentId',
    compositeFieldKey: 'layeredVikDocuments',
  },
  layeredVikLayers: {
    method: 'ВИК',
    assignmentKey: 'hasVik',
    stage: 'layers',
    stageLabel: 'Слои',
    fallbackStageLabel: 'слои',
    templateLabel: 'ВИК слоёв',
    templateDescription: 'Заключение послойного ВИК корня, заполнения и облицовки одного У-стыка.',
    fieldKey: 'layeredVikLayersDocument',
    idKey: 'layeredVikLayersDocumentId',
    compositeFieldKey: 'layeredVikDocuments',
  },
  layeredPvkEdges: {
    method: 'ПВК',
    assignmentKey: 'hasPvk',
    stage: 'edges',
    stageLabel: 'Кромки',
    fallbackStageLabel: 'кромки',
    templateLabel: 'ПВК кромок',
    templateDescription: 'Заключение послойного ПВК входного контроля кромок одного У-стыка.',
    fieldKey: 'layeredPvkEdgesDocument',
    idKey: 'layeredPvkEdgesDocumentId',
    compositeFieldKey: 'layeredPvkDocuments',
  },
  layeredPvkLayers: {
    method: 'ПВК',
    assignmentKey: 'hasPvk',
    stage: 'layers',
    stageLabel: 'Слои',
    fallbackStageLabel: 'слои',
    templateLabel: 'ПВК слоёв',
    templateDescription: 'Заключение послойного ПВК корня, заполнения и облицовки одного У-стыка.',
    fieldKey: 'layeredPvkLayersDocument',
    idKey: 'layeredPvkLayersDocumentId',
    compositeFieldKey: 'layeredPvkDocuments',
  },
} as const satisfies Record<
  LayeredControlDocumentType,
  {
    method: LayeredControlMethod
    assignmentKey: 'hasVik' | 'hasPvk'
    stage: LayeredControlStage
    stageLabel: string
    fallbackStageLabel: string
    templateLabel: string
    templateDescription: string
    fieldKey: GeneratedDocumentFieldKey
    idKey: string
    compositeFieldKey: LayeredControlCompositeFieldKey
  }
>

export const LAYERED_CONTROL_DOCUMENT_VIEWS = [
  {
    id: 'layeredVik' as const,
    label: 'Послойный ВИК',
    types: ['layeredVikEdges', 'layeredVikLayers'] as const,
  },
  {
    id: 'layeredPvk' as const,
    label: 'Послойный ПВК',
    types: ['layeredPvkEdges', 'layeredPvkLayers'] as const,
  },
]

export type LayeredControlDocumentViewId = (typeof LAYERED_CONTROL_DOCUMENT_VIEWS)[number]['id']

export function isLayeredControlDocumentViewId(value: unknown): value is LayeredControlDocumentViewId {
  return LAYERED_CONTROL_DOCUMENT_VIEWS.some((view) => view.id === value)
}

export function isLayeredControlCompositeFieldKey(
  value: unknown,
): value is LayeredControlCompositeFieldKey {
  return value === 'layeredVikDocuments' || value === 'layeredPvkDocuments'
}

export function getLayeredControlDocumentProfile(type: LayeredControlDocumentType) {
  return LAYERED_CONTROL_DOCUMENT_PROFILES[type]
}

export function getLayeredControlDocumentTypesForCompositeField(
  fieldKey: LayeredControlCompositeFieldKey,
) {
  return LAYERED_CONTROL_DOCUMENT_TYPES.filter(
    (type) => LAYERED_CONTROL_DOCUMENT_PROFILES[type].compositeFieldKey === fieldKey,
  )
}

export function isLayeredControlDocumentRequired(
  row: Partial<WeldInput>,
  type: LayeredControlDocumentType,
) {
  const profile = LAYERED_CONTROL_DOCUMENT_PROFILES[type]
  return Boolean(
    normalizeDate(row.weldDate) &&
      isAngularConnectionType(row.connectionType) &&
      isControlEnabledValue(row[profile.assignmentKey]),
  )
}

export function getRequiredLayeredControlDocumentTypes(row: Partial<WeldInput>) {
  return LAYERED_CONTROL_DOCUMENT_TYPES.filter((type) =>
    isLayeredControlDocumentRequired(row, type),
  )
}

export function buildLayeredControlFallbackTitle(
  type: LayeredControlDocumentType,
  row: Partial<WeldInput> & { id?: unknown },
) {
  const profile = LAYERED_CONTROL_DOCUMENT_PROFILES[type]
  const joint = String(row.joint ?? '').trim() || `ID ${String(row.id ?? '').trim() || '?'}`
  return `${profile.method} - ${profile.fallbackStageLabel} - ${joint} - ${formatFullDate(row.weldDate)}`
}

export function getLayeredControlStageLabel(type: LayeredControlDocumentType) {
  return LAYERED_CONTROL_DOCUMENT_PROFILES[type].stageLabel
}

export function normalizeLayeredControlDate(value: unknown) {
  return normalizeDate(value)
}

function normalizeDate(value: unknown) {
  const raw = String(value ?? '').trim()
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
}

function formatFullDate(value: unknown) {
  const normalized = normalizeDate(value)
  if (!normalized) return 'без даты'
  const [year, month, day] = normalized.split('-')
  return `${day}.${month}.${year}`
}
