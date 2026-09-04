import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import type { WeldFieldKey } from '@/lib/weld-fields'

const LNK_COMMON_HIGHLIGHT_FIELDS = ['lnkCreatedAt', 'lnkUpdatedAt', 'finalStatus'] as const

export function getLnkRequestPositionHighlightFields(methodKey: WeldFieldKey): WeldFieldKey[] {
  const method = getLnkMethodByRequestKey(methodKey)
  return method
    ? [method.requestKey, method.resultKey, method.conclusionDateKey, method.conclusionKey, method.defectDescriptionKey, ...LNK_COMMON_HIGHLIGHT_FIELDS]
    : [...LNK_COMMON_HIGHLIGHT_FIELDS]
}

export function getLnkResultHighlightFields(methodKey: WeldFieldKey): WeldFieldKey[] {
  const method = getLnkMethodByRequestKey(methodKey)
  return method
    ? [method.resultKey, method.conclusionDateKey, method.conclusionKey, method.defectDescriptionKey, ...LNK_COMMON_HIGHLIGHT_FIELDS]
    : [...LNK_COMMON_HIGHLIGHT_FIELDS]
}

export function getLnkConclusionHighlightFields(methodKey: WeldFieldKey): WeldFieldKey[] {
  const method = getLnkMethodByRequestKey(methodKey)
  return method ? [method.conclusionKey, ...LNK_COMMON_HIGHLIGHT_FIELDS] : [...LNK_COMMON_HIGHLIGHT_FIELDS]
}

export function getLnkResultReplacementHighlightFields(
  updates: Array<{ methodKey: WeldFieldKey }>,
): WeldFieldKey[] {
  return [
    ...new Set(
      updates.flatMap(({ methodKey }) => {
        const method = getLnkMethodByRequestKey(methodKey)
        return method ? [method.resultKey, method.defectDescriptionKey] : []
      }),
    ),
    ...LNK_COMMON_HIGHLIGHT_FIELDS,
  ]
}
