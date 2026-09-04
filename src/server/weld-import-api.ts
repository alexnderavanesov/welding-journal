import { createServerFn } from '@tanstack/react-start'
import type { WeldInput } from '@/lib/weld-fields'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import type {
  WeldImportScopeRequest,
  WeldImportScopeResult,
  WeldPayload,
} from '@/server/weld-contracts'

export const listWeldingJournalImportScope = createServerFn({ method: 'GET' })
  .validator((data: WeldImportScopeRequest | undefined) => data)
  .handler(async ({ data }): Promise<WeldImportScopeResult> => {
    const server = await import('@/server/weld-import')
    return server.listWeldingJournalImportScope({ data })
  })

export const massFillWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldPayload[]; expectedVersions: WeldRowVersionTarget[] }) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-import')
    return server.massFillWeldJoints({ data })
  })

type ReplaceWeldJointsRequest = {
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
  .validator((data: { records: WeldInput[] }) => data)
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
