import { getJointChainIdentity } from '@/lib/joint-display'
import type { WeldInput } from '@/lib/weld-fields'
import { loadSystemIndexSettings, type SystemIndexSettings } from '@/lib/system-index-settings'

export function getJointChainConsistencyKey(
  row: WeldInput,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  const identity = getJointChainIdentity(row, settings)
  if (!identity) return null
  return `${identity.project}:${identity.subtitle}:${identity.line}:${identity.baseJoint}`
}
