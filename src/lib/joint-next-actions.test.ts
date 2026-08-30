import { describe, expect, it } from 'vitest'

import type { RepeatedJointCreateTask, WeldRow } from '@/lib/dispatcher-types'
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

  it('opens the weld card before any control for a created repeated joint', () => {
    expect(buildJointNextActions(row({ joint: 'F3R1', weldDate: null }))[0]).toMatchObject({
      kind: 'editWeld',
      title: 'Заполнить сварку F3R1',
    })
  })

  it('guides a PSTO weld through pre-TO request and result first', () => {
    const waitingRequest = row({ pstoRequired: 'да', hasVik: 'да' })
    expect(buildJointNextActions(waitingRequest)[0]).toMatchObject({
      kind: 'preLnkRequest',
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
