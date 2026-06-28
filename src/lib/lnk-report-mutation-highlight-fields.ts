import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import type { WeldFieldKey } from '@/lib/weld-fields'

const LNK_COMMON_HIGHLIGHT_FIELDS = ['lnkCreatedAt', 'finalStatus'] as const

export function getLnkRequestPositionHighlightFields(methodKey: WeldFieldKey): WeldFieldKey[] {
  const method = getLnkMethodByRequestKey(methodKey)
  return method
    ? [method.requestKey, method.resultKey, method.conclusionDateKey, method.conclusionKey, ...LNK_COMMON_HIGHLIGHT_FIELDS]
    : [...LNK_COMMON_HIGHLIGHT_FIELDS]
}

export function getLnkResultHighlightFields(methodKey: WeldFieldKey): WeldFieldKey[] {
  const method = getLnkMethodByRequestKey(methodKey)
  return method
    ? [method.resultKey, method.conclusionDateKey, method.conclusionKey, ...LNK_COMMON_HIGHLIGHT_FIELDS]
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
      updates
        .map(({ methodKey }) => getLnkMethodByRequestKey(methodKey)?.resultKey)
        .filter(Boolean) as WeldFieldKey[],
    ),
    ...LNK_COMMON_HIGHLIGHT_FIELDS,
  ]
}
