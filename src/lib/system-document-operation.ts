import type { WeldRow } from './dispatcher-types'
import { getDocumentRequisiteErrors } from './document-requisites'
import type { PreHeatTreatmentControlRecord } from './lnk-control-stage'
import { ALL_LNK_FIELD_METHODS } from './lnk-report-config'
import type { PstoRepeatCycleRecord } from './psto-cycle'
import { buildSystemDocumentSplitGroups, type SystemDocumentSplitMode } from './system-document-splitting'
import { buildCurrentSystemDocumentName, getSystemDocumentLabel, getSystemDocumentNumber, getSystemDocumentNamingContext, type SystemDocumentReference, type SystemDocumentSourcePosition, type SystemDocumentSummary } from './system-document-types'
import { getSystemDocumentSequenceId, type SystemDocumentSequenceId } from './system-document-sequence-id'
import { getSystemDocumentTemplateId, type SystemDocumentTemplateId } from './system-document-template-types'
import { getRequestConclusionNamingKind, type RequestConclusionSettings } from './request-conclusion-settings'
import { findAvailableSystemDocumentName, systemDocumentNameKey } from './system-document-name-allocation'
import { REBUILD_POSITION_LIMIT, REBUILD_PREVIEW_BYTES_LIMIT } from './system-document-rebuild-batch'

export type DocumentOperationSource = {
  document: SystemDocumentSummary
  rows: WeldRow[]
  cyclePositions?: Array<{ position: SystemDocumentSourcePosition; cycle?: PstoRepeatCycleRecord }>
  controls?: Array<{ position: SystemDocumentSourcePosition; control: PreHeatTreatmentControlRecord }>
}
export type DocumentOperationPosition = {
  key: string
  sourceId: number
  row: WeldRow
  field: string
  method: string
  stage: 'До ТО' | 'Основной контроль' | 'Цикл ПСТО'
  cycle?: number
  relationId?: number
  sourcePosition?: SystemDocumentSourcePosition
}
export type DocumentOperationName = { mode: 'system' | 'custom'; name: string; membership: string }
export type DocumentOperationRequest = {
  documentIds: number[]
  action: 'split' | 'rename' | 'merge'
  mode: SystemDocumentSplitMode
  merge: boolean
  names?: Record<string, DocumentOperationName>
}

export function assertDocumentOperationIntent(request: DocumentOperationRequest) {
  if (request.action === 'rename' && request.merge) throw new Error('Переименование не объединяет документы.')
  if (request.action === 'merge' && (request.documentIds.length < 2 || !request.merge || request.mode !== 'none')) {
    throw new Error('Для объединения выберите минимум два документа. Объединение создаёт один документ без разделения.')
  }
}
export type DocumentOperationGroup = {
  key: string
  label: string
  sourceIds: number[]
  reference: SystemDocumentReference
  positions: DocumentOperationPosition[]
  rows: WeldRow[]
  name: string
  namingMode: 'system' | 'custom'
  systemNumber?: number
  reserveNumber: boolean
  error: string
}

/** Exact position identity is independent of the displayed joint/cycle number. */
export function getDocumentOperationPositions(source: DocumentOperationSource): DocumentOperationPosition[] {
  const doc = source.document
  const rows = new Map(source.rows.map(row => [row.id, row]))
  const stale = () => new Error(`Точный состав документа «${doc.title}» изменился или неполон. Нажмите «Проверить изменения».`)
  if (rows.size !== doc.rowIds.length || doc.rowIds.some(id => !rows.has(id))) throw stale()
  const position = (row: WeldRow, field: string, method: string, extra: Partial<DocumentOperationPosition> = {}): DocumentOperationPosition => ({
    key: JSON.stringify([row.id, extra.stage === 'До ТО' ? 'beforeHeatTreatment' : extra.cycle && extra.cycle >= 2 ? 'pstoRepeat' : 'primary', extra.relationId ?? row.id, field]),
    sourceId: doc.documentId, row, field, method, stage: 'Основной контроль', ...extra,
  })
  let result: DocumentOperationPosition[] = []
  if (doc.sourceKind === 'beforeHeatTreatment') {
    const field = doc.type === 'lnkRequest' ? 'requestName' : 'conclusionName'
    const date = doc.type === 'lnkRequest' ? 'requestDate' : 'conclusionDate'
    if (!doc.type.startsWith('lnk') || !source.controls?.length) throw stale()
    result = source.controls.map(({ position: stored, control }) => {
      const row = rows.get(stored.weldJointId)
      if (!row || stored.kind !== 'beforeHeatTreatment' || control.id !== stored.relationId || control.weldJointId !== row.id ||
        stored.methodCode !== control.method || !same(control[field], doc.title) || !same(control[date], doc.date) ||
        doc.type === 'lnkConclusion' && control.method !== doc.methodCode) throw stale()
      return position(row, field, control.method, { stage: 'До ТО', relationId: control.id, sourcePosition: stored })
    })
  } else if (source.cyclePositions) {
    const field = cycleField(doc)
    result = source.cyclePositions.map(({ position: stored, cycle }) => {
      const row = rows.get(stored.weldJointId)
      const primary = stored.kind === 'pstoCycle' && stored.sequence === 1
      if (!row || primary && stored.relationId !== row.id || !primary && (!cycle || cycle.id !== stored.relationId ||
        cycle.weldJointId !== row.id || cycle.sequence !== stored.sequence || cycle.sequence < 2)) throw stale()
      const record = (primary ? row : cycle) as unknown as Record<string, unknown>
      if (!same(record[field.name], doc.title) || !same(record[field.date], doc.date)) throw stale()
      return position(row, field.name, doc.methodCode ?? 'ПСТО', { stage: 'Цикл ПСТО', cycle: primary ? 1 : cycle!.sequence,
        relationId: stored.relationId, sourcePosition: stored })
    })
  } else {
    if (doc.sourceKind) throw stale()
    for (const row of rows.values()) {
      if (doc.type.startsWith('psto')) {
        const field = cycleField(doc)
        if (!same(row[field.name], doc.title) || !same(row[field.date], doc.date)) throw stale()
        result.push(position(row, field.name, 'ПСТО', { stage: 'Цикл ПСТО', cycle: 1, relationId: row.id }))
      } else for (const method of ALL_LNK_FIELD_METHODS) {
        if (doc.type === 'lnkConclusion' ? method.code !== doc.methodCode : (method.code === 'ТВМТ') !== (doc.methodCode === 'ТВМТ')) continue
        const field = doc.type === 'lnkRequest' ? method.requestKey : method.conclusionKey
        const date = doc.type === 'lnkRequest' ? method.requestDateKey : method.conclusionDateKey
        if (same(row[field], doc.title) && same(row[date], doc.date)) result.push(position(row, field, method.code,
          method.code === 'ТВМТ' ? { stage: 'Цикл ПСТО', cycle: 1, relationId: row.id } : {}))
      }
    }
  }
  if (new Set(result.map(item => item.row.id)).size !== rows.size || !result.length || new Set(result.map(item => item.key)).size !== result.length) throw stale()
  return result.sort((a, b) => a.row.id - b.row.id || a.key.localeCompare(b.key))
}

export function assertDocumentMergeCompatible(sources: DocumentOperationSource[], positions = sources.flatMap(getDocumentOperationPositions)) {
  if (sources.length < 2) return
  const first = sources[0].document
  const cycleDocument = isCycleDocument(first)
  for (const { document } of sources) {
    const reasons: string[] = []
    if (document.type !== first.type || isCycleDocument(document) !== cycleDocument) reasons.push(`разные виды: ${getSystemDocumentLabel(first)} и ${getSystemDocumentLabel(document)}`)
    if (document.date !== first.date) reasons.push(`разные даты: ${first.date} и ${document.date}`)
    if ((document.methodCode ?? '') !== (first.methodCode ?? '')) reasons.push(`разные ${first.type === 'lnkConclusion' ? 'методы заключения' : 'виды контроля'}: ${first.methodCode || 'ЛНК'} и ${document.methodCode || 'ЛНК'}`)
    if ((document.sourceKind === 'beforeHeatTreatment') !== (first.sourceKind === 'beforeHeatTreatment')) reasons.push('разные этапы: НК до ТО и основной НК')
    if (reasons.length) throw new Error(`Нельзя объединить «${first.title}» и «${document.title}»: ${reasons.join('; ')}. Измените выбор. Ни один документ не будет изменён.`)
  }
  const cyclesByJoint = new Map<number, string>()
  const exact = new Set<string>()
  for (const item of positions) {
    if (exact.has(item.key)) throw new Error('Одна и та же позиция повторяется в выбранных документах. Проверьте их состав.')
    exact.add(item.key)
    if (!cycleDocument) continue
    const identity = JSON.stringify([item.cycle, item.relationId])
    const previous = cyclesByJoint.get(item.row.id)
    if (previous && previous !== identity) throw new Error(`Нельзя объединять разные циклы одного стыка (${String(item.row.joint ?? item.row.id)}): следующий цикл зависит от завершения предыдущего.`)
    cyclesByJoint.set(item.row.id, identity)
  }
}

export function buildDocumentOperationGroups({ sources, request, settings, nextNumbers, occupiedNumbers = new Map(), occupiedNames = new Map() }: {
  sources: DocumentOperationSource[]; request: DocumentOperationRequest; settings: RequestConclusionSettings
  nextNumbers: Partial<Record<SystemDocumentSequenceId, number>>
  occupiedNumbers?: ReadonlyMap<SystemDocumentSequenceId, ReadonlySet<number>>
  occupiedNames?: ReadonlyMap<SystemDocumentTemplateId, ReadonlySet<string>>
}): DocumentOperationGroup[] {
  assertDocumentOperationIntent(request)
  const ordered = [...sources].sort((a, b) => a.document.documentId - b.document.documentId)
  if (!ordered.length || ordered.length !== request.documentIds.length || ordered.some(source => !request.documentIds.includes(source.document.documentId))) throw new Error('Выбранные документы больше не найдены. Обновите список.')
  for (const { document } of ordered) {
    const errors = getDocumentRequisiteErrors({ name: document.title, date: document.date,
      nameLabel: 'название документа', dateLabel: 'Дата документа' })
    if (errors.length) throw new Error(`Сначала дозаполните исходный документ «${document.title}» через его реестр. ${errors.join('\n')}`)
  }
  const bySource = new Map(ordered.map(source => [source.document.documentId, getDocumentOperationPositions(source)]))
  const allPositions = [...bySource.values()].flat()
  if (allPositions.length > REBUILD_POSITION_LIMIT) throw new Error('Превышен безопасный объём позиций. Документы не изменены.')
  if (request.merge) assertDocumentMergeCompatible(ordered, allPositions)
  const groups: DocumentOperationGroup[] = []
  let outputBytes = 0
  for (const unit of request.merge ? [ordered] : ordered.map(source => [source])) {
    const first = unit[0].document
    const positions = unit.flatMap(source => bySource.get(source.document.documentId)!)
    const rows = [...new Map(positions.map(item => [item.row.id, item.row])).values()].sort((a, b) => a.id - b.id)
    const positionsByRow = new Map<number, DocumentOperationPosition[]>()
    for (const item of positions) { const values = positionsByRow.get(item.row.id) ?? []; values.push(item); positionsByRow.set(item.row.id, values) }
    const splits = buildSystemDocumentSplitGroups(rows, request.action === 'rename' ? 'none' : request.mode)
    const sourceIds = unit.map(source => source.document.documentId)
    const oldNumber = request.merge ? 0 : Number(getSystemDocumentNumber(first, settings))
    for (const [index, split] of splits.entries()) {
      const key = JSON.stringify([sourceIds, split.key])
      const override = request.names?.[key]
      const namingMode = override?.mode ?? (oldNumber || request.merge ? 'system' : 'custom')
      let number: number | undefined, reserveNumber = false
      if (namingMode === 'system') {
        number = index === 0 && oldNumber > 0 ? oldNumber : undefined
        if (!number) {
          number = Math.max(1, nextNumbers[getSystemDocumentSequenceId(first)] ?? 1)
          reserveNumber = true
        }
      }
      const name = namingMode === 'system' ? buildCurrentSystemDocumentName(first, split.rows, settings, number!)
        : override?.name.trim() ?? (!request.merge && splits.length === 1 ? first.title : '')
      const group: DocumentOperationGroup = { key, label: request.merge ? split.label : `${first.title} → ${split.label}`, sourceIds,
        reference: { ...first, ...(request.merge && isCycleDocument(first) ? { sourceKind: 'pstoCycle' as const } : {}) },
        positions: split.rowIds.flatMap(id => positionsByRow.get(id)!), rows: split.rows, name, namingMode, systemNumber: number,
        reserveNumber, error: split.isMissingValueFallback ? 'Не заполнены поля выбранного разделения.' : !name ? 'Название не указано' : '' }
      outputBytes += (key.length + group.label.length + name.length) * 2 + sourceIds.length * 12 + 256
      if (outputBytes > REBUILD_PREVIEW_BYTES_LIMIT) throw new Error('Результат разделения превышает безопасный объём предпросмотра. Уменьшите выбор или выберите более крупные группы.')
      groups.push(group)
    }
  }
  // Include all fixed output names before allocating any new number: a manual
  // name later in the list must be protected just like an existing document.
  const names = getDocumentOperationOccupiedNames(groups, occupiedNames)
  const cursors = new Map(Object.entries(nextNumbers) as Array<[SystemDocumentSequenceId, number]>)
  const owners = new Map<string, DocumentOperationGroup>()
  for (const group of groups) {
    if (group.reserveNumber) {
      const sequence = getSystemDocumentSequenceId(group.reference)
      const template = getSystemDocumentTemplateId(group.reference)
      const occupied = names.get(template) ?? new Set<string>()
      const allocated = findAvailableSystemDocumentName({
        pattern: settings[getRequestConclusionNamingKind(group.reference)].systemPattern,
        context: getSystemDocumentNamingContext(group.reference, group.rows), date: group.reference.date,
        nextNumber: cursors.get(sequence) ?? 1, occupiedNames: occupied, occupiedNumbers: occupiedNumbers.get(sequence),
      })
      outputBytes += (allocated.name.length - group.name.length) * 2
      group.name = allocated.name
      group.systemNumber = allocated.number
      cursors.set(sequence, allocated.number + 1)
      occupied.add(systemDocumentNameKey(group.reference.date, group.name))
      names.set(template, occupied)
    }
    // The preview carries summaries only; exact positions are paged separately.
    if (outputBytes > REBUILD_PREVIEW_BYTES_LIMIT) throw new Error('Результат разделения превышает безопасный объём предпросмотра. Уменьшите выбор или выберите более крупные группы.')
    if (!group.name) continue
    const identity = documentOperationIdentity(group.reference, group.name)
    const owner = owners.get(identity)
    if (owner) { owner.error = group.error = 'Название повторяется. Одинаковое имя не объединяет документы.' }
    owners.set(identity, group)
  }
  return groups
}

export function getDocumentOperationOccupiedNames(groups: readonly DocumentOperationGroup[], existing: ReadonlyMap<SystemDocumentTemplateId, ReadonlySet<string>>) {
  const names = new Map([...existing].map(([id, values]) => [id, new Set(values)]))
  for (const group of groups) {
    if (group.reserveNumber || !group.name) continue
    const template = getSystemDocumentTemplateId(group.reference)
    const values = names.get(template) ?? new Set<string>()
    values.add(systemDocumentNameKey(group.reference.date, group.name))
    names.set(template, values)
  }
  return names
}

export function documentOperationIdentity(document: SystemDocumentReference, name: string) {
  return JSON.stringify([document.type, document.methodCode ?? '', isCycleDocument(document) ? 'cycle' : document.sourceKind ?? '', document.date, name.trim().toLocaleLowerCase('ru-RU')])
}
export function cycleField(document: SystemDocumentReference) {
  if (document.type === 'pstoRequest') return { name: 'pstoRequest', date: 'pstoRequestDate' } as const
  if (document.type === 'pstoConclusion') return { name: 'heatTreatmentDiagram', date: 'pstoDate' } as const
  if (document.methodCode === 'ТВМТ') return document.type === 'lnkRequest' ? { name: 'tvmtRequest', date: 'tvmtRequestDate' } as const : { name: 'tvmtConclusion', date: 'tvmtConclusionDate' } as const
  throw new Error('Некорректный вид документа цикла.')
}
export function isCycleDocument(document: SystemDocumentReference) { return document.type.startsWith('psto') || document.methodCode === 'ТВМТ' }
function same(value: unknown, expected: string) { return String(value ?? '').trim() === expected.trim() }
