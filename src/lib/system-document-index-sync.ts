import type { SystemDocumentSummary } from '@/lib/system-document-types'

type SystemDocumentIdentity = Pick<
  SystemDocumentSummary,
  'type' | 'title' | 'date' | 'methodCode' | 'methodCodes' | 'sourceKind'
>

export function filterLegacyCycleSummariesShadowedBySourcedDocuments(
  summaries: SystemDocumentSummary[],
  sourcedDocuments: SystemDocumentIdentity[],
) {
  if (sourcedDocuments.length === 0) return summaries

  return summaries.filter((summary) => !(
    isLegacyPrimaryCycleSummary(summary) &&
    sourcedDocuments.some((document) => isMatchingCycleDocument(summary, document))
  ))
}

export function isLegacyPrimaryCycleSummary(summary: SystemDocumentIdentity) {
  if (summary.type === 'pstoRequest' || summary.type === 'pstoConclusion') return true
  const methods = new Set([
    ...(summary.methodCode ? [summary.methodCode] : []),
    ...summary.methodCodes,
  ])
  return methods.size > 0 && [...methods].every((method) => method === 'ТВМТ')
}

function isMatchingCycleDocument(
  summary: SystemDocumentIdentity,
  document: SystemDocumentIdentity,
) {
  if (document.sourceKind !== 'pstoCycle') return false
  if (
    document.type !== summary.type ||
    document.title !== summary.title ||
    document.date !== summary.date
  ) {
    return false
  }
  if (summary.type === 'pstoRequest' || summary.type === 'pstoConclusion') return true
  return document.methodCode === 'ТВМТ'
}
