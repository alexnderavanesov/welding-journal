import { withTouchedLnkFinalStatus } from '@/lib/lnk-field-updates'
import { serializeRkExposureLines, type RkExposureLine } from '@/lib/rk-exposure'
import type { RowWithId } from '@/lib/lnk-report-mutation-types'

export function buildRkExposureEditedRow({
  record,
  lines,
  confirmedDiameter,
}: {
  record: RowWithId
  lines: readonly RkExposureLine[]
  confirmedDiameter: number | null
}) {
  const coordinates = lines.map((line) => line.coordinate.trim()).filter(Boolean)
  if (coordinates.length === 0) throw new Error('Добавьте хотя бы один снимок или диапазон координат')
  if (new Set(coordinates).size !== coordinates.length) throw new Error('Снимки и диапазоны координат не должны повторяться')
  return withTouchedLnkFinalStatus({
    ...record,
    lnkDefectDescription: serializeRkExposureLines(lines),
    rkExposureConfirmedDiameter: confirmedDiameter,
  } as RowWithId)
}
