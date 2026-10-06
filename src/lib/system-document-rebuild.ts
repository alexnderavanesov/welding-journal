import type { WeldRow } from '@/lib/dispatcher-types'
import { REBUILD_PREVIEW_BYTES_LIMIT, type RebuildBatch } from '@/lib/system-document-rebuild-batch'
import type { RequestConclusionSettings } from '@/lib/request-conclusion-settings'
import {
  buildCurrentSystemDocumentName,
  getSystemDocumentNumber,
  type SystemDocumentSummary,
  type SystemDocumentSourcePosition,
} from '@/lib/system-document-types'
import type { PstoRepeatCycleRecord } from '@/lib/psto-cycle'
import {
  getSystemDocumentTemplateId,
  type SystemDocumentTemplateId,
} from '@/lib/system-document-template-types'
import {
  buildSystemDocumentSplitGroups,
  getSystemDocumentSplitModeLabel,
  getSystemDocumentSplitSettingId,
  type SystemDocumentSplitMode,
} from '@/lib/system-document-splitting'

export type SystemDocumentRebuildSource = {
  document: SystemDocumentSummary
  rows: WeldRow[]
  cyclePositions?: Array<{ position: SystemDocumentSourcePosition; cycle?: PstoRepeatCycleRecord }>
}

export type SystemDocumentRebuildGroupPreview = {
  key: string
  label: string
  rowIds: number[]
  rowCount: number
  joints: string[]
  previewName: string
  isMissingValueFallback: boolean
  cycleSequences?: number[]
}

export type SystemDocumentRebuildDocumentPreview = {
  documentId: number
  templateId: SystemDocumentTemplateId
  type: SystemDocumentSummary['type']
  methodCode?: string
  label: string
  title: string
  date: string
  rowCount: number
  mode: SystemDocumentSplitMode
  modeLabel: string
  isSystemName: boolean
  systemNumber: string
  groups: SystemDocumentRebuildGroupPreview[]
  willChangeAutomatically: boolean
  requiresCustomNameDecision: boolean
}

export type SystemDocumentRebuildPreview = {
  batch?: RebuildBatch
  fingerprint: string
  scopeRevisions: Partial<Record<SystemDocumentTemplateId, string>>
  documents: SystemDocumentRebuildDocumentPreview[]
  checkedDocumentCount: number
  changedDocumentCount: number
  resultingDocumentCount: number
  affectedRowCount: number
}

export type SystemDocumentRebuildCustomDecision = {
  documentId: number
  action: 'keep' | 'rebuild'
  groupNames?: Record<string, string>
}

export function getSystemDocumentRebuildSelectionSummary({
  documents,
  selectedTemplateIds,
  decisions,
}: {
  documents: SystemDocumentRebuildDocumentPreview[]
  selectedTemplateIds: ReadonlySet<SystemDocumentTemplateId>
  decisions: SystemDocumentRebuildCustomDecision[]
}) {
  const decisionsByDocument = new Map(decisions.map((decision) => [decision.documentId, decision]))
  const selectedDocuments = documents.filter((document) => selectedTemplateIds.has(document.templateId))
  const changedDocuments = selectedDocuments.filter((document) =>
    document.willChangeAutomatically || (
      document.requiresCustomNameDecision &&
      decisionsByDocument.get(document.documentId)?.action === 'rebuild'
    ),
  )
  const changedDocumentIds = new Set(changedDocuments.map(document => document.documentId))
  return {
    selectedDocuments,
    changedDocuments,
    affectedRowCount: new Set(
      changedDocuments.flatMap((document) => document.groups.flatMap((group) => group.rowIds)),
    ).size,
    resultingDocumentCount: selectedDocuments.reduce((count, document) => {
      const rebuilt = changedDocumentIds.has(document.documentId)
      return count + (rebuilt ? document.groups.length : 1)
    }, 0),
  }
}

export function buildSystemDocumentRebuildDocuments({
  sources,
  settings,
  nextNumbers,
  occupiedNumbers,
}: {
  sources: SystemDocumentRebuildSource[]
  settings: RequestConclusionSettings
  nextNumbers: Partial<Record<SystemDocumentTemplateId, number>>
  occupiedNumbers?: ReadonlyMap<SystemDocumentTemplateId, ReadonlySet<number>>
}): Omit<SystemDocumentRebuildPreview, 'fingerprint' | 'scopeRevisions'> {
  const numberCursors = new Map<SystemDocumentTemplateId, number>(
    Object.entries(nextNumbers).map(([id, number]) => [
      id as SystemDocumentTemplateId,
      Math.max(1, Math.floor(number ?? 1)),
    ]),
  )
  let previewBytes = 0
  const usedNumbersByTemplate = new Map<SystemDocumentTemplateId, Set<number>>(
    [...(occupiedNumbers ?? new Map())].map(([id, numbers]) => [id, new Set(numbers)]),
  )
  for (const { document } of sources) {
    const number = Number(getSystemDocumentNumber(document, settings))
    if (!Number.isInteger(number) || number <= 0) continue
    const templateId = getSystemDocumentTemplateId(document)
    const usedNumbers = usedNumbersByTemplate.get(templateId) ?? new Set<number>()
    usedNumbers.add(number)
    usedNumbersByTemplate.set(templateId, usedNumbers)
  }
  const documents = sources
    .filter(({ document }) => document.sourceKind !== 'beforeHeatTreatment')
    .sort(compareSources)
    .map(({ document, rows, cyclePositions }) => {
      const templateId = getSystemDocumentTemplateId(document)
      const settingId = getSystemDocumentSplitSettingId(document)
      const mode = settings.splitModes[settingId]
      const splitGroups = buildSystemDocumentSplitGroups(rows, mode)
      const systemNumber = getSystemDocumentNumber(document, settings)
      const isSystemName = Boolean(systemNumber)
      const cyclesByRow = new Map<number, Set<number>>()
      for (const { position, cycle } of cyclePositions ?? []) {
        const sequences = cyclesByRow.get(position.weldJointId) ?? new Set<number>()
        sequences.add(position.sequence ?? cycle?.sequence ?? 1)
        cyclesByRow.set(position.weldJointId, sequences)
      }
      const groups = splitGroups.map((group, index) => {
        let previewName = ''
        if (isSystemName) {
          const number = index === 0
            ? Number(systemNumber)
            : takeNextNumber(numberCursors, usedNumbersByTemplate, templateId)
          previewName = buildCurrentSystemDocumentName(document, group.rows, settings, number)
        }
        const previewGroup = {
          key: group.key,
          label: group.label,
          rowIds: group.rowIds,
          rowCount: group.rows.length,
          joints: group.rows
            .slice(0, 5)
            .map((row) => {
              const joint = String(row.joint ?? `ID ${row.id}`).trim()
              const cycles = [...cyclesByRow.get(row.id) ?? []].sort((a, b) => a - b)
              return cycles.length ? `${joint} (циклы: ${cycles.join(', ')})` : joint
            })
            .filter(Boolean),
          previewName,
          isMissingValueFallback: group.isMissingValueFallback,
          ...(cyclePositions ? { cycleSequences: [...new Set(group.rowIds.flatMap(id => [...cyclesByRow.get(id) ?? []]))].sort((a, b) => a - b) } : {}),
        }
        // Bound the retained output too: a long naming pattern multiplied by
        // many groups can be much larger than its input. No partial plan saves.
        previewBytes += JSON.stringify(previewGroup).length * 2
        if (previewBytes > REBUILD_PREVIEW_BYTES_LIMIT) throw new Error('Предпросмотр пакета слишком объёмный из-за состава групп или длинных названий. Документы не изменены; уменьшите объём названий или разделения.')
        return previewGroup
      })
      const willChangeAutomatically = isSystemName && (
        groups.length !== 1 || groups[0]?.previewName !== document.title
      )
      const requiresCustomNameDecision = !isSystemName && groups.length > 1
      return {
        documentId: document.documentId,
        templateId,
        type: document.type,
        ...(document.methodCode ? { methodCode: document.methodCode } : {}),
        label: document.label,
        title: document.title,
        date: document.date,
        rowCount: rows.length,
        mode,
        modeLabel: getSystemDocumentSplitModeLabel(mode),
        isSystemName,
        systemNumber,
        groups,
        willChangeAutomatically,
        requiresCustomNameDecision,
      }
    })
  const automaticallyChanged = documents.filter((document) => document.willChangeAutomatically)
  return {
    documents,
    checkedDocumentCount: documents.length,
    changedDocumentCount: automaticallyChanged.length,
    resultingDocumentCount: documents.reduce(
      (count, document) => count + (document.willChangeAutomatically ? document.groups.length : 1),
      0,
    ),
    affectedRowCount: new Set(automaticallyChanged.flatMap((document) => document.groups.flatMap((group) => group.rowIds))).size,
  }
}

export function getSystemDocumentRebuildDecisionError({
  documents,
  selectedTemplateIds,
  decisions,
}: {
  documents: SystemDocumentRebuildDocumentPreview[]
  selectedTemplateIds: ReadonlySet<SystemDocumentTemplateId>
  decisions: SystemDocumentRebuildCustomDecision[]
}) {
  const decisionsByDocument = new Map(decisions.map((decision) => [decision.documentId, decision]))
  for (const document of documents) {
    if (!selectedTemplateIds.has(document.templateId)) continue
    const decision = decisionsByDocument.get(document.documentId)
    const willRebuild = document.isSystemName
      ? document.willChangeAutomatically
      : document.requiresCustomNameDecision && decision?.action === 'rebuild'
    if (willRebuild && document.groups.some((group) => group.isMissingValueFallback)) {
      return `Заполните поля разделения для всех стыков документа «${document.title}».`
    }
    if (!document.requiresCustomNameDecision) continue
    if (!decision || decision.action === 'keep') continue
    const names = document.groups.map((group) => String(decision.groupNames?.[group.key] ?? '').trim())
    if (names.some((name) => !name)) return `Укажите названия всех групп документа «${document.title}».`
    const normalized = names.map((name) => name.toLocaleLowerCase('ru-RU'))
    if (new Set(normalized).size !== normalized.length) {
      return `Названия групп документа «${document.title}» должны различаться.`
    }
  }
  return ''
}

function takeNextNumber(
  cursors: Map<SystemDocumentTemplateId, number>,
  usedNumbersByTemplate: Map<SystemDocumentTemplateId, Set<number>>,
  templateId: SystemDocumentTemplateId,
) {
  const usedNumbers = usedNumbersByTemplate.get(templateId) ?? new Set<number>()
  let number = cursors.get(templateId) ?? 1
  while (usedNumbers.has(number)) number += 1
  cursors.set(templateId, number + 1)
  usedNumbers.add(number)
  usedNumbersByTemplate.set(templateId, usedNumbers)
  return number
}

function compareSources(left: SystemDocumentRebuildSource, right: SystemDocumentRebuildSource) {
  const templateDelta = getSystemDocumentTemplateId(left.document).localeCompare(
    getSystemDocumentTemplateId(right.document),
  )
  if (templateDelta) return templateDelta
  const dateDelta = left.document.date.localeCompare(right.document.date)
  if (dateDelta) return dateDelta
  return left.document.documentId - right.document.documentId
}
