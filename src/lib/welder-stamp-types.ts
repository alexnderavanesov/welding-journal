export type WelderStampNaksPermit = {
  id: string
  weldType: string
  materialGroups: string
  diameterFrom: string
  diameterTo: string
  thicknessFrom: string
  thicknessTo: string
  validFrom: string
  validTo: string
  note: string
  archived?: boolean
}

export type WelderStampDlsPermit = {
  id: string
  number: string
  weldType: string
  materialGroups: string
  diameterFrom: string
  diameterTo: string
  thicknessFrom: string
  thicknessTo: string
  validFrom: string
  validTo: string
  note: string
  archived?: boolean
}

export type WelderStampRecord = {
  id: number
  naksStamp: string
  welderName: string
  internalStamp: string
  weldType: string
  materialGroups: string
  diameterFrom: string
  diameterTo: string
  thicknessFrom: string
  thicknessTo: string
  validFrom: string
  validTo: string
  naksPermits: WelderStampNaksPermit[]
  dlsPermits: WelderStampDlsPermit[]
  archived: boolean
}

export type WelderStampFilters = {
  diameterFrom: string
  diameterTo: string
  thicknessFrom: string
  thicknessTo: string
  validFrom: string
  validTo: string
}

export type WelderStampSuspensionRecord = {
  id: number
  naksStamp: string
  suspendedFrom: string
  suspendedTo: string
}
