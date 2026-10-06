import { createHash } from 'node:crypto'
import { createServerOnlyFn } from '@tanstack/react-start'

/** Hash a JSON tuple of records/record arrays without a dataset-sized string.
 * Exactly matches JSON.stringify(parts), retaining existing preview tokens.
 * The caller supplies ordinary arrays, not objects with custom array toJSON.
 */
export const hashJsonRecordTuple = createServerOnlyFn((parts: readonly unknown[]) => {
  const hash = createHash('sha256').update('[')
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    if (index) hash.update(',')
    if (!Array.isArray(part)) { hash.update(JSON.stringify(part) ?? 'null'); continue }
    hash.update('[')
    for (let row = 0; row < part.length; row++) {
      if (row) hash.update(',')
      hash.update(JSON.stringify(part[row]) ?? 'null')
    }
    hash.update(']')
  }
  return hash.update(']').digest('hex')
})
