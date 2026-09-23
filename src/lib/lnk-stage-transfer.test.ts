import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import { getDispatcherLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { buildPrimaryLnkStageDebtSystemWarnings } from '@/lib/repeated-joint-check-tasks'
import {
  buildClearedPrimaryLnkStageRows,
  buildPreHeatTreatmentToPrimaryTransfer,
  buildPrimaryToPreHeatTreatmentTransfer,
  findBlockingLnkStageTransferChronologyIssue,
} from '@/lib/lnk-stage-transfer'

describe('LNK stage transfer', () => {
  it('moves only the selected primary method to pre-TO and leaves duplicates and unrelated methods intact', () => {
    const duplicateControls: DuplicateControlRecord[] = [{
      id: 51,
      weldJointId: 1,
      method: 'РК',
      result: 'ремонт',
      controlDate: '2026-08-10',
      conclusion: 'Дубль-РК-1',
      conclusionDate: '2026-08-10',
    }]
    const row = makeRow({
      vikRequest: 'Заявка-1',
      vikRequestDate: '2026-08-01',
      vikResult: 'годен',
      vikConclusionDate: '2026-08-02',
      vikConclusion: 'ЗНК-ВИК-1',
      vikDefectDescription: 'ДНО',
      rkRequest: 'РК-1',
      rkResult: 'годен',
      duplicateControls,
    })

    const transfer = buildPrimaryToPreHeatTreatmentTransfer({
      rows: [row],
      positions: [{ rowId: 1, methodCode: 'ВИК' }],
    })

    expect(transfer.controls).toMatchObject([{
      weldJointId: 1,
      method: 'ВИК',
      requestName: 'Заявка-1',
      result: 'годен',
      conclusionName: 'ЗНК-ВИК-1',
      defectDescription: 'ДНО',
    }])
    expect(transfer.rows[0]).toMatchObject({
      vikRequest: null,
      vikResult: null,
      vikConclusion: null,
      vikDefectDescription: null,
      rkRequest: 'РК-1',
      rkResult: 'годен',
    })
    expect(transfer.rows[0]?.duplicateControls).toBe(duplicateControls)
  })

  it('moves a complete pre-TO control to an empty primary stage without touching duplicates', () => {
    const duplicateControls: DuplicateControlRecord[] = [{
      id: 8,
      weldJointId: 1,
      method: 'ВИК',
      result: 'годен',
      controlDate: '2026-08-01',
      conclusion: 'Дубль-ВИК-1',
      conclusionDate: '2026-08-01',
    }]
    const row = makeRow({ duplicateControls })
    const control = {
      id: 10,
      weldJointId: 1,
      method: 'РК',
      requestName: 'Заявка-РК-до',
      requestDate: '2026-08-01',
      result: 'годен',
      conclusionDate: '2026-08-02',
      conclusionName: 'ЗНК-РК-до',
      defectDescription: '0-100: ДНО\n100-0: ДНО',
      rkExposureConfirmedDiameter: 57,
    }

    const [next] = buildPreHeatTreatmentToPrimaryTransfer({ rows: [row], controls: [control] })

    expect(next).toMatchObject({
      rkRequest: 'Заявка-РК-до',
      rkRequestDate: '2026-08-01',
      rkResult: 'годен',
      rkConclusionDate: '2026-08-02',
      rkConclusion: 'ЗНК-РК-до',
      lnkDefectDescription: '0-100: ДНО\n100-0: ДНО',
      rkExposureConfirmedDiameter: 57,
    })
    expect(next.duplicateControls).toBe(duplicateControls)
  })

  it('moves each simple defect description back to its own primary method', () => {
    const [next] = buildPreHeatTreatmentToPrimaryTransfer({
      rows: [makeRow()],
      controls: [
        { id: 10, weldJointId: 1, method: 'ВИК', result: 'ремонт', defectDescription: 'ВИК: пора' },
        { id: 11, weldJointId: 1, method: 'УЗК', result: 'вырез', defectDescription: 'УЗК: трещина' },
        { id: 12, weldJointId: 1, method: 'ПВК', result: 'годен', defectDescription: 'ДНО' },
      ],
    })

    expect(next).toMatchObject({
      vikDefectDescription: 'ВИК: пора',
      uzkDefectDescription: 'УЗК: трещина',
      pvkDefectDescription: 'ДНО',
    })
  })

  it('keeps a request-only position visibly pending after moving it to pre-TO', () => {
    const transfer = buildPrimaryToPreHeatTreatmentTransfer({
      rows: [makeRow({
        vikRequest: 'Заявка-ВИК-1',
        vikRequestDate: '2026-08-01',
      })],
      positions: [{ rowId: 1, methodCode: 'ВИК' }],
    })

    expect(transfer.controls[0]).toMatchObject({
      requestName: 'Заявка-ВИК-1',
      result: 'ожидает НК',
    })
  })

  it('preserves a cancelled completed result when moving the package to pre-TO', () => {
    const transfer = buildPrimaryToPreHeatTreatmentTransfer({
      rows: [makeRow({
        vikRequest: 'Заявка-ВИК-1',
        vikRequestDate: '2026-08-01',
        vikResult: 'годен (отменен)',
        vikConclusionDate: '2026-08-02',
        vikConclusion: 'ЗНК-ВИК-1',
      })],
      positions: [{ rowId: 1, methodCode: 'ВИК' }],
    })

    expect(transfer.controls[0]).toMatchObject({
      requestName: 'Заявка-ВИК-1',
      result: 'годен (отменен)',
      conclusionName: 'ЗНК-ВИК-1',
    })
  })

  it('does not treat a derived waiting label as occupied primary-stage data', () => {
    const row = makeRow({ vikResult: 'ожидает заявку' })
    expect(() => buildPrimaryToPreHeatTreatmentTransfer({
      rows: [row],
      positions: [{ rowId: 1, methodCode: 'ВИК' }],
    })).toThrow('основной комплект ВИК уже пуст')

    const [next] = buildPreHeatTreatmentToPrimaryTransfer({
      rows: [row],
      controls: [{
        id: 10,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка до ТО',
      }],
    })
    expect(next?.vikRequest).toBe('Заявка до ТО')
  })

  it('preserves a good RK exposure scheme when moving it to pre-TO', () => {
    const transfer = buildPrimaryToPreHeatTreatmentTransfer({
      rows: [makeRow({
        rkRequest: 'Заявка-РК-1',
        rkRequestDate: '2026-08-01',
        rkResult: 'годен',
        rkConclusionDate: '2026-08-02',
        rkConclusion: 'ЗНК-РК-1',
        lnkDefectDescription: '0-100: ДНО\n100-0: ДНО',
        rkExposureConfirmedDiameter: 57,
      })],
      positions: [{ rowId: 1, methodCode: 'РК' }],
    })

    expect(transfer.controls[0]).toMatchObject({
      method: 'РК',
      defectDescription: '0-100: ДНО\n100-0: ДНО',
      rkExposureConfirmedDiameter: 57,
    })
    expect(transfer.rows[0]?.lnkDefectDescription).toBeNull()
    expect(transfer.rows[0]?.rkExposureConfirmedDiameter).toBeNull()
  })

  it('moves an RK-only metadata trace to pre-TO instead of leaving hidden primary data', () => {
    const transfer = buildPrimaryToPreHeatTreatmentTransfer({
      rows: [makeRow({
        lnkDefectDescription: '0-100: ДНО',
        rkExposureConfirmedDiameter: 57,
      })],
      positions: [{ rowId: 1, methodCode: 'РК' }],
    })

    expect(transfer.controls[0]).toMatchObject({
      method: 'РК',
      defectDescription: '0-100: ДНО',
      rkExposureConfirmedDiameter: 57,
    })
    expect(transfer.rows[0]?.lnkDefectDescription).toBeNull()
    expect(transfer.rows[0]?.rkExposureConfirmedDiameter).toBeNull()
  })

  it('deletes only selected primary stage fields and preserves assignments, duplicates, BoQ and KS3', () => {
    const duplicateControls = [{
      id: 9,
      weldJointId: 1,
      method: 'ВИК' as const,
      result: 'годен' as const,
      controlDate: '2026-08-01',
      conclusion: 'Дубль-1',
      conclusionDate: '2026-08-01',
    }]
    const [next] = buildClearedPrimaryLnkStageRows({
      rows: [makeRow({
        hasVik: 'да',
        vikRequest: 'Заявка-1',
        vikResult: 'годен',
        vikConclusion: 'ЗНК-1',
        vikDefectDescription: 'ДНО',
        vikBoq: 'BoQ-1',
        vikKs3: 'КС3-1',
        duplicateControls,
      })],
      positions: [{ rowId: 1, methodCode: 'ВИК' }],
    })

    expect(next).toMatchObject({
      hasVik: 'да',
      vikRequest: null,
      vikResult: null,
      vikConclusion: null,
      vikDefectDescription: null,
      vikBoq: 'BoQ-1',
      vikKs3: 'КС3-1',
    })
    expect(next?.duplicateControls).toBe(duplicateControls)
  })

  it('refuses to overwrite an occupied destination stage', () => {
    const row = makeRow({ rkRequest: 'Уже есть' })
    expect(() => buildPreHeatTreatmentToPrimaryTransfer({
      rows: [row],
      controls: [{
        id: 10,
        weldJointId: 1,
        method: 'РК',
        requestName: 'Другая заявка',
      }],
    })).toThrow('основной комплект РК уже заполнен')
  })

  it('treats an existing RK exposure scheme as occupied primary data', () => {
    const row = makeRow({ lnkDefectDescription: '0-100: ДНО' })
    expect(() => buildPreHeatTreatmentToPrimaryTransfer({
      rows: [row],
      controls: [{
        id: 10,
        weldJointId: 1,
        method: 'РК',
        requestName: 'Заявка до ТО',
      }],
    })).toThrow('основной комплект РК уже заполнен')
  })

  it('allows only sequence debt in permissive mode and keeps real date errors blocking', () => {
    const pendingCycleRow = makeRow({ weldDate: '2026-08-01', hasVik: 'да' })
    const pendingControl = {
      id: 10,
      weldJointId: 1,
      method: 'ВИК',
      requestName: 'Заявка ВИК до ТО',
      requestDate: '2026-08-02',
      result: 'годен',
      conclusionDate: '2026-08-02',
    }
    const [pendingNext] = buildPreHeatTreatmentToPrimaryTransfer({
      rows: [pendingCycleRow],
      controls: [pendingControl],
    })

    expect(getDispatcherLnkChronologyIssues([pendingNext!])).not.toContainEqual(
      expect.objectContaining({ kind: 'post-before-psto-cycle' }),
    )
    expect(buildPrimaryLnkStageDebtSystemWarnings([pendingNext!])).toContainEqual(
      expect.objectContaining({ systemWarningCode: 'СП-01' }),
    )
    expect(findBlockingLnkStageTransferChronologyIssue({
      previousRows: [{ ...pendingCycleRow, preHeatTreatmentControls: [pendingControl] }],
      nextRows: [pendingNext!],
      targetStage: 'primary',
    })).toMatchObject({ kind: 'post-before-psto-cycle', methodCode: 'ВИК' })
    expect(findBlockingLnkStageTransferChronologyIssue({
      previousRows: [{ ...pendingCycleRow, preHeatTreatmentControls: [pendingControl] }],
      nextRows: [pendingNext!],
      targetStage: 'primary',
      allowPrimaryStageDebt: true,
    })).toBeUndefined()

    const completedCycleRow = makeRow({
      weldDate: '2026-08-01',
      pstoRequest: 'Заявка ПСТО',
      pstoRequestDate: '2026-08-03',
      pstoResult: 'проведено',
      pstoDate: '2026-08-04',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtRequestDate: '2026-08-04',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-05',
      tvmtConclusion: 'Заключение ТВМТ',
    })
    const [completedNext] = buildPreHeatTreatmentToPrimaryTransfer({
      rows: [completedCycleRow],
      controls: [pendingControl],
    })
    const crossStageKinds = getDispatcherLnkChronologyIssues([completedNext!])
      .map((issue) => issue.kind)

    expect(crossStageKinds).toContain('post-before-psto')
    expect(crossStageKinds).toContain('post-before-tvmt')
    expect(findBlockingLnkStageTransferChronologyIssue({
      previousRows: [{ ...completedCycleRow, preHeatTreatmentControls: [pendingControl] }],
      nextRows: [completedNext!],
      targetStage: 'primary',
      allowPrimaryStageDebt: true,
    })).toMatchObject({ kind: 'post-before-psto', methodCode: 'ВИК' })
  })

  it('still blocks ordinary date errors and invalid moves to pre-TO', () => {
    const invalidControl = {
      id: 10,
      weldJointId: 1,
      method: 'ВИК',
      requestName: 'Заявка ВИК до ТО',
      requestDate: '2026-07-31',
    }
    const row = makeRow({
      weldDate: '2026-08-01',
      preHeatTreatmentControls: [invalidControl],
    })
    const [invalidPrimary] = buildPreHeatTreatmentToPrimaryTransfer({
      rows: [row],
      controls: [invalidControl],
    })
    expect(findBlockingLnkStageTransferChronologyIssue({
      previousRows: [row],
      nextRows: [invalidPrimary!],
      targetStage: 'primary',
    })).toMatchObject({ kind: 'weld-after-request', methodCode: 'ВИК' })

    const primaryRow = makeRow({
      pstoDate: '2026-08-04',
      vikRequest: 'Заявка ВИК основная',
      vikRequestDate: '2026-08-05',
    })
    const transfer = buildPrimaryToPreHeatTreatmentTransfer({
      rows: [primaryRow],
      positions: [{ rowId: 1, methodCode: 'ВИК' }],
    })
    const previewControls = transfer.controls.map((control, index) => ({
      ...control,
      id: -(index + 1),
    }))
    expect(findBlockingLnkStageTransferChronologyIssue({
      previousRows: [primaryRow],
      nextRows: [{ ...transfer.rows[0]!, preHeatTreatmentControls: previewControls }],
      targetStage: 'beforeHeatTreatment',
    })).toMatchObject({ kind: 'pre-after-psto', methodCode: 'ВИК до ТО' })
  })

  it('does not move a too-early date into another LNK stage', () => {
    const primaryRow = makeRow({
      vikRequest: 'Заявка ВИК',
      vikRequestDate: '2023-12-31',
    })
    const toPre = buildPrimaryToPreHeatTreatmentTransfer({
      rows: [primaryRow],
      positions: [{ rowId: 1, methodCode: 'ВИК' }],
    })
    const previewControls = toPre.controls.map((control, index) => ({
      ...control,
      id: -(index + 1),
    }))
    expect(findBlockingLnkStageTransferChronologyIssue({
      previousRows: [primaryRow],
      nextRows: [{ ...toPre.rows[0]!, preHeatTreatmentControls: previewControls }],
      targetStage: 'beforeHeatTreatment',
    })).toMatchObject({ kind: 'request-date-invalid', methodCode: 'ВИК до ТО' })

    const preControl = {
      id: 10,
      weldJointId: 1,
      method: 'ВИК',
      requestName: 'Заявка ВИК до ТО',
      requestDate: '2023-12-31',
    }
    const preRow = makeRow({ preHeatTreatmentControls: [preControl] })
    const [toPrimary] = buildPreHeatTreatmentToPrimaryTransfer({
      rows: [preRow],
      controls: [preControl],
    })
    expect(findBlockingLnkStageTransferChronologyIssue({
      previousRows: [preRow],
      nextRows: [{ ...toPrimary!, preHeatTreatmentControls: [] }],
      targetStage: 'primary',
    })).toMatchObject({ kind: 'request-date-invalid', methodCode: 'ВИК' })
  })
})

function makeRow(overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 1,
    projectTitle: 'Проект',
    subtitleCode: 'Шифр',
    line: 'Линия',
    joint: 'F1',
    pstoRequired: 'да',
    ...overrides,
  }
}
