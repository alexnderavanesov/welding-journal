import { createServerFn } from '@tanstack/react-start'
import type { LnkRequestExtensionRequest } from '@/lib/lnk-request-extension'
import type { SystemRepeatedJointRenameRequest } from '@/lib/repeated-joint-system-rename'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldBatchUpdateData, WeldPayload } from '@/server/weld-contracts'

export const createEarlyCoilDecision = createServerFn({ method: 'POST' })
  .validator((data: { sourceRowId: number }) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/early-coil-workflow')
    return server.createEarlyCoilDecision({ data })
  })

export const createWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: WeldPayload) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-mutations')
    return server.createWeldJoint({ data })
  })

export const updateWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: WeldPayload) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-mutations')
    return server.updateWeldJoint({ data })
  })

export const moveWeldJointChain = createServerFn({ method: 'POST' })
  .validator((data: WeldPayload) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-mutations')
    return server.moveWeldJointChain({ data })
  })

export const updateSystemWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: SystemRepeatedJointRenameRequest) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-mutations')
    return server.updateSystemWeldJoint({ data })
  })

export const createWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldPayload[] }) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-mutations')
    return server.createWeldJoints({ data })
  })

export const updateWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: WeldBatchUpdateData) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-mutations')
    return server.updateWeldJoints({ data })
  })

export const extendLnkRequest = createServerFn({ method: 'POST' })
  .validator((data: LnkRequestExtensionRequest) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-mutations')
    return server.extendLnkRequest({ data })
  })

type ClearLnkRequestPositionRequest = {
  rowId: number
  methodKey: WeldFieldKey
  requestName: string
  requestDate: string
}

export const clearLnkRequestPosition = createServerFn({ method: 'POST' })
  .validator((data: ClearLnkRequestPositionRequest) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-mutations')
    return server.clearLnkRequestPosition({ data })
  })

export const deleteLnkRequestDocument = createServerFn({ method: 'POST' })
  .validator((data: { requestName: string; requestDate: string }) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-mutations')
    return server.deleteLnkRequestDocument({ data })
  })

export const deleteWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-mutations')
    return server.deleteWeldJoint({ data })
  })

export const deleteWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { ids: number[] }) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-mutations')
    return server.deleteWeldJoints({ data })
  })

export type { WeldBatchUpdateData, WeldMutationScope, WeldPayload } from '@/server/weld-contracts'
