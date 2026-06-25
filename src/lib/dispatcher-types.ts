import type { WeldInput } from '@/lib/weld-fields'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export type WeldRow = WeldInput & { id: number }

export type RepeatedJointCreateTask = {
  kind: 'create'
  key: string
  row: WeldRow
  sourceJoint: string
  targetJoint: string
  result: 'ремонт' | 'вырез'
  suffix: 'R' | 'W'
  methodCode: string
}

export type RepeatedJointCoilTask = {
  kind: 'coil'
  key: string
  row: WeldRow
  sourceJoint: string
  targetJoints: string[]
  result: 'ремонт' | 'вырез'
  methodCode: string
}

export type RepeatedJointDeleteTask = {
  kind: 'delete'
  key: string
  row: WeldRow
  sourceRow: WeldRow
  sourceJoint: string
  targetJoint: string
  suffix: 'R' | 'W'
  reason: string
}

export type RepeatedJointRenameTask = {
  kind: 'rename'
  key: string
  row: WeldRow
  sourceRow: WeldRow
  sourceJoint: string
  currentJoint: string
  targetJoint: string
  baseJoint: string
}

export type RepeatedJointCheckTask = {
  kind: 'check'
  key: string
  row: WeldRow
  sourceRow: WeldRow
  sourceJoint: string
  targetJoint: string
  baseJoint: string
  suffix: 'R' | 'W'
  reason?: string
  details?: string
}

export type RepeatedJointDuplicateCheckTask = {
  kind: 'duplicate-check'
  key: string
  row: WeldRow
  sourceJoint: string
  baseJoint: string
  count: number
}

export type RepeatedJointTask =
  | RepeatedJointCreateTask
  | RepeatedJointCoilTask
  | RepeatedJointDeleteTask
  | RepeatedJointRenameTask
  | RepeatedJointCheckTask
  | RepeatedJointDuplicateCheckTask

export type WelderStampExpiryTask = {
  kind: 'welder-stamp-expiry'
  key: string
  stamp: WelderStampRecord
  naksStamp: string
  validTo: string
  daysLeft: number
  expired: boolean
}

export type DispatcherTask = RepeatedJointTask | WelderStampExpiryTask

export type RepeatedJointTaskGroup = {
  key: string
  baseJoint: string
  tasks: DispatcherTask[]
}
