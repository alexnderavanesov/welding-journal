export type PercentageLineNavigationRequest = {
  id: number
  action: 'assign-missing-controls' | 'open-line'
  projectTitle: string
  subtitleCode: string
  line: string
  stamp: string
  demandKind?: 'common' | 'pvk'
  jointId?: number
}

export type PercentageLineNavigationOutcome = 'opened' | 'stale'
