/** Read-only counterexample and operation-count diagnostics; no database. */
import { buildVisibleDispatcherTasks } from '../src/lib/dispatcher-task-builder'
import { DEFAULT_DISPATCHER_REMINDER_SETTINGS, DEFAULT_DISPATCHER_SETTINGS } from '../src/lib/dispatcher-settings'
import { calculateLineProgram } from '../src/lib/line-program-calculation'
import { programExcessEntries } from '../src/lib/line-program-workspace'
import { buildLineConsistencyTasks } from '../src/lib/line-consistency-tasks'
import type { WeldRow } from '../src/lib/dispatcher-types'
import { programApprovalKey } from '../src/lib/program-control-approval'

for (const size of [0, 20_000, 200_000]) {
  const source = new Set(Array.from({ length: size }, (_, n) => programApprovalKey({ id: n + 1, hasRk: 'да', hasUzk: 'да' }, 'common', true)))
  let visits = 0
  const keys = new Proxy(source, { get(target, property) {
    if (property === Symbol.iterator) return function* () { for (const key of target) { visits++; yield key } }
    const value = Reflect.get(target, property, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  for (const scopes of [1, 100]) {
    visits = 0
    const start = performance.now()
    for (let n = 0; n < scopes; n++) buildVisibleDispatcherTasks({
      acceptedDispatcherWarningKeys: keys, dismissedRepeatedJointTaskKeys: new Set(),
      dispatcherReminderSettings: DEFAULT_DISPATCHER_REMINDER_SETTINGS, dispatcherSettings: DEFAULT_DISPATCHER_SETTINGS,
      rows: [], welderStamps: [], welderStampSuspensions: [], includeRepeatedJointTasks: false, includeWelderStampExpiryTasks: false,
    })
    console.log(JSON.stringify({ exceptions: size, scopes, acceptedKeyVisits: visits, milliseconds: Math.round(performance.now() - start), scope: 'Approval-set preparation only; no weld calculations or SQL' }))
  }
}

const row: WeldRow = { id: 1, lineProgramId: 7, projectTitle: 'AUDIT', subtitleCode: 'S', line: 'L', joint: 'F1',
  weldDate: '2026-09-01', stamp1K: 'K1', connectionType: 'СШ', category: 'II', groupName: 'A',
  weldControlPercent: 30, pvkControlPercent: 10, hasVik: 'да', hasRk: 'да', hasUzk: 'да' }
const accepted = new Set(programExcessEntries(7, [row], calculateLineProgram([row], 30, 10)).map(entry => entry.key))
const warned = (percent: number) => buildLineConsistencyTasks([{ ...row, weldControlPercent: percent }], accepted).some(task => task.fieldKey === 'controlPresence')
console.log(JSON.stringify({ rule: 'Required method combination stays approved independently of quota', percent30: warned(30), percent50: warned(50), backTo30: warned(30), persistedKeys: accepted.size }))
