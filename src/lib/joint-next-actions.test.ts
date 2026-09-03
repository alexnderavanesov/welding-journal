import { describe, expect, it } from 'vitest'

import type {
  RepeatedJointCheckTask,
  RepeatedJointCreateTask,
  RepeatedJointDeleteTask,
  WeldRow,
} from '@/lib/dispatcher-types'
import { buildJointNextActions } from '@/lib/joint-next-actions'

describe('joint next actions', () => {
  it('shows the exact repeated joint expected after a rejected result', () => {
    const source = row({ joint: 'F3', finalStatus: 'не годен', rkResult: 'ремонт' })
    const task: RepeatedJointCreateTask = {
      kind: 'create',
      key: 'create:F3:F3R1',
      row: source,
      sourceJoint: 'F3',
      targetJoint: 'F3R1',
      result: 'ремонт',
      suffix: 'R',
      methodCode: 'РК',
    }

    expect(buildJointNextActions(source, [task])[0]).toMatchObject({
      kind: 'dispatcherTask',
      title: 'Создать F3R1',
      buttonLabel: 'Перейти к созданию',
      taskKey: task.key,
    })
  })

  it('shows an accepted early coil as a completed decision instead of an unresolved rejection', () => {
    const source = row({
      joint: 'F51',
      finalStatus: 'не годен',
      rkResult: 'ремонт',
      earlyCoilDecisionAccepted: true,
      chainContinuation: continuation('coil', ['F51Y1', 'F51Y2'], [2, 3]),
    })

    expect(buildJointNextActions(source)).toEqual([
      expect.objectContaining({
        kind: 'complete',
        title: 'Цепочка продолжена катушкой',
        tone: 'success',
      }),
    ])
  })

  it('keeps independent dispatcher checks visible after an accepted early coil', () => {
    const source = row({
      joint: 'F51',
      finalStatus: 'не годен',
      rkResult: 'ремонт',
      earlyCoilDecisionAccepted: true,
      chainContinuation: continuation('coil', ['F51Y1', 'F51Y2'], [2, 3]),
    })
    const task: RepeatedJointCheckTask = {
      kind: 'check',
      key: 'check:F51:stamp',
      row: source,
      sourceRow: source,
      sourceJoint: 'F51',
      targetJoint: 'F51',
      baseJoint: 'F51',
      suffix: 'R',
      reason: 'проверить клеймо',
      details: 'Не заполнено клеймо.',
    }

    expect(buildJointNextActions(source, [task])).toEqual([
      expect.objectContaining({ title: 'Цепочка продолжена катушкой', tone: 'success' }),
      expect.objectContaining({ kind: 'dispatcherTask', taskKey: task.key }),
    ])
  })

  it('shows an existing repeated joint as a resolved decision on the rejected predecessor', () => {
    const source = row({
      joint: 'SB43',
      finalStatus: 'не годен',
      vikResult: 'ремонт',
      chainContinuation: continuation('repeated-joint', ['SB43R1'], [2]),
    })

    expect(buildJointNextActions(source)[0]).toMatchObject({
      kind: 'complete',
      title: 'Цепочка продолжена стыком SB43R1',
      tone: 'success',
    })
  })

  it('shows an official same-name continuation after an unofficial rejected record', () => {
    const source = row({
      joint: 'SB43R1',
      officiality: 'неофициальный',
      finalStatus: 'не годен',
      vikResult: 'ремонт',
      chainContinuation: continuation('official-joint', ['SB43R1'], [2]),
    })

    expect(buildJointNextActions(source)[0]).toMatchObject({
      kind: 'complete',
      title: 'Цепочка продолжена официальным стыком SB43R1',
      tone: 'success',
    })
  })

  it('does not hide an unresolved rejection from an accepted flag without existing coil joints', () => {
    const source = row({
      joint: 'F51',
      finalStatus: 'не годен',
      rkResult: 'ремонт',
      earlyCoilDecisionAccepted: true,
    })

    expect(buildJointNextActions(source)[0]).toMatchObject({
      kind: 'blocked',
      title: 'Ожидается решение по негодному результату',
    })
  })

  it('opens the weld card before any control for a created repeated joint', () => {
    expect(buildJointNextActions(row({ joint: 'F3R1', weldDate: null }))[0]).toMatchObject({
      kind: 'editWeld',
      title: 'Заполнить сварку F3R1',
    })
  })

  it('repairs an obsolete chain row before asking to fill its welding data', () => {
    const source = row({ id: 1, joint: 'F3' })
    const obsolete = row({ id: 2, joint: 'F3R2', weldDate: null })
    const task: RepeatedJointDeleteTask = {
      kind: 'delete',
      key: 'delete:F3R2',
      row: obsolete,
      sourceRow: source,
      sourceJoint: 'F3',
      targetJoint: 'F3R2',
      suffix: 'R',
      reason: 'В цепочке больше нет основания для ремонта.',
    }

    expect(buildJointNextActions(obsolete, [task])[0]).toMatchObject({
      kind: 'dispatcherTask',
      taskKey: task.key,
    })
  })

  it('guides a PSTO weld through pre-TO request and result first', () => {
    const waitingRequest = row({ pstoRequired: 'да', hasVik: 'да', hasRk: 'да' })
    expect(buildJointNextActions(waitingRequest)[0]).toMatchObject({
      kind: 'preLnkRequest',
      description: 'Ожидают заявки: ВИК, РК.',
      methodCode: 'ВИК',
    })

    const waitingResult = row({
      pstoRequired: 'да',
      hasVik: 'да',
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка до ТО',
        requestDate: '2026-08-01',
        result: 'ожидает НК',
      }],
    })
    expect(buildJointNextActions(waitingResult)[0]).toMatchObject({
      kind: 'preLnkResult',
      methodCode: 'ВИК',
    })
  })

  it('opens the initial PSTO request after good pre-TO controls', () => {
    const current = row({
      pstoRequired: 'да',
      hasVik: 'да',
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка до ТО',
        requestDate: '2026-08-01',
        result: 'годен',
        conclusionDate: '2026-08-02',
        conclusionName: 'Заключение до ТО',
      }],
    })

    expect(buildJointNextActions(current)[0]).toMatchObject({
      kind: 'pstoRequest',
      title: 'Создать заявку ПСТО',
    })
  })

  it('skips pre-TO control but preserves the PSTO to TVMT to primary LNK order for an exempt line', () => {
    const beforePsto = row({
      pstoRequired: 'да',
      preHeatTreatmentLnkExempt: true,
      hasVik: 'да',
    })
    expect(buildJointNextActions(beforePsto)[0]).toMatchObject({ kind: 'pstoRequest' })

    const afterTvmt = row({
      ...beforePsto,
      pstoRequest: 'Заявка ПСТО',
      pstoDate: '2026-08-03',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-04',
    })
    expect(buildJointNextActions(afterTvmt)[0]).toMatchObject({ kind: 'primaryLnkRequest' })
  })

  it('guides every physical cycle stage and opens a repeat after failed TVMT', () => {
    const requestedPsto = row({
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО-1',
      pstoRequestDate: '2026-08-02',
      pstoResult: 'ожидает ПСТО',
    })
    expect(buildJointNextActions(requestedPsto)[0]).toMatchObject({
      kind: 'pstoResult',
      title: 'Внести результат ПСТО · цикл 1',
    })

    const performedPsto = row({
      ...requestedPsto,
      pstoDate: '2026-08-03',
      pstoResult: 'проведено',
    })
    expect(buildJointNextActions(performedPsto)[0]).toMatchObject({
      kind: 'tvmtRequest',
      title: 'Создать заявку ТВМТ · цикл 1',
    })

    const requestedTvmt = row({
      ...performedPsto,
      tvmtRequest: 'Заявка ТВМТ-1',
      tvmtRequestDate: '2026-08-04',
      tvmtResult: 'ожидает НК',
    })
    expect(buildJointNextActions(requestedTvmt)[0]).toMatchObject({
      kind: 'tvmtResult',
      title: 'Внести результат ТВМТ · цикл 1',
      description: expect.stringContaining('Негодная ТВМТ потребует повторную ПСТО'),
    })

    const failedTvmt = row({
      ...requestedTvmt,
      tvmtResult: 'не годен',
      tvmtConclusionDate: '2026-08-05',
      tvmtConclusion: 'ЗНК-ТВМТ-1',
    })
    expect(buildJointNextActions(failedTvmt)[0]).toMatchObject({
      kind: 'pstoRequest',
      title: 'Создать заявку повторной ПСТО · цикл 2',
    })

    const requestedRepeat = row({
      ...failedTvmt,
      pstoRepeatCycles: [{
        id: 2,
        weldJointId: 1,
        sequence: 2,
        pstoRequest: 'Заявка ПСТО-2',
        pstoRequestDate: '2026-08-06',
        pstoResult: 'ожидает ПСТО',
      }],
    })
    expect(buildJointNextActions(requestedRepeat)[0]).toMatchObject({
      kind: 'pstoResult',
      title: 'Внести результат ПСТО · цикл 2',
    })
  })

  it('opens primary control only after good TVMT and completed pre-TO control', () => {
    const completedPhysicalCycle = row({
      pstoRequired: 'да',
      hasVik: 'да',
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка до ТО',
        requestDate: '2026-08-01',
        result: 'годен',
        conclusionDate: '2026-08-02',
        conclusionName: 'Заключение до ТО',
      }],
      pstoRequest: 'Заявка ПСТО-1',
      pstoRequestDate: '2026-08-03',
      pstoDate: '2026-08-04',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ-1',
      tvmtRequestDate: '2026-08-05',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-06',
      tvmtConclusion: 'Заключение ТВМТ-1',
    })

    expect(buildJointNextActions(completedPhysicalCycle)[0]).toMatchObject({
      kind: 'primaryLnkRequest',
      title: 'Создать заявку основного НК',
    })
  })

  it('backfills a late PSTO assignment without replacing the preserved primary control', () => {
    const preservedPrimary = row({
      pstoRequired: 'да',
      hasVik: 'да',
      vikRequest: 'Фактическая заявка ВИК',
      vikRequestDate: '2026-08-07',
      vikResult: 'годен',
      vikConclusionDate: '2026-08-08',
      vikConclusion: 'Фактическое заключение ВИК',
      finalStatus: 'ожидает заявку',
    })

    expect(buildJointNextActions(preservedPrimary)[0]).toMatchObject({
      kind: 'preLnkRequest',
      title: 'Создать заявку НК до ТО',
      methodCode: 'ВИК',
    })

    const withPreRequest = row({
      ...preservedPrimary,
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        requestDate: '2026-08-02',
        result: 'ожидает НК',
      }],
    })
    expect(buildJointNextActions(withPreRequest)[0]).toMatchObject({
      kind: 'preLnkResult',
      title: 'Внести результат НК до ТО',
    })

    const completedHistory = row({
      ...preservedPrimary,
      preHeatTreatmentControls: [{
        ...withPreRequest.preHeatTreatmentControls![0]!,
        result: 'годен',
        conclusionDate: '2026-08-03',
        conclusionName: 'Заключение ВИК до ТО',
      }],
      pstoRequest: 'Заявка ПСТО',
      pstoRequestDate: '2026-08-04',
      pstoDate: '2026-08-05',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtRequestDate: '2026-08-05',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-06',
      tvmtConclusion: 'Заключение ТВМТ',
      finalStatus: 'годен',
    })

    expect(buildJointNextActions(completedHistory)[0]).toMatchObject({
      kind: 'complete',
      title: 'Работа по стыку завершена',
    })
  })

  it('finishes an already started physical cycle before backfilling missing pre-TO documents', () => {
    const legacyRow = row({
      pstoRequired: 'да',
      hasVik: 'да',
      pstoRequest: 'Заявка ПСТО-1',
      pstoRequestDate: '2026-08-02',
      pstoResult: 'ожидает ПСТО',
      preHeatTreatmentControls: [],
    })

    expect(buildJointNextActions(legacyRow)[0]).toMatchObject({
      kind: 'pstoResult',
      title: 'Внести результат ПСТО · цикл 1',
    })
  })

  it('finishes a physically started cycle after line cancellation', () => {
    const afterPsto = row({
      pstoRequired: 'отменен',
      pstoRequest: 'Заявка ПСТО-1',
      pstoRequestDate: '2026-08-02',
      pstoDate: '2026-08-03',
      pstoResult: 'проведено',
    })
    expect(buildJointNextActions(afterPsto)[0]).toMatchObject({
      kind: 'tvmtRequest',
      title: 'Создать заявку ТВМТ · цикл 1',
      description: expect.stringContaining('Линия ПСТО отменена'),
    })

    const waitingTvmt = row({
      ...afterPsto,
      tvmtRequest: 'Заявка ТВМТ-1',
      tvmtRequestDate: '2026-08-04',
      tvmtResult: 'ожидает НК',
    })
    expect(buildJointNextActions(waitingTvmt)[0]).toMatchObject({
      kind: 'tvmtResult',
      description: expect.stringContaining('новый повтор не откроется'),
    })

    const failedTvmt = row({
      ...afterPsto,
      tvmtRequest: 'Заявка ТВМТ-1',
      tvmtRequestDate: '2026-08-04',
      tvmtResult: 'не годен',
      tvmtConclusionDate: '2026-08-05',
      tvmtConclusion: 'Заключение ТВМТ-1',
      finalStatus: 'годен',
    })
    expect(buildJointNextActions(failedTvmt)[0]).toMatchObject({
      kind: 'complete',
      title: 'Работа по стыку завершена',
    })
  })

  it('does not start a PSTO cycle for a cancelled line without execution history', () => {
    const current = row({
      pstoRequired: 'отменен',
      hasVik: 'да',
    })

    expect(buildJointNextActions(current)[0]).toMatchObject({
      kind: 'primaryLnkRequest',
      title: 'Создать заявку основного НК',
    })
  })

  it('opens the exact pending primary result and recognizes completion', () => {
    expect(buildJointNextActions(row({
      hasVik: 'да',
      vikRequest: 'Заявка ВИК',
      vikRequestDate: '2026-08-02',
      vikResult: 'ожидает НК',
    }))[0]).toMatchObject({
      kind: 'primaryLnkResult',
      methodCode: 'ВИК',
    })

    expect(buildJointNextActions(row({ finalStatus: 'годен' }))[0]).toMatchObject({
      kind: 'complete',
      title: 'Работа по стыку завершена',
    })
  })

  it('does not let a chronology check hide an available physical action', () => {
    const current = row({
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО-1',
      pstoRequestDate: '2026-08-02',
      pstoResult: 'ожидает ПСТО',
    })
    const task: RepeatedJointCheckTask = {
      kind: 'check',
      key: 'check:chronology',
      row: current,
      sourceRow: current,
      sourceJoint: 'F1',
      targetJoint: 'F1',
      baseJoint: 'F1',
      suffix: 'R',
      details: 'НК после ТО оформлен раньше цикла.',
    }

    expect(buildJointNextActions(current, [task])[0]).toMatchObject({
      kind: 'pstoResult',
      title: 'Внести результат ПСТО · цикл 1',
    })
  })

  it('uses the same primary workflow on percentage lines', () => {
    expect(buildJointNextActions(row({
      weldControlPercent: '10',
      hasVik: 'да',
    }))[0]).toMatchObject({
      kind: 'primaryLnkRequest',
      title: 'Создать заявку основного НК',
    })
  })
})

function row(overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 1,
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'L-1',
    joint: 'F1',
    weldDate: '2026-08-01',
    ...overrides,
  } as WeldRow
}

function continuation(
  kind: NonNullable<WeldRow['chainContinuation']>['kind'],
  targetJoints: string[],
  targetRowIds: number[],
): NonNullable<WeldRow['chainContinuation']> {
  return {
    kind,
    sourceRowId: 1,
    sourceJoint: 'F51',
    targetJoints,
    targetRowIds,
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'L-1',
  }
}
