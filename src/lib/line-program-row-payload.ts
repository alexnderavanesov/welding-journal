import type { WeldRow } from './dispatcher-types'
import type { ProgramChainState } from './line-program-chain-state'

type ChainTuple = [number, ProgramChainState['kind'], number | null, number | null, number | null, number | null, boolean, number[]?]
type PackedProgramMetadata = { chainStates?: ChainTuple[]; emptyRepairRequirementIds?: number[] }

/** Lossless wire compaction: share only fields explicitly null in every row. */
export function packProgramRows(rows: WeldRow[]) {
  const nullFields = rows.length ? (Object.keys(rows[0]) as (keyof WeldRow)[]).filter(key => rows.every(row => row[key] === null)) : []
  const shared = new Set<string>(nullFields)
  const chainStates: ChainTuple[] = [], emptyRepairRequirementIds: number[] = []
  const compact = rows.map(row => {
    const state = row.programChainState
    if (state) {
      const packed: ChainTuple = [state.weldJointId, state.kind, state.physicalRootId, state.sourceRowId, state.coilParentId, state.coilSide, state.replacedByCoil]
      if (state.replacementCoilIds !== undefined) packed.push(state.replacementCoilIds)
      chainStates.push(packed)
    }
    if (row.programRepairRequirements?.length === 0) emptyRepairRequirementIds.push(row.id)
    return Object.fromEntries(Object.entries(row).filter(([key]) => !shared.has(key) &&
      !(state && key === 'programChainState') && !(row.programRepairRequirements?.length === 0 && key === 'programRepairRequirements'))) as WeldRow
  })
  return { nullFields, rows: compact, ...(chainStates.length ? { chainStates } : {}), ...(emptyRepairRequirementIds.length ? { emptyRepairRequirementIds } : {}) }
}

export function unpackProgramRows<T extends { rows: WeldRow[]; nullFields?: (keyof WeldRow)[] } & PackedProgramMetadata>(payload: T): T {
  const defaults = Object.fromEntries((payload.nullFields ?? []).map(key => [key, null]))
  const states = new Map<number, ProgramChainState>((payload.chainStates ?? []).map(([weldJointId, kind, physicalRootId, sourceRowId, coilParentId, coilSide, replacedByCoil, replacementCoilIds]) =>
    [weldJointId, { weldJointId, kind, physicalRootId, sourceRowId, coilParentId, coilSide, replacedByCoil, ...(replacementCoilIds === undefined ? {} : { replacementCoilIds }) }]))
  const empty = new Set(payload.emptyRepairRequirementIds)
  return { ...payload, rows: payload.rows.map(row => ({ ...defaults, ...row, ...(states.has(row.id) ? { programChainState: states.get(row.id) } : {}), ...(empty.has(row.id) ? { programRepairRequirements: [] } : {}) })) }
}
