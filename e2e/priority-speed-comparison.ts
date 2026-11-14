import { createHash } from 'node:crypto'

/** Fresh databases have different transaction/version tokens. Object property
 * insertion order is not a report value; array order and every other field are. */
export function prioritySemanticDigest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value, (key, value) => {
    if (['revision', 'version', 'rowVersion', 'documentVersion', 'updatedAt', 'createdAt', 'specialistsRevision'].includes(key)) return undefined
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value
  })).digest('hex')
}
