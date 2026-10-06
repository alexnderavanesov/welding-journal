import type { RepeatedJointCheckTask, WeldRow } from './dispatcher-types'
import { parseRepeatedJointName } from './joint-chain'
import { isRevisionNotActual } from './revision-actuality'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'
import { CHAIN_ACTUALITY_REASON } from './dispatcher-check-reasons'
import { buildChainActualityGroups } from './chain-actuality'

export function buildChainActualityCheckTasks(rows: readonly WeldRow[], settings: SystemIndexSettings = loadSystemIndexSettings()): RepeatedJointCheckTask[] {
  if (!rows.some(row => isRevisionNotActual(row.revisionActuality))) return []
  return buildChainActualityGroups(rows, settings).groups.filter(group => group.mixed).map(group => {
    const row = group.rows.find(row => isRevisionNotActual(row.revisionActuality))!
    const source = group.rows.find(row => !isRevisionNotActual(row.revisionActuality))!
    const sourceJoint = String(source.joint ?? source.id), targetJoint = String(row.joint ?? row.id)
    return {
      kind: 'check', key: `chain-actuality:${group.id}`, row, sourceRow: source,
      sourceJoint, targetJoint, baseJoint: parseRepeatedJointName(sourceJoint, settings).base,
      suffix: 'R', reason: CHAIN_ACTUALITY_REASON, actualityRowIds: group.rows.map(row => row.id),
      details: 'У одного физического соединения различается актуальность записей. Исключите по ИЗМу всю его R/W-цепочку, включая неофициальные повторы, либо верните актуальность всей цепочке. Перед сохранением будет показан состав изменений. Документы и факты работ сохраняются. Каждая сторона катушки — отдельное соединение и не меняется вместе с вырезанным исходным стыком.',
    } satisfies RepeatedJointCheckTask
  })
}
