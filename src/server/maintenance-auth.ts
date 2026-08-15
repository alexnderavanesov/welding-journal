import { timingSafeEqual } from 'node:crypto'

export function isMaintenanceRequestAuthorized(
  authorizationHeader: string | null,
  maintenanceToken: string,
) {
  const providedToken = authorizationHeader?.startsWith('Bearer ')
    ? authorizationHeader.slice('Bearer '.length)
    : ''
  const provided = Buffer.from(providedToken)
  const expected = Buffer.from(maintenanceToken)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}
