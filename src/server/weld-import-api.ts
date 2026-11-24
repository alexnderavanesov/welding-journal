import { createServerFn } from '@tanstack/react-start'
import { OFFICIAL_STAMP_VALIDATION_FIELD_KEYS } from '@/lib/welder-stamp-compatibility-validation'
import { assertWeldImportRowLimit } from '@/lib/weld-import-limits'
import type { ImportStampInput } from '@/lib/import-stamp-review'
import type { WeldInput } from '@/lib/weld-fields'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import type {
  WeldImportScopeRequest,
  WeldImportScopeResult,
  WeldPayload,
} from '@/server/weld-contracts'

export const reviewWeldImportStamps = createServerFn({ method: 'POST' })
  .validator((data: { records: ImportStampInput[] }) => {
    if (!Array.isArray(data?.records)) throw new Error('Проверьте строки с клеймами.')
    assertWeldImportRowLimit(data.records.length)
    return data.records.map(row => {
      if (!row || typeof row !== 'object') throw new Error('Проверьте строку с клеймом.')
      return Object.fromEntries(OFFICIAL_STAMP_VALIDATION_FIELD_KEYS.map(key => {
        const value = row[key]
        if (value != null && typeof value !== 'string' && typeof value !== 'number') throw new Error('Проверьте значение поля стыка.')
        return [key, value]
      })) as ImportStampInput
    })
  })
  .handler(async ({ data }) => (await import('./weld-save-validation')).reviewImportStampQualifications(data))

export const listWeldingJournalImportScope = createServerFn({ method: 'GET' })
  .validator((data: WeldImportScopeRequest | undefined) => data)
  .handler(async ({ data }): Promise<WeldImportScopeResult> => {
    const server = await import('@/server/weld-import')
    return server.listWeldingJournalImportScope({ data })
  })

export const massFillWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldPayload[]; controlRequestRemovalToken?: string; expectedVersions: WeldRowVersionTarget[] }) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-import')
    return server.massFillWeldJoints({ data })
  })

type ReplaceWeldJointsRequest = {
  controlRequestRemovalToken?: string
  records: WeldPayload[]
  deleteIds: number[]
  expectedVersions: WeldRowVersionTarget[]
}

export const replaceWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: ReplaceWeldJointsRequest) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-import')
    return server.replaceWeldJoints({ data })
  })

export const importWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldInput[]; importId?: string }) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-import')
    return server.importWeldJoints({ data })
  })

export { DATA_IMPORT_SECURITY_SCOPE } from '@/lib/security-scopes'
export { getWeldImportSecurityScope } from '@/server/weld-contracts'
export type {
  WeldImportScopeRequest,
  WeldImportScopeResult,
  WeldImportSecurityAction,
} from '@/server/weld-contracts'
