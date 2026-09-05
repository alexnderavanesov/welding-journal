import { createServerFn } from '@tanstack/react-start'
import type { LnkRequestExtensionRequest } from '@/lib/lnk-request-extension'
import type { SystemRepeatedJointRenameRequest } from '@/lib/repeated-joint-system-rename'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type {
  RequestDocumentManagerData,
  RepeatedJointCreateData,
  RepeatedJointDeleteData,
  WeldBatchUpdateData,
  WeldDeleteData,
  WeldDeleteManyData,
  WeldPayload,
  PercentageLineControlUpdateData,
  SystemDocumentDateChangeData,
} from '@/server/weld-contracts'
import type { LnkDefectDescriptionUpdate } from '@/lib/lnk-defect-description'
import type { LnkOfficialityChangeRequest } from '@/lib/lnk-officiality-chain-plan'

export const createEarlyCoilDecision = createServerFn({ method: 'POST' })
  .validator((data: { sourceRowId: number; expectedVersion: string }) => data)
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

export const previewLnkOfficialityChange = createServerFn({ method: 'POST' })
  .validator((data: LnkOfficialityChangeRequest) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/lnk-officiality-workflow')
    return server.previewLnkOfficialityChange({ data })
  })

export const applyLnkOfficialityChange = createServerFn({ method: 'POST' })
  .validator((data: LnkOfficialityChangeRequest) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/lnk-officiality-workflow')
    return server.applyLnkOfficialityChange({ data })
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
  .validator((data: RepeatedJointCreateData) => data)
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

export const updatePercentageLineControls = createServerFn({ method: 'POST' })
  .validator((data: PercentageLineControlUpdateData) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/percentage-line-control-workflow')
    return server.updatePercentageLineControls({ data })
  })

export const extendLnkRequest = createServerFn({ method: 'POST' })
  .validator((data: LnkRequestExtensionRequest) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-mutations')
    return server.extendLnkRequest({ data })
  })

type ClearLnkRequestPositionRequest = {
  rowId: number
  expectedVersion: string
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

export const updateLnkDefectDescription = createServerFn({ method: 'POST' })
  .validator((data: LnkDefectDescriptionUpdate) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/lnk-defect-description-workflow')
    return server.updateLnkDefectDescription({ data })
  })

export const manageLnkRequestDocument = createServerFn({ method: 'POST' })
  .validator((data: RequestDocumentManagerData) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-mutations')
    return server.manageLnkRequestDocument({ data })
  })

export const managePstoRequestDocument = createServerFn({ method: 'POST' })
  .validator((data: RequestDocumentManagerData) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-mutations')
    return server.managePstoRequestDocument({ data })
  })

export const changeSystemDocumentDate = createServerFn({ method: 'POST' })
  .validator((data: SystemDocumentDateChangeData) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/system-document-date-workflow')
    return server.changeSystemDocumentDate({ data })
  })

export const deleteWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: WeldDeleteData) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-mutations')
    return server.deleteWeldJoint({ data })
  })

export const deleteObsoleteRepeatedJoint = createServerFn({ method: 'POST' })
  .validator((data: RepeatedJointDeleteData) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/repeated-joint-delete-workflow')
    return server.deleteObsoleteRepeatedJoint({ data })
  })

export const deleteWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: WeldDeleteManyData) => data)
  .handler(async ({ data }) => {
    const server = await import('@/server/weld-mutations')
    return server.deleteWeldJoints({ data })
  })

export type { WeldBatchUpdateData, WeldMutationScope, WeldPayload } from '@/server/weld-contracts'
