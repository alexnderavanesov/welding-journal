import type { WeldRow } from './dispatcher-types'
import { calculateLineProgram, getLineProgramOfficialStamps, getLineProgramRowDemand, hasRejectedLineProgramControl, isLineProgramCalculationRow, isLineProgramControlRow, type LineProgramDemandKind } from './line-program-calculation'
import { buildLineProgramTopology } from './line-program-topology'
import { buildLineProgramDisplay } from './line-program-display'
import { getProgramRemovalHints, projectProgramExcess, partitionProgramExcess } from './line-program-excess'
import { attachProgramRepairRequirements } from './line-program-repair-requirements'
import { getControlAssignmentRemovalHistory } from './control-assignment-history'
import { buildSupportProgramContext, getSupportChainMethodState } from './support-program-calculation'
import { normalizeControlAvailabilityStorageText } from './control-availability-values'
import type { SystemIndexSettings } from './system-index-settings'
import { programExcessEntries } from './line-program-workspace'
import { isAngularConnectionType } from './connection-type'

export const PROGRAM_EXPLANATION_LISTS = {
  physical: 'Расчётные соединения', sources: 'Источники добора — первичный брак РК/УЗК', covered: 'Зачтённые стыки',
  assigned: 'Назначенные стыки', results: 'Стыки с результатом', cancelled: 'Отменённые назначения',
  additional: 'Дополнительный контроль', missing: 'К назначению', excess: 'Лишний контроль',
  overquota: 'Сверх нормы', duplicates: 'Несколько способов на одном стыке', approved: 'Согласованный контроль',
  candidates: 'Доступные кандидаты', excluded: 'Не участвуют в расчёте или зачёте',
  obligations: 'Обязательные назначения ремонта', protected: 'Защищённые назначения', reduction: 'Безопасное сокращение',
} as const
export type ProgramExplanationList = keyof typeof PROGRAM_EXPLANATION_LISTS

export const PROGRAM_EXPLANATION_DESCRIPTIONS: Record<ProgramExplanationList, string> = {
  physical: 'Из этих соединений считается база: количество × процент с округлением. R/W не увеличивают численность. Общий стык участвует в расчёте каждого своего клейма.',
  sources: 'Первичный брак РК/УЗК увеличивает норму своего клейма. Повторные результаты и несколько методов одного источника не умножают добор.',
  covered: 'Зачёт дают действующее назначение, собственный выполненный контроль или допустимая отмена. Это не число годных заключений. В сумме по клеймам один общий стык может закрывать несколько мест; в списке он показан один раз.',
  assigned: 'Считаются стыки с «да» или «дополнительный», включая назначения до сварки и допустимую послойную замену РК/УЗК. Несколько методов на одном стыке не увеличивают число назначенных стыков. Назначение само по себе не гарантирует процентный зачёт: ниже приведена причина для каждого стыка.',
  results: 'Показаны стыки с выполненным контролем, в том числе с негодным результатом. Выполнение и зачёт нормы — разные показатели; история результатов сохраняется.',
  cancelled: 'Отдельно показана допустимая отмена контроля. Отмена не является выполненным результатом и не входит в безопасное сокращение.',
  additional: '«Дополнительный» закрывает норму и добор на подходящем стыке, но сам не считается лишним и не предлагается к снятию.',
  missing: 'К назначению = текущая потребность − зачтённые места, не меньше нуля. Текущая потребность ограничена зачётом и доступными кандидатами. В списке — доступные варианты для незакрытых групп, а не автоматически выбранные назначения. Недостижимая часть теоретической нормы не является долгом.',
  excess: '«Лишнее» объединяет обычные назначения сверх нормы и повторные обычные взаимозаменяемые методы. Считаются назначения методов, не строки списка; повторы одного назначения по клеймам не умножают итог. Превышение не означает, что всё можно снять: история, обязательный ремонт и потребность других клейм защищены.',
  overquota: 'Обычные назначения «Да» сверх нормы. «Дополнительный» закрывает недобор, но не вытесняет обычные назначения в пределах нормы. Защищённые факты и обязательное наследство сохраняются; не всё превышение можно снять.',
  duplicates: 'Несколько взаимозаменяемых обычных методов на одном стыке не дают несколько мест зачёта. Второй метод назначается как «Дополнительный» с основанием; два «Да» не допускаются.',
  approved: 'Отдельное согласование больше не используется. Нужный дополнительный контроль обозначается статусом «Дополнительный» с основанием.',
  candidates: 'Подходящие стыки без негодности, на которых ещё можно закрыть потребность назначением. Число кандидатов не равно числу требуемых назначений.',
  excluded: 'Эти записи не участвуют в численности или зачёте по указанной причине. Их фактическая история не удаляется.',
  obligations: 'Ремонт R/W сохраняет состояния «Да», «Дополнительный» и «Отменен» от официального непосредственного родителя. Их нельзя снять или заменить. От неофициального родителя копирование свободное. R/W не дают процентного зачёта.',
  protected: 'Эти назначения защищены историей, обязательными методами, послойной заменой или потребностью клейм.',
  reduction: 'Это конкретный безопасный набор назначений «да»: их можно снять вместе без нарушения норм всех клейм. Считаются назначения методов, не стыки. «Доп», защищённая история и обязательные методы не предлагаются к снятию. При сохранении данные проверяются повторно.',
}

/** Same engine and projection as the table. Only the requested composition is sent;
 * no quota formula or mutable historical claim is invented by the presentation. */
export type ProgramExplanationOptions = {
  stamp?: string; kind: LineProgramDemandKind; list: ProgramExplanationList; settings?: SystemIndexSettings;
  lineId?: number; approved?: ReadonlySet<string>; support?: boolean
}

function buildExplanation(input: readonly WeldRow[], percent: number, pvkPercent: number, options: ProgramExplanationOptions) {
  const approved = options.approved ?? new Set<string>(), lineId = options.lineId ?? 0
  const rows = attachProgramRepairRequirements(input, approved, options.settings)
  const raw = calculateLineProgram(rows, percent, pvkPercent, options.settings, approved, options.support)
  const groups = projectProgramExcess(lineId, rows, raw, approved)
  const kind = options.kind, p = kind === 'common' ? percent : pvkPercent, full = !options.support && p === 100
  const supportContext = options.support ? buildSupportProgramContext(rows, options.settings) : null
  const sameStamp = (stamp: string) => stamp.toLocaleLowerCase('ru') === options.stamp?.toLocaleLowerCase('ru')
  const active = groups.filter(group => full ? group.scope === 'line' : group.scope !== 'line' && (!options.stamp || sameStamp(group.stamp)))
  const supportMembers = supportContext && options.stamp ? new Set(active.flatMap(group => [...group.rowIds, ...group.contextRowIds ?? []])) : null
  const relevant = rows.filter(row => !options.stamp || getLineProgramOfficialStamps(row).some(sameStamp) || supportMembers?.has(row.id))
  const relevantIds = new Set(relevant.map(row => row.id))
  const physical = new Set(active.flatMap(group => group.rowIds).filter(id => relevantIds.has(id)))
  const covered = new Set(active.flatMap(group => group[kind].coveredRowIds).filter(id => relevantIds.has(id)))
  const candidates = new Set(active.flatMap(group => group[kind].candidateRowIds).filter(id => relevantIds.has(id)))
  const sources = new Set(kind === 'common' ? active.flatMap(group => group.rejectedRowIds).filter(id => relevantIds.has(id)) : [])
  const hints = getProgramRemovalHints(lineId, rows, raw, approved)
  const display = buildLineProgramDisplay(rows, groups, percent, pvkPercent, hints, options.support)
  const view = options.stamp ? display.stampRows.find(group => sameStamp(group.stamp)) : display.summary
  const d = view?.[kind]
  const topology = supportContext?.topology ?? buildLineProgramTopology(rows, percent === 100, options.settings)
  const displayPhysical = new Set(topology.physicalRows.filter(isLineProgramControlRow).map(row => row.id))
  const extra = new Set(groups.flatMap(group => [...group.common.excessRowIds, ...group.pvk.excessRowIds]))
  const completed = new Set(active.flatMap(group => group[kind].completedRowIds))
  const cancelled = new Set(active.flatMap(group => group[kind].cancelledRowIds))
  const missingCandidates = new Set(active.filter(group => group[kind].missing > 0).flatMap(group => group[kind].candidateRowIds))
  const pending = partitionProgramExcess(programExcessEntries(lineId, rows, raw), approved).pending
  const excessByRow = new Map<number, typeof pending>()
  for (const entry of pending) if (entry.kind === kind && (!options.stamp || full || sameStamp(entry.stamp))) {
    const entries = excessByRow.get(entry.rowId) ?? []; entries.push(entry); excessByRow.set(entry.rowId, entries)
  }
  const obligation = (row: WeldRow) => (row.programRepairRequirements ?? []).filter(item => kind === 'pvk' ? item.method === 'ПВК' : item.method !== 'ПВК')
  const removal = (row: WeldRow) => [...(hints.get(row.id)?.entries() ?? [])].filter(([method]) => kind === 'pvk' ? method === 'ПВК' : method !== 'ПВК')
  // Index dependencies once, not one scan of all welder groups per row.
  const owners = new Map<number, string[]>()
  for (const group of groups) if (group.scope !== 'line' && group[kind].coveredRowIds.length <= group[kind].required) {
    for (const id of group[kind].coveredRowIds) {
      const values = owners.get(id) ?? []; values.push(group.stamp); owners.set(id, values)
    }
  }
  const protection = (row: WeldRow) => {
    const reasons = obligation(row).map(item => item.reason)
    for (const [method, field] of kind === 'pvk' ? [['ПВК', 'hasPvk']] as const : [['РК', 'hasRk'], ['УЗК', 'hasUzk']] as const) {
      if (normalizeControlAvailabilityStorageText(row[field]) === 'дополнительный') reasons.push(`${method}: дополнительный контроль не предлагается к снятию.`)
      if (getControlAssignmentRemovalHistory(row, field)) reasons.push(`${method}: защищены выполненные факты и зависимости этапов.`)
    }
    if (row.layeredControlAssigned) reasons.push('Послойная замена связана с отдельным комплектом документов.')
    if (covered.has(row.id) && !removal(row).length) {
      const stamps = owners.get(row.id)
      reasons.push(stamps?.length ? `Назначение нужно для потребности клейм: ${stamps.join(', ')}.` : 'Назначение сохраняется в безопасном наборе покрытия линии.')
    }
    return [...new Set(reasons)]
  }
  const exclusion = (row: WeldRow) => {
    const reason = topology.excluded.get(row.id)
    if (options.support) {
      if (reason === 'repair') return 'Ремонт ОП относится к исходной физической опоре: её численность и зачёт не удваиваются. Контроль учитывается по цепочке.'
      if (!physical.has(row.id)) return 'Не входит в расчётную базу опор: нужны действующая официальная физическая опора, дата сварки и официальное клеймо.'
      return ''
    }
    if (reason === 'repair') return 'R/W — обязательство ремонта, не новое соединение и не процентный зачёт.'
    if (reason === 'replaced') return 'Исходное соединение заменено катушкой: его численность и зачёт исключены; допустимый первичный источник добора сохраняется.'
    if (reason === 'incomplete-coil') return 'Замена катушкой ещё не завершена: для процента нужны обе сваренные стороны; при 100% — обе созданные записи.'
    if (!(percent === 100 ? isLineProgramControlRow(row) : isLineProgramCalculationRow(row))) return 'Не подходит по типу соединения, официальности, актуальности, сварке или наличию клейма.'
    if (kind === 'pvk' && hasRejectedLineProgramControl(row)) return 'ПВК не даёт зачёт из-за негодности стыка, даже при собственном годном ПВК. Исторический результат не изменён.'
    if (hasRejectedLineProgramControl(row) && !covered.has(row.id)) return 'Негодный стык без собственного выполненного РК/УЗК не закрывает потребность и не является кандидатом.'
    return ''
  }
  const details = relevant.flatMap(row => {
    let reason = ''
    const state = supportContext ? getSupportChainMethodState(supportContext.members.get(row.id) ?? [row], kind) : getLineProgramRowDemand(row, kind)
    const layered = kind === 'common' && row.layeredControlAssigned && isAngularConnectionType(row.connectionType) && !hasRejectedLineProgramControl(row)
    if (options.list === 'assigned' && (displayPhysical.has(row.id) || options.stamp && extra.has(row.id)) && (state.assigned || state.additional)) reason = `${layered ? 'Учтена послойная замена РК/УЗК' : state.assigned ? 'Есть обычное назначение «да»' : 'Назначен дополнительный контроль'}${state.assigned && state.additional ? ' и дополнительный контроль' : ''}. ${covered.has(row.id) ? 'Стык участвует в зачёте нормы.' : exclusion(row) || 'Назначение сохранено, но стык пока не входит в процентный зачёт.'}`
    if (options.list === 'results' && completed.has(row.id)) reason = `${layered ? 'Учтена послойная замена с собственным результатом основного ПВК; это не отдельный результат РК/УЗК.' : 'Контроль выполнен.'}${hasRejectedLineProgramControl(row) ? ' Есть негодный результат; он не скрывается из истории.' : ''} ${covered.has(row.id) ? 'Стык даёт зачёт нормы.' : 'Выполнение не даёт зачёт в текущем состоянии стыка.'}`
    if (options.list === 'cancelled' && cancelled.has(row.id)) reason = 'Допустимая отмена назначения; это не выполненное заключение.'
    if (options.list === 'additional' && state.additional && isLineProgramControlRow(row) && (!supportContext || displayPhysical.has(row.id))) reason = `Дополнительный контроль не предлагается к снятию.${covered.has(row.id) ? ' Закрывает место в норме.' : ' В текущем состоянии не даёт процентный зачёт.'}`
    if (options.list === 'missing' && missingCandidates.has(row.id)) reason = 'Можно выбрать для назначения в незакрытой группе. Программа не назначает этот стык автоматически.'
    if (['excess', 'overquota', 'duplicates'].includes(options.list)) {
      const entries = (excessByRow.get(row.id) ?? []).filter(entry => options.list === 'excess' || entry.duplicate === (options.list === 'duplicates'))
      const reasons = [...new Set(entries.map(entry => `${entry.method ?? (kind === 'pvk' ? 'ПВК' : 'РК/УЗК')}: ${entry.duplicate ? 'второе обычное назначение взаимозаменяемого метода на одном стыке; дополнительного места зачёта не даёт' : 'обычное назначение сверх нормы расчётной группы'}${entry.stamp ? ` (${entry.stamp})` : ''}.`))]
      if (reasons.length) reason = `${reasons.join(' ')} ${removal(row).length ? removal(row).map(([method, text]) => `${method}: ${text}`).join(' ') : `Не входит в безопасное сокращение. ${protection(row).join(' ')}`}`
    }
    if (options.list === 'physical' && physical.has(row.id)) reason = 'Подходящее физическое соединение; все официальные клейма учитываются без повторов.'
    if (options.list === 'sources' && sources.has(row.id)) reason = full || !p ? 'Первичный брак РК/УЗК; при этом проценте добор равен нулю.' : `Первичный брак РК/УЗК: +${p === 1 ? 1 : 2} на каждое уникальное официальное клеймо, независимо от числа методов и дублей. При четырёх источниках действует полный контроль клейма.`
    if (options.list === 'covered' && covered.has(row.id)) {
      reason = options.support ? `${state.completed ? 'Выполненный контроль исходной ОП или её ремонта' : 'Действующее назначение ОП или её ремонта'} даёт одно место физической опоры. Брак и ремонт не увеличивают норму и не удваивают зачёт.` : `${layered ? 'Послойная замена РК/УЗК' : state.completed ? 'Собственный выполненный контроль' : state.cancelled ? 'Допустимая отмена' : 'Действующее назначение'} ${full ? 'даёт одно место в норме всей линии независимо от числа клейм' : 'даёт одно зачётное место на каждое уникальное официальное клеймо'}.${kind === 'common' && hasRejectedLineProgramControl(row) ? ' Выполненный РК/УЗК сохраняет зачёт при браке до физической замены катушкой.' : ''}`
    }
    if (options.list === 'candidates' && candidates.has(row.id)) reason = options.support ? 'Сваренная физическая опора с клеймом; метод не отменён и ещё не закрыт назначением или выполненным контролем.' : 'Подходящий первичный стык или стык катушки без негодности; потребность ещё не закрыта назначением.'
    if (options.list === 'excluded') reason = exclusion(row)
    if (options.list === 'obligations') reason = obligation(row).map(item => item.reason).join('. ')
    if (options.list === 'protected') reason = protection(row).join(' ')
    if (options.list === 'reduction') reason = removal(row).map(([method, text]) => `${method}: ${text}`).join(' ')
    return reason ? [{ id: row.id, joint: String(row.joint ?? row.id), stamps: getLineProgramOfficialStamps(row).join(', '), reason }] : []
  }).sort((a, b) => a.id - b.id)
  const subject = options.stamp ? `Клеймо ${options.stamp}` : full ? 'Вся линия' : options.support ? 'Сумма независимых норм официальных клейм опор' : 'Сумма мест по клеймам (общий стык даёт место каждому своему клейму)'
  const math = full ? [`${physical.size} × 100% = ${d?.baseRequired ?? 0}.`] : active.slice(0, 20).map(group => {
    const demand = group[kind]
    if (options.support) return `${group.stamp}: ${group.rowIds.length} × ${p}% → округление вверх: ${demand.required}. Доступно ${group.rowIds.length - demand.cancelledRowIds.length}; потребность к закрытию ${demand.actionableRequired}.`
    return `${group.stamp}: ${group.rowIds.length} × ${p}% → база ${demand.baseRequired}; ${kind === 'common' ? group.rejectedRowIds.length : 0} источников → добор ${demand.additionalRequired}; норма ${demand.required}.${kind === 'common' && group.fullControlRequired ? ' Четыре первичных брака: полный контроль клейма.' : ''}`
  })
  return { total: details.length, math, mathGroupCount: active.length, explanation: options.support ? SUPPORT_EXPLANATION_DESCRIPTIONS[options.list] ?? PROGRAM_EXPLANATION_DESCRIPTIONS[options.list] : PROGRAM_EXPLANATION_DESCRIPTIONS[options.list],
    summary: `${subject}: ${physical.size} расчётных физических соединений. ${options.support ? `Расчётная норма ${d?.required ?? 0}.` : `База ${d?.baseRequired ?? 0} + добор ${d?.additionalRequired ?? 0} = расчётная норма ${d?.required ?? 0}.`} Зачтено ${options.stamp || full ? covered.size : active.reduce((n, group) => n + group[kind].coveredRowIds.length, 0)}; доступно для назначения ${candidates.size}; текущая потребность ${d?.actionableRequired ?? 0}. К назначению: ${d?.missing ?? 0}. Безопасное сокращение: ${relevant.reduce((n, row) => n + removal(row).length, 0)} назначений — выделенный набор можно снять вместе.`,
    rules: options.support ? 'УЗК и ПВК опор считаются независимо по сваренным физическим ОП каждого клейма, включая норму 100%. Округление вверх; минимум процента 0,5%. Добор и эскалация по браку не применяются. Отмена невыполненного метода уменьшает доступный состав, но не заменяет результат. Ремонт не добавляет физическую опору.' : `${kind === 'pvk' ? 'ПВК негодного стыка не засчитывается даже при собственном годном ПВК; добор ПВК равен нулю.' : 'Добор дают только первичные РК/УЗК: при ровно 1% — +1, при другом проценте ниже 100% — +2; четыре источника включают полный контроль клейма. Собственный выполненный РК/УЗК сохраняет зачёт при браке до катушки.'} R/W не входят в процент. Недостижимая часть нормы не является долгом. Округление до ближайшего целого, половина вверх; при положительном проценте и ненулевой численности минимум один.`,
    issues: topology.issues.filter(issue => relevantIds.has(issue.rowId)).slice(0, 20), issueCount: topology.issues.filter(issue => relevantIds.has(issue.rowId)).length,
    rows: details,
  }
}

const SUPPORT_EXPLANATION_DESCRIPTIONS: Partial<Record<ProgramExplanationList, string>> = {
  physical: 'База — сваренные физические опоры с официальным клеймом. Норма каждого метода и клейма округляется вверх. Длина и ремонтные записи численность не увеличивают.',
  sources: 'Для опор добор по браку не применяется.',
  covered: 'Физическая опора даёт одно место по действующему назначению или выполненному контролю своей цепочки. Брак и ремонт не отменяют зачёт. Это не число годных результатов.',
  assigned: 'Показаны физические опоры с действующим назначением «да» или «дополнительный» на исходной записи или её ремонте. Ранние назначения до сварки видны отдельно от процентной базы.',
  results: 'Показаны физические опоры с выполненным контролем на исходной записи или её ремонте, включая негодные результаты. Несколько результатов цепочки не увеличивают число опор.',
  cancelled: 'Показана отмена невыполненного метода. Отмена не даёт зачёт и уменьшает доступный состав этого метода; при наличии замены потребность остаётся.',
  candidates: 'Сваренные физические опоры с клеймом, у которых метод не отменён и ещё не закрыт назначением или выполненным контролем.',
  obligations: 'Ремонт повторяет обязательный контроль по истории исходной ОП. Он не создаёт новой физической опоры; назначение и выполненный контроль учитываются в её цепочке.',
}

export function explainLineProgram(input: readonly WeldRow[], percent: number, pvkPercent: number, options: ProgramExplanationOptions & { page: number }) {
  const result = buildExplanation(input, percent, pvkPercent, options)
  const pageSize = 50, page = Math.min(Math.max(0, Math.floor(options.page)), Math.max(0, Math.ceil(result.total / pageSize) - 1))
  return { ...result, page, pageSize, rows: result.rows.slice(page * pageSize, (page + 1) * pageSize) }
}

/** Full composition, with exactly the same rules as the paged explanation. */
export function selectLineProgramExplanationRows(input: readonly WeldRow[], percent: number, pvkPercent: number, options: ProgramExplanationOptions): WeldRow[] {
  const ids = new Set(buildExplanation(input, percent, pvkPercent, options).rows.map(row => row.id))
  return input.filter(row => ids.has(row.id))
}
