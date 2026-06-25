export type WelderStampRecord = {
  id: number
  naksStamp: string
  internalStamp: string
  weldType: string
  diameterFrom: string
  diameterTo: string
  validFrom: string
  validTo: string
  archived: boolean
}

export type WelderStampFilters = {
  diameterFrom: string
  diameterTo: string
  validFrom: string
  validTo: string
}
