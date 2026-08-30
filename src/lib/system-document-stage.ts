import type { SystemDocumentSummary } from '@/lib/system-document-types'

export type SystemDocumentMethodScope = 'lnk' | 'tvmt' | null

export function getScopedSystemDocumentStageValues(scope: SystemDocumentMethodScope) {
  return scope === 'lnk' ? ['До ТО', 'Основной'] : []
}

export function getScopedSystemDocumentMethodValues(scope: SystemDocumentMethodScope) {
  return scope === 'tvmt' ? ['ТВМТ'] : []
}

export function getSystemDocumentStageLabel(documentRecord: SystemDocumentSummary) {
  if (documentRecord.sourceKind === 'beforeHeatTreatment') return 'До ТО'
  if (documentRecord.sourceKind === 'pstoRepeat' || documentRecord.sourceKind === 'pstoCycle') {
    const sequences = documentRecord.cycleSequences ?? []
    if (sequences.length === 1) return `Цикл ${sequences[0]}`
    if (sequences.length > 1) return `Циклы ${sequences.join(', ')}`
    return documentRecord.sourceKind === 'pstoCycle' ? 'Цикл ПСТО' : 'Повторный цикл'
  }
  if (isTvmtSystemDocument(documentRecord)) return 'Цикл 1'
  return documentRecord.type.startsWith('lnk') ? 'Основной' : 'Цикл 1'
}

export function getSystemDocumentMethodCodes(documentRecord: SystemDocumentSummary) {
  const values = documentRecord.methodCodes.length > 0
    ? documentRecord.methodCodes
    : documentRecord.methodCode
      ? [documentRecord.methodCode]
      : []
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function getSystemDocumentStageTransferLabel(documentRecord: SystemDocumentSummary) {
  return documentRecord.sourceKind === 'beforeHeatTreatment'
    ? 'Перенести в «Основной»'
    : 'Перенести в «До ТО»'
}

export function getSystemDocumentStageClassName(documentRecord: SystemDocumentSummary) {
  if (documentRecord.sourceKind === 'beforeHeatTreatment') {
    return 'border-violet-200 bg-violet-50 text-violet-700'
  }
  if (documentRecord.sourceKind === 'pstoRepeat' || documentRecord.sourceKind === 'pstoCycle') {
    const hasRepeatCycle = (documentRecord.cycleSequences ?? []).some((sequence) => sequence >= 2)
    return hasRepeatCycle
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-cyan-200 bg-cyan-50 text-cyan-700'
  }
  if (documentRecord.type.startsWith('lnk') && !isTvmtSystemDocument(documentRecord)) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }
  return 'border-cyan-200 bg-cyan-50 text-cyan-700'
}

function isTvmtSystemDocument(documentRecord: SystemDocumentSummary) {
  const methods = getSystemDocumentMethodCodes(documentRecord)
  return methods.length > 0 && methods.every((method) => method === 'ТВМТ')
}
