import type { PercentageLineStampSummary, PercentageLineSummary } from '@/lib/percentage-line-summary'

export type PercentageLineNavigationRequest = {
  id: number
  action: 'assign-missing-controls'
  projectTitle: string
  subtitleCode: string
  line: string
  stamp: string
}

export type PercentageLineNavigationOutcome = 'opened' | 'stale'

export function isPercentageLineNavigationViewReady(
  request: PercentageLineNavigationRequest | null | undefined,
  view: {
    allPeriod: boolean
    projectFilter: string
    selectedSubtitles: readonly string[]
    search: string
  },
) {
  if (!request) return true

  const expectedSubtitle = normalize(request.subtitleCode)
  const selectedSubtitles = view.selectedSubtitles.map(normalize).filter(Boolean)
  const subtitleMatches = expectedSubtitle
    ? selectedSubtitles.length === 1 && selectedSubtitles[0] === expectedSubtitle
    : selectedSubtitles.length === 0

  return (
    view.allPeriod &&
    normalize(view.projectFilter) === normalize(request.projectTitle) &&
    subtitleMatches &&
    normalize(view.search) === normalize(request.stamp)
  )
}

export function findPercentageLineNavigationTarget(
  summaries: readonly PercentageLineSummary[],
  request: PercentageLineNavigationRequest,
): { line: PercentageLineSummary; stamp: PercentageLineStampSummary } | null {
  const line = summaries.find((candidate) => (
    normalize(candidate.projectTitle) === normalize(request.projectTitle) &&
    normalize(candidate.subtitleCode) === normalize(request.subtitleCode) &&
    normalize(candidate.line) === normalize(request.line)
  ))
  if (!line) return null

  const stamp = line.stamps.find((candidate) => normalize(candidate.stamp) === normalize(request.stamp))
  return stamp ? { line, stamp } : null
}

function normalize(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU')
}
