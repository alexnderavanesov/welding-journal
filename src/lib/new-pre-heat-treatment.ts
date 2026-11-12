import type { WeldInput } from './weld-fields'
import type { WeldRow } from './dispatcher-types'
import type { SystemIndexSettings } from './system-index-settings'
import { buildChainActualityGroups } from './chain-actuality'

export function getNewPreHeatTreatmentInheritance(record: WeldInput, existing: WeldRow[], settings: SystemIndexSettings) {
  const group = buildChainActualityGroups([...existing, { ...record, id: -1 }], settings).groups.find(group => group.rows.some(row => row.id === -1))
  const stored = group?.rows.filter(row => row.id > 0) ?? []
  return { inherited: stored.length > 0, required: stored.some(row => row.preHeatTreatmentRequired === true),
    rootJoint: String(stored.find(row => row.id === group?.id)?.joint ?? stored[0]?.joint ?? '') }
}
