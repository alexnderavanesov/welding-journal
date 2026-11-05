import type { StatisticsServerRequest, StatisticsServerResult } from './statistics-server-summary'

export const STATISTICS_TRANSPORT = 'statistics-ids-v1' as const
export type StatisticsRpcRequest = StatisticsServerRequest & { transport?: typeof STATISTICS_TRANSPORT }
export type StatisticsResultPayload = { format: typeof STATISTICS_TRANSPORT; data: string }
const prefix = '~ids:'
const isIds = (key: string) => key === 'rowIds' || key.endsWith('RowIds')

// Only transport changes. Dense ID runs avoid repeating hundreds of thousands
// of Seroval number nodes for each metric. Order and duplicates remain intact;
// sparse IDs are represented individually, never sampled or truncated.
function encodeIds(ids: number[]) {
  const runs: string[] = []
  for (let offset = 0; offset < ids.length;) {
    const first = ids[offset]
    let length = 1
    while (offset + length < ids.length && ids[offset + length] === first + length) length++
    runs.push(first.toString(36) + (length > 1 ? `:${length.toString(36)}` : ''))
    offset += length
  }
  return prefix + runs.join(',')
}

function decodeIds(value: string) {
  const encoded = value.slice(prefix.length), ids: number[] = []
  if (!encoded) return ids
  for (const run of encoded.split(',')) {
    if (!/^[0-9a-z]+(?::[0-9a-z]+)?$/.test(run)) throw new Error('Некорректные данные статистики. Обновите отчёт.')
    const [first, count] = run.split(':'), start = parseInt(first, 36), length = count === undefined ? 1 : parseInt(count, 36)
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || length < 1 || !Number.isSafeInteger(start + length - 1)) {
      throw new Error('Некорректные данные статистики. Обновите отчёт.')
    }
    for (let n = 0; n < length; n++) ids.push(start + n)
  }
  return ids
}

export function packStatisticsResult(result: StatisticsServerResult): StatisticsResultPayload {
  const groups = new WeakSet<object>()
  return { format: STATISTICS_TRANSPORT, data: JSON.stringify(result, function (key, value: unknown) {
    // A method's rowIds is a group (requiredRequests, good, ...), whereas
    // dynamics/line/welder drilldowns have direct *RowIds arrays.
    if (isIds(key) && value && typeof value === 'object' && !Array.isArray(value)) groups.add(value)
    return (isIds(key) || groups.has(this)) && Array.isArray(value) && value.every(id => Number.isSafeInteger(id) && id >= 0)
      ? { $statisticsIds: encodeIds(value as number[]) } : value
  }) }
}

export function unpackStatisticsResult(payload: StatisticsResultPayload | StatisticsServerResult): StatisticsServerResult {
  // Existing local caches/test providers may already contain decoded results.
  if (!('format' in payload)) return payload
  if (payload.format !== STATISTICS_TRANSPORT) throw new Error('Обновите страницу статистики.')
  return JSON.parse(payload.data, (_key, value: unknown) => {
    if (value && typeof value === 'object' && '$statisticsIds' in value && Object.keys(value).length === 1 &&
      typeof value.$statisticsIds === 'string' && value.$statisticsIds.startsWith(prefix)) return decodeIds(value.$statisticsIds)
    return value
  }) as StatisticsServerResult
}
