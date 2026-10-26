import type { WeldInput } from './weld-fields'
import { isPstoCancelledValue } from './psto-line-assignment'

const PSTO_DOCUMENT_FIELDS = new Set(['pstoRequest', 'tvmtRequest', 'tvmtConclusion'])

/** A position's assignment may be cancelled while the same document still has
 * active positions. Decorate this cell only; never rename the shared document. */
export function formatPstoDocumentDisplay(row: WeldInput, fieldKey: string, value: unknown) {
  if (!PSTO_DOCUMENT_FIELDS.has(fieldKey) || !isPstoCancelledValue(row.pstoRequired) || !String(value ?? '').trim()) return value
  return `${String(value).trim()} (отменен)`
}
