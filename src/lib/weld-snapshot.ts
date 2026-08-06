import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldSnapshotPageResult } from '@/server/welds'

type LoadWeldSnapshotOptions = {
  fetchPage: (afterId: number) => Promise<WeldSnapshotPageResult>
  signal?: AbortSignal
}

export async function loadWeldSnapshot({ fetchPage, signal }: LoadWeldSnapshotOptions) {
  const rowsById = new Map<number, WeldRow>()
  let afterId = 0

  while (true) {
    if (signal?.aborted) throw new DOMException('Загрузка полного списка стыков отменена.', 'AbortError')
    const page = await fetchPage(afterId)

    for (const row of page.rows) {
      rowsById.set(Number(row.id), row)
    }

    if (!page.hasMore) break
    if (page.nextAfterId === null || page.nextAfterId <= afterId) {
      throw new Error('Сервер вернул некорректный курсор полной выборки стыков.')
    }
    afterId = page.nextAfterId
  }

  return sortWeldSnapshotRows([...rowsById.values()])
}

export function sortWeldSnapshotRows(rows: WeldRow[]) {
  return [...rows].sort((left, right) => {
    const createdAtOrder = compareNullableDescending(left.createdAt, right.createdAt)
    if (createdAtOrder !== 0) return createdAtOrder

    const weldDateOrder = compareNullableDescending(left.weldDate, right.weldDate)
    if (weldDateOrder !== 0) return weldDateOrder

    const lineOrder = compareNullableAscending(left.line, right.line)
    if (lineOrder !== 0) return lineOrder

    const jointOrder = compareNullableAscending(left.joint, right.joint)
    if (jointOrder !== 0) return jointOrder

    return Number(right.id) - Number(left.id)
  })
}

function compareNullableDescending(left: unknown, right: unknown) {
  const leftValue = toComparableText(left)
  const rightValue = toComparableText(right)
  if (!leftValue && !rightValue) return 0
  if (!leftValue) return 1
  if (!rightValue) return -1
  return rightValue.localeCompare(leftValue)
}

function compareNullableAscending(left: unknown, right: unknown) {
  const leftValue = toComparableText(left)
  const rightValue = toComparableText(right)
  if (!leftValue && !rightValue) return 0
  if (!leftValue) return 1
  if (!rightValue) return -1
  return leftValue.localeCompare(rightValue)
}

function toComparableText(value: unknown) {
  if (value instanceof Date) return value.toISOString()
  return String(value ?? '').trim()
}
