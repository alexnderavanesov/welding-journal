import { getJointChainIdentity } from '@/lib/joint-display'
import type { WeldInput } from '@/lib/weld-fields'

export function getJointChainConsistencyKey(row: WeldInput) {
  const identity = getJointChainIdentity(row)
  if (!identity) return null
  return `${identity.project}:${identity.subtitle}:${identity.line}:${identity.baseJoint}`
}
