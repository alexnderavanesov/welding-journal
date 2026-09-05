import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkChronologyIssues, type LnkChronologyIssue } from '@/lib/lnk-chronology-checks'
import { getPstoChronologyIssues, type PstoChronologyIssue } from '@/lib/psto-chronology-checks'
import { buildPstoCycleTimeline, type PstoCycleSnapshot } from '@/lib/psto-cycle'
import { LNK_METHODS } from '@/lib/report-config'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { SaveCheckSettings } from '@/lib/save-check-settings'

export type WorkflowRootCauseTarget =
  | {
      kind: 'weld-field'
      rowId: number
      fieldKey: WeldFieldKey
    }
  | {
      kind: 'lnk-control'
      rowId: number
      stage: 'primary' | 'beforeHeatTreatment'
      methodCode: string
      documentPart: 'request' | 'conclusion' | 'result'
      focus: 'date' | 'name' | 'result'
      relationId?: number
      documentName?: string
      documentDate?: string
    }
  | {
      kind: 'psto-cycle'
      rowId: number
      sequence: number
      cycleId?: number
      stage: 'pstoRequest' | 'pstoResult' | 'tvmtRequest' | 'tvmtResult'
      focus: 'date' | 'name' | 'result'
      documentName?: string
      documentDate?: string
    }
  | {
      kind: 'duplicate-control'
      rowId: number
      relationId?: number
    }

export type WorkflowRootCauseAction = {
  key: string
  label: string
  tone?: 'default' | 'danger' | 'primary'
  target: WorkflowRootCauseTarget
}

export function getLnkChronologyRootCauseActions(
  issues: readonly LnkChronologyIssue[],
): WorkflowRootCauseAction[] {
  return dedupeActions(issues.flatMap(getLnkIssueActions))
}

export function getPstoChronologyRootCauseActions(
  issues: readonly PstoChronologyIssue[],
): WorkflowRootCauseAction[] {
  return dedupeActions(issues.flatMap(getPstoIssueActions))
}

export function getChronologyRootCauseActions({
  lnkIssues = [],
  pstoIssues = [],
}: {
  lnkIssues?: readonly LnkChronologyIssue[]
  pstoIssues?: readonly PstoChronologyIssue[]
}) {
  return dedupeActions([
    ...getLnkChronologyRootCauseActions(lnkIssues),
    ...getPstoChronologyRootCauseActions(pstoIssues),
  ])
}

export function getNewChronologyRootCauseState({
  previousRows,
  proposedRows,
  settings,
}: {
  previousRows: readonly WeldRow[]
  proposedRows: readonly WeldRow[]
  settings: SaveCheckSettings
}) {
  const previousLnkKeys = new Set(getLnkChronologyIssues([...previousRows], settings).map(getLnkIssueKey))
  const previousPstoKeys = new Set(getPstoChronologyIssues([...previousRows], settings).map(getPstoIssueKey))
  const lnkIssues = getLnkChronologyIssues([...proposedRows], settings)
    .filter((issue) => !previousLnkKeys.has(getLnkIssueKey(issue)))
  const pstoIssues = getPstoChronologyIssues([...proposedRows], settings)
    .filter((issue) => !previousPstoKeys.has(getPstoIssueKey(issue)))
  const firstIssue = lnkIssues[0] ?? pstoIssues[0]
  return {
    message: firstIssue?.message ?? null,
    actions: getChronologyRootCauseActions({ lnkIssues, pstoIssues }),
  }
}

function getLnkIssueActions(issue: LnkChronologyIssue): WorkflowRootCauseAction[] {
  if (issue.controlStage === 'duplicate') {
    return [{
      key: `duplicate:${issue.row.id ?? 0}:${issue.relationId ?? 0}`,
      label: 'Открыть дубль-контроль',
      tone: 'primary',
      target: {
        kind: 'duplicate-control',
        rowId: Number(issue.row.id),
        ...(issue.relationId ? { relationId: issue.relationId } : {}),
      },
    }]
  }

  const currentPart = issue.documentPart
  const currentFocus = issue.kind === 'request-name-missing' ? 'name' : currentPart === 'result' ? 'result' : 'date'
  const current = createLnkAction(issue.row as WeldRow, {
    stage: issue.controlStage,
    methodCode: normalizeMethodCode(issue.methodCode),
    documentPart: currentPart,
    focus: currentFocus,
    relationId: issue.relationId,
  })

  if (issue.kind === 'weld-after-request' || issue.kind === 'weld-after-conclusion') {
    return [current, createWeldFieldAction(issue.row, 'weldDate', 'Исправить дату сварки')]
  }
  if (issue.kind === 'request-after-conclusion') {
    return [
      createLnkAction(issue.row as WeldRow, {
        stage: issue.controlStage,
        methodCode: normalizeMethodCode(issue.methodCode),
        documentPart: 'request',
        focus: 'date',
        relationId: issue.relationId,
      }),
      createLnkAction(issue.row as WeldRow, {
        stage: issue.controlStage,
        methodCode: normalizeMethodCode(issue.methodCode),
        documentPart: 'conclusion',
        focus: 'date',
        relationId: issue.relationId,
      }),
    ]
  }
  if (issue.kind === 'pre-after-psto') {
    return [current, createPstoAction(issue.row as WeldRow, {
      sequence: 1,
      stage: 'pstoResult',
      focus: 'date',
    })]
  }
  if (issue.kind === 'post-before-psto') {
    return [current, createPstoActionForCurrentCycle(issue.row as WeldRow, 'pstoResult')]
  }
  if (issue.kind === 'post-before-tvmt') {
    return [current, createPstoActionForCurrentCycle(issue.row as WeldRow, 'tvmtResult')]
  }
  if (issue.kind === 'post-before-psto-cycle') {
    return [
      createPstoActionForCurrentCycle(issue.row as WeldRow, 'pstoResult'),
      createPstoActionForCurrentCycle(issue.row as WeldRow, 'tvmtResult'),
    ]
  }
  if (issue.kind === 'vik-missing-before-other') {
    return [createLnkAction(issue.row as WeldRow, {
      stage: issue.controlStage,
      methodCode: 'ВИК',
      documentPart: 'result',
      focus: 'result',
    })]
  }
  if (issue.kind === 'vik-after-other') {
    return [
      createLnkAction(issue.row as WeldRow, {
        stage: issue.controlStage,
        methodCode: 'ВИК',
        documentPart: 'conclusion',
        focus: 'date',
      }),
      current,
    ]
  }
  return [current]
}

function getPstoIssueActions(issue: PstoChronologyIssue): WorkflowRootCauseAction[] {
  const focus = issue.kind.endsWith('name-missing') ? 'name' : 'date'
  const current = createPstoAction(issue.row as WeldRow, {
    sequence: issue.sequence,
    cycleId: issue.cycleId,
    stage: issue.documentStage,
    focus,
  })
  const sameCycle = (stage: WorkflowPstoStage) => createPstoAction(issue.row as WeldRow, {
    sequence: issue.sequence,
    cycleId: issue.cycleId,
    stage,
    focus: 'date',
  })

  if (issue.kind === 'weld-after-request' || issue.kind === 'weld-after-result') {
    return [current, createWeldFieldAction(issue.row, 'weldDate', 'Исправить дату сварки')]
  }
  if (issue.kind === 'request-after-result') {
    return [sameCycle('pstoRequest'), sameCycle('pstoResult')]
  }
  if (issue.kind === 'previous-tvmt-after-repeat-request') {
    return [
      sameCycle('pstoRequest'),
      createPstoAction(issue.row as WeldRow, {
        sequence: Math.max(1, issue.sequence - 1),
        stage: 'tvmtResult',
        focus: 'date',
      }),
    ]
  }
  if (issue.kind === 'psto-after-tvmt-request') {
    return [sameCycle('pstoResult'), sameCycle('tvmtRequest')]
  }
  if (issue.kind === 'psto-after-tvmt-result') {
    return [sameCycle('pstoResult'), sameCycle('tvmtResult')]
  }
  if (issue.kind === 'tvmt-request-after-result') {
    return [sameCycle('tvmtRequest'), sameCycle('tvmtResult')]
  }
  if (issue.kind === 'repeat-without-failed-tvmt') {
    return [createPstoAction(issue.row as WeldRow, {
      sequence: Math.max(1, issue.sequence - 1),
      stage: 'tvmtResult',
      focus: 'result',
    })]
  }
  return [current]
}

type WorkflowPstoStage = Extract<WorkflowRootCauseTarget, { kind: 'psto-cycle' }>['stage']

function createLnkAction(
  row: WeldRow,
  target: Omit<Extract<WorkflowRootCauseTarget, { kind: 'lnk-control' }>, 'kind' | 'rowId' | 'documentName' | 'documentDate'>,
): WorkflowRootCauseAction {
  const methodCode = normalizeMethodCode(target.methodCode)
  const document = getLnkDocument(row, target.stage, methodCode, target.documentPart)
  const stageLabel = target.stage === 'beforeHeatTreatment' ? ' до ТО' : ''
  const partLabel = target.documentPart === 'request'
    ? 'заявки'
    : target.documentPart === 'conclusion'
      ? 'заключения'
      : 'результат'
  const focusLabel = target.focus === 'date' ? `дату ${partLabel}` : target.focus === 'name' ? `название ${partLabel}` : partLabel
  return {
    key: `lnk:${row.id}:${target.stage}:${methodCode}:${target.documentPart}:${target.focus}:${target.relationId ?? 0}`,
    label: `Исправить ${focusLabel} ${methodCode}${stageLabel}`,
    tone: 'primary',
    target: {
      kind: 'lnk-control',
      rowId: row.id,
      ...target,
      methodCode,
      ...(document.name ? { documentName: document.name } : {}),
      ...(document.date ? { documentDate: document.date } : {}),
    },
  }
}

function createPstoActionForCurrentCycle(row: WeldRow, stage: WorkflowPstoStage) {
  const timeline = buildPstoCycleTimeline(row, row.pstoRepeatCycles ?? [])
  const cycle = timeline.at(-1) ?? ({ source: 'primary', sequence: 1 } as PstoCycleSnapshot)
  return createPstoAction(row, {
    sequence: cycle.sequence,
    cycleId: cycle.id,
    stage,
    focus: 'date',
  })
}

function createPstoAction(
  row: WeldRow,
  target: Omit<Extract<WorkflowRootCauseTarget, { kind: 'psto-cycle' }>, 'kind' | 'rowId' | 'documentName' | 'documentDate'>,
): WorkflowRootCauseAction {
  const cycle = getPstoCycle(row, target.sequence, target.cycleId)
  const document = getPstoDocument(cycle, target.stage)
  const sequenceLabel = target.sequence > 1 ? ` цикла №${target.sequence}` : ''
  const fieldLabel = target.focus === 'date'
    ? getPstoDateLabel(target.stage)
    : target.focus === 'name'
      ? getPstoNameLabel(target.stage)
      : `результат ${target.stage === 'tvmtResult' ? 'ТВМТ' : 'ПСТО'}`
  return {
    key: `psto:${row.id}:${target.sequence}:${target.stage}:${target.focus}`,
    label: `Исправить ${fieldLabel}${sequenceLabel}`,
    tone: 'primary',
    target: {
      kind: 'psto-cycle',
      rowId: row.id,
      ...target,
      ...(document.name ? { documentName: document.name } : {}),
      ...(document.date ? { documentDate: document.date } : {}),
    },
  }
}

function createWeldFieldAction(
  row: { id?: number },
  fieldKey: WeldFieldKey,
  label: string,
): WorkflowRootCauseAction {
  return {
    key: `weld:${Number(row.id)}:${fieldKey}`,
    label,
    tone: 'primary',
    target: { kind: 'weld-field', rowId: Number(row.id), fieldKey },
  }
}

function getLnkDocument(
  row: WeldRow,
  stage: 'primary' | 'beforeHeatTreatment',
  methodCode: string,
  part: 'request' | 'conclusion' | 'result',
) {
  if (stage === 'beforeHeatTreatment') {
    const control = row.preHeatTreatmentControls?.find(
      (candidate) => normalizeMethodCode(candidate.method) === methodCode,
    )
    return part === 'request'
      ? { name: text(control?.requestName), date: dateText(control?.requestDate) }
      : { name: text(control?.conclusionName), date: dateText(control?.conclusionDate) }
  }
  const method = LNK_METHODS.find((candidate) => candidate.code === methodCode)
  if (!method) return { name: '', date: '' }
  return part === 'request'
    ? { name: text(row[method.requestKey]), date: dateText(row[method.requestDateKey]) }
    : { name: text(row[method.conclusionKey]), date: dateText(row[method.conclusionDateKey]) }
}

function getPstoCycle(row: WeldRow, sequence: number, cycleId?: number) {
  const timeline = buildPstoCycleTimeline(row, row.pstoRepeatCycles ?? [])
  return timeline.find((cycle) => cycleId !== undefined
    ? cycle.id === cycleId
    : cycle.sequence === sequence)
    ?? ({ source: sequence > 1 ? 'repeat' : 'primary', sequence } as PstoCycleSnapshot)
}

function getPstoDocument(cycle: PstoCycleSnapshot, stage: WorkflowPstoStage) {
  if (stage === 'pstoRequest') return { name: cycle.pstoRequest, date: cycle.pstoRequestDate }
  if (stage === 'pstoResult') return { name: cycle.heatTreatmentDiagram, date: cycle.pstoDate }
  if (stage === 'tvmtRequest') return { name: cycle.tvmtRequest, date: cycle.tvmtRequestDate }
  return { name: cycle.tvmtConclusion, date: cycle.tvmtConclusionDate }
}

function getPstoDateLabel(stage: WorkflowPstoStage) {
  if (stage === 'pstoRequest') return 'дату заявки ПСТО'
  if (stage === 'pstoResult') return 'дату ПСТО'
  if (stage === 'tvmtRequest') return 'дату заявки ТВМТ'
  return 'дату заключения ТВМТ'
}

function getPstoNameLabel(stage: WorkflowPstoStage) {
  if (stage === 'pstoRequest') return 'название заявки ПСТО'
  if (stage === 'pstoResult') return 'название диаграммы ПСТО'
  if (stage === 'tvmtRequest') return 'название заявки ТВМТ'
  return 'название заключения ТВМТ'
}

function dedupeActions(actions: WorkflowRootCauseAction[]) {
  return [...new Map(actions.map((action) => [action.key, action])).values()]
}

function normalizeMethodCode(value: string) {
  return value
    .replace(/\s+до\s+ТО$/iu, '')
    .replace(/\s*\(дубль\)$/iu, '')
    .trim()
    .toLocaleUpperCase('ru-RU')
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function dateText(value: unknown) {
  return text(value).slice(0, 10)
}

function getLnkIssueKey(issue: LnkChronologyIssue) {
  return [
    issue.kind,
    issue.row.id ?? 0,
    issue.methodCode,
    issue.controlStage,
    issue.documentPart,
    issue.message,
  ].join('\u0000')
}

function getPstoIssueKey(issue: PstoChronologyIssue) {
  return [issue.kind, issue.row.id ?? 0, issue.sequence, issue.documentStage, issue.message].join('\u0000')
}
