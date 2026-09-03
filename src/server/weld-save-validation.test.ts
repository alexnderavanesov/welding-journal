import { describe, expect, it, vi } from 'vitest'

import type { WeldJoint } from '@/db/schema'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import {
  buildPstoAssignedKeepPrimaryValidationRow,
  getPstoLineIdentityKey,
} from '@/lib/psto-line-assignment'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import type { WeldInput } from '@/lib/weld-fields'
import {
  getPrimaryPstoLifecycleDestructiveChangeReason,
  getSystemWorkflowStageTransitionReason,
  loadPreviousWeldRows,
  mergeWeldRecordsWithPrevious,
  prepareServerWeldRecords,
  validateServerWeldRecords,
  type ServerWeldValidationContext,
} from '@/server/weld-save-validation'

const context: ServerWeldValidationContext = {
  saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS,
  dataListSettings: DEFAULT_DATA_LIST_SETTINGS,
  otherSettings: DEFAULT_OTHER_SETTINGS,
  systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
  welderStamps: [],
  welderStampSuspensions: [],
  pstoLineAssignments: new Map(),
}

describe('validateServerWeldRecords', () => {
  it('locks stored weld rows before merging a scoped workflow update', async () => {
    const lockModes: string[] = []
    const stored = { id: 5, joint: 'F5' } as WeldJoint
    const select = vi.fn(() => {
      const builder = {
        from: () => builder,
        where: () => builder,
        orderBy: () => builder,
        for: (mode: string) => {
          lockModes.push(mode)
          return Promise.resolve([stored])
        },
        then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve([]).then(resolve, reject),
      }
      return builder
    })

    const rows = await loadPreviousWeldRows(
      { select } as never,
      [{ id: stored.id }],
    )

    expect(lockModes).toEqual(['update'])
    expect(rows.get(stored.id)).toEqual(expect.objectContaining({ id: stored.id, joint: 'F5' }))
  })

  it('blocks removing an assigned method while its pre-TO position still exists', () => {
    const previous = {
      id: 41,
      joint: 'F41',
      hasRk: 'да',
      pstoRequired: 'да',
      preHeatTreatmentControls: [{
        id: 11,
        weldJointId: 41,
        method: 'РК',
        requestName: 'Заявка РК до ТО',
        result: 'ожидает НК',
      }],
    } as unknown as WeldJoint
    const record = { ...previous, hasRk: null } as unknown as WeldInput

    expect(getSystemWorkflowStageTransitionReason(record, previous, context))
      .toContain('нельзя снять назначение')
    expect(getSystemWorkflowStageTransitionReason(
      { ...record, hasRk: 'отменен' },
      previous,
      context,
    )).toBe('')
  })

  it('blocks a saved weld date without a material group and allows disabling ZВ-29', () => {
    const record = {
      joint: 'F1',
      weldDate: '2026-07-01',
      materialGroup: '',
      connectionType: 'С17',
      weldingMethod: 'РД',
    } as WeldInput
    const contextWithoutRootCheck = {
      ...context,
      dataListSettings: {
        ...DEFAULT_DATA_LIST_SETTINGS,
        connectionTypes: ['С17'],
        weldingTypes: ['РД'],
      },
      saveCheckSettings: {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        requiredRootStampWithWeldDate: false,
        requiredConnectionTypeWithWeldDate: false,
      },
    }

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context: contextWithoutRootCheck,
    })).toThrow('ЗВ-29')

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context: {
        ...contextWithoutRootCheck,
        saveCheckSettings: {
          ...contextWithoutRootCheck.saveCheckSettings,
          requiredMaterialGroupWithWeldDate: false,
        },
      },
    })).not.toThrow()
  })

  it('blocks a saved weld date without a connection type and allows disabling ZВ-30', () => {
    const record = {
      joint: 'F1',
      weldDate: '2026-07-01',
      materialGroup: 'М01',
      connectionType: '',
      weldingMethod: 'РД',
    } as WeldInput
    const contextWithoutRootCheck = {
      ...context,
      dataListSettings: {
        ...DEFAULT_DATA_LIST_SETTINGS,
        materialGroups: ['М01'],
      },
      saveCheckSettings: {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        requiredRootStampWithWeldDate: false,
      },
    }

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context: contextWithoutRootCheck,
    })).toThrow('ЗВ-30')

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context: {
        ...contextWithoutRootCheck,
        saveCheckSettings: {
          ...contextWithoutRootCheck.saveCheckSettings,
          requiredConnectionTypeWithWeldDate: false,
        },
      },
    })).not.toThrow()
  })

  it('validates required weld fields after a partial update is merged with the stored row', () => {
    const previous = {
      id: 9,
      projectTitle: 'Проект',
      subtitleCode: 'Шифр',
      line: 'Линия',
      joint: 'F9',
      weldDate: null,
      materialGroup: null,
      connectionType: null,
      weldingMethod: null,
    } as WeldJoint
    const [record] = mergeWeldRecordsWithPrevious(
      [{ id: previous.id, weldDate: '2026-07-01' }],
      new Map([[previous.id, previous]]),
    )

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context: {
        ...context,
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          requiredRootStampWithWeldDate: false,
        },
      },
      importMode: true,
    })).toThrow('ЗВ-29')

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context: {
        ...context,
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          requiredRootStampWithWeldDate: false,
          requiredMaterialGroupWithWeldDate: false,
        },
      },
      importMode: true,
    })).toThrow('ЗВ-30')

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context: {
        ...context,
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          requiredRootStampWithWeldDate: false,
          requiredMaterialGroupWithWeldDate: false,
          requiredConnectionTypeWithWeldDate: false,
        },
      },
      importMode: true,
    })).toThrow('ЗВ-31')
  })

  it('blocks a saved weld date without a welding method and allows disabling ZВ-31', () => {
    const record = {
      joint: 'F1',
      weldDate: '2026-07-01',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: '',
    } as WeldInput
    const validationContext = {
      ...context,
      dataListSettings: {
        ...DEFAULT_DATA_LIST_SETTINGS,
        connectionTypes: ['С17'],
        materialGroups: ['М01'],
      },
      saveCheckSettings: {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        requiredRootStampWithWeldDate: false,
      },
    }

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context: validationContext,
    })).toThrow('ЗВ-31')

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context: {
        ...validationContext,
        saveCheckSettings: {
          ...validationContext.saveCheckSettings,
          requiredWeldingMethodWithWeldDate: false,
        },
      },
    })).not.toThrow()
  })

  it('keeps an existing indexed base valid after the setting is disabled', () => {
    const previous = { id: 7, joint: 'FB01', responsible: '' } as WeldJoint
    const record = { ...previous, responsible: 'Иванов' } as unknown as WeldInput

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context,
    })).not.toThrow()
  })

  it('blocks a new indexed base until the project setting is enabled', () => {
    const record = { joint: 'FB01' } as WeldInput

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context,
    })).toThrow('ЗВ-26')

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context: {
        ...context,
        systemIndexSettings: {
          ...DEFAULT_SYSTEM_INDEX_SETTINGS,
          allowLeadingLetterIndex: true,
        },
      },
    })).not.toThrow()
  })

  it('blocks an old malformed joint name on the next edit', () => {
    const previous = { id: 8, joint: 'F1R', responsible: '' } as WeldJoint
    const record = { ...previous, responsible: 'Петров' } as unknown as WeldInput

    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context,
    })).toThrow('ЗВ-26')
  })

  it('allows a validated system descendant of an indexed base', () => {
    expect(() => validateServerWeldRecords({
      records: [{ joint: 'FB01R1' }],
      previousRows: new Map(),
      context,
      allowSystemJointNames: true,
    })).not.toThrow()
  })

  it('rejects empty identity fields in import mode', () => {
    expect(() => validateServerWeldRecords({
      records: [{ projectTitle: 'Проект', subtitleCode: '', line: 'Линия', joint: 'F1' }],
      previousRows: new Map(),
      context,
      importMode: true,
    })).toThrow('обязательные поля не могут быть пустыми: Шифр')
  })

  it('merges a partial update with the stored row without clearing omitted fields', () => {
    const previous = {
      id: 5,
      projectTitle: 'Риформинг',
      subtitleCode: '400',
      line: 'LIN-001',
      joint: 'F5',
    } as WeldJoint

    expect(mergeWeldRecordsWithPrevious(
      [{ id: 5, responsible: 'Иванов' }],
      new Map([[5, previous]]),
    )).toEqual([
      expect.objectContaining({
        id: 5,
        projectTitle: 'Риформинг',
        subtitleCode: '400',
        line: 'LIN-001',
        joint: 'F5',
        responsible: 'Иванов',
      }),
    ])
  })

  it('keeps system control relations from storage instead of accepting payload replacements', () => {
    const duplicate = { id: 11, weldJointId: 5, method: 'РК', result: 'ремонт' }
    const preControl = { id: 12, weldJointId: 5, method: 'ВИК', result: 'годен' }
    const repeatCycle = { id: 13, weldJointId: 5, sequence: 2, pstoResult: 'проведено' }
    const previous = {
      id: 5,
      joint: 'F5',
      duplicateControls: [duplicate],
      preHeatTreatmentControls: [preControl],
      pstoRepeatCycles: [repeatCycle],
    } as unknown as WeldJoint

    const [merged] = mergeWeldRecordsWithPrevious(
      [{
        id: 5,
        responsible: 'Иванов',
        duplicateControls: [],
        preHeatTreatmentControls: [],
        pstoRepeatCycles: [],
      } as WeldInput],
      new Map([[5, previous]]),
    ) as Array<WeldInput & {
      duplicateControls: unknown[]
      preHeatTreatmentControls: unknown[]
      pstoRepeatCycles: unknown[]
    }>

    expect(merged.duplicateControls).toEqual([duplicate])
    expect(merged.preHeatTreatmentControls).toEqual([preControl])
    expect(merged.pstoRepeatCycles).toEqual([repeatCycle])
  })

  it('recalculates the final status from stored staged-control relations', () => {
    const previous = {
      id: 50,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-50',
      joint: 'F50',
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      hasVik: 'да',
      hasRk: 'да',
      hasPvk: 'да',
      vikRequest: 'ВИК после ТО',
      vikResult: 'годен',
      rkRequest: 'РК после ТО',
      rkResult: 'годен',
      pvkRequest: 'ПВК после ТО',
      pvkResult: 'годен',
      pstoRequest: 'ПСТО-1',
      pstoResult: 'проведено',
      tvmtRequest: 'ТВМТ-1',
      tvmtResult: null,
      finalStatus: 'ожидает заявку',
      preHeatTreatmentControls: ['ВИК', 'РК', 'ПВК'].map((method, index) => ({
        id: 100 + index,
        weldJointId: 50,
        method,
        requestName: `${method} до ТО`,
        result: 'годен',
      })),
      pstoRepeatCycles: [{
        id: 200,
        weldJointId: 50,
        sequence: 2,
        pstoRequest: 'ПСТО-2',
        pstoResult: 'проведено',
        tvmtRequest: 'ТВМТ-2',
        tvmtResult: 'годен',
      }],
    } as unknown as WeldJoint
    const [record] = mergeWeldRecordsWithPrevious(
      [{ id: previous.id, responsible: 'Иванов', finalStatus: 'ожидает заявку' }],
      new Map([[previous.id, previous]]),
    )
    const lineKey = getPstoLineIdentityKey(previous)

    prepareServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context: {
        ...context,
        pstoLineAssignments: new Map([[lineKey, { rowCount: 1, assignedCount: 1 }]]),
      },
    })

    expect(record.finalStatus).toBe('годен')
  })

  it('does not accept a client-provided final status', () => {
    const record = {
      joint: 'F51',
      weldDate: '2026-08-01',
      finalStatus: 'годен',
    } as WeldInput

    prepareServerWeldRecords({ records: [record], previousRows: new Map(), context })

    expect(record.finalStatus).toBe('ожидает заявку')
  })

  it('recalculates system WDI when only the connection type changes', () => {
    const previous = {
      id: 6,
      joint: 'F6',
      connectionType: 'С17',
      d1: 57,
      d2: 108,
      wdi: 4.25,
    } as WeldJoint
    const record = {
      ...previous,
      connectionType: 'У17',
    } as unknown as WeldInput

    prepareServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context: {
        ...context,
        otherSettings: {
          ...DEFAULT_OTHER_SETTINGS,
          wdiCalculationMode: 'formula',
        },
      },
    })

    expect(record.wdi).toBe(2.24)
  })

  it('inherits the target-line PSTO assignment without reusing an old cancellation basis', () => {
    const record = {
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-1',
      joint: 'F1',
      pstoRequired: '',
    } as WeldInput
    const lineKey = getPstoLineIdentityKey(record)

    prepareServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context: {
        ...context,
        pstoLineAssignments: new Map([[lineKey, {
          rowCount: 5,
          assignedCount: 5,
          basis: 'Проект',
        }]]),
      },
    })

    expect(record.pstoRequired).toBe('да')
    expect(record.pstoControlBasis).toBeNull()
  })

  it('ignores a manual per-joint PSTO value on a line without PSTO', () => {
    const record = {
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-2',
      joint: 'F2',
      pstoRequired: 'дополнительный',
      pstoControlBasis: 'Ручное',
    } as WeldInput

    prepareServerWeldRecords({ records: [record], previousRows: new Map(), context })

    expect(record.pstoRequired).toBeNull()
    expect(record.pstoControlBasis).toBeNull()
  })

  it('preserves an old partial line during an unrelated edit but blocks adding another row to it', () => {
    const previous = {
      id: 30,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-3',
      joint: 'F30',
      pstoRequired: 'да',
      pstoControlBasis: 'Старое',
    } as WeldJoint
    const lineKey = getPstoLineIdentityKey(previous)
    const partialContext = {
      ...context,
      pstoLineAssignments: new Map([[lineKey, {
        rowCount: 4,
        assignedCount: 1,
        basis: 'Старое',
      }]]),
    }
    const existingRecord = { ...previous, responsible: 'Иванов' } as unknown as WeldInput

    prepareServerWeldRecords({
      records: [existingRecord],
      previousRows: new Map([[previous.id, previous]]),
      context: partialContext,
    })
    expect(existingRecord.pstoRequired).toBe('да')

    expect(() => prepareServerWeldRecords({
      records: [{ ...previous, id: undefined, joint: 'F31' } as WeldInput],
      previousRows: new Map(),
      context: partialContext,
    })).toThrow('Программе ПСТО')
  })

  it('blocks a move to a line without PSTO when staged history exists', () => {
    const previous = {
      id: 31,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-4',
      joint: 'F31',
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО',
    } as WeldJoint
    const record = { ...previous, line: 'L-5' } as unknown as WeldInput

    expect(() => prepareServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context,
    })).toThrow('уже есть документы ПСТО/ТВМТ')
  })

  it('does not treat duplicate controls as staged PSTO history', () => {
    const previous = {
      id: 32,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-6',
      joint: 'F32',
      pstoRequired: 'да',
      duplicateControls: [{ id: 1, method: 'РК', result: 'ремонт' }],
    } as unknown as WeldJoint
    const record = { ...previous, line: 'L-7' } as unknown as WeldInput

    prepareServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context,
    })

    expect(record.pstoRequired).toBeNull()
    expect((previous as unknown as { duplicateControls: unknown[] }).duplicateControls).toHaveLength(1)
  })

  it('protects the primary PSTO cycle after TVMT or a repeat cycle exists', () => {
    const previous = {
      id: 33,
      joint: 'F33',
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО-1',
      pstoRequestDate: '2026-08-01',
      pstoResult: 'проведено',
      pstoDate: '2026-08-02',
      heatTreatmentDiagram: 'Диаграмма-1',
      tvmtRequest: 'Заявка ТВМТ-1',
      tvmtResult: 'годен',
      pstoRepeatCycles: [],
    } as unknown as WeldJoint

    expect(getPrimaryPstoLifecycleDestructiveChangeReason({
      ...previous,
      pstoResult: null,
      pstoDate: null,
    } as unknown as WeldInput, previous)).toContain('Нельзя удалить первичную')

    expect(getPrimaryPstoLifecycleDestructiveChangeReason({
      ...previous,
      heatTreatmentDiagram: 'Диаграмма-2',
    } as unknown as WeldInput, previous)).toBe('')

    expect(() => validateServerWeldRecords({
      records: [{
        ...previous,
        pstoRequest: null,
        pstoResult: null,
        pstoDate: null,
      } as unknown as WeldInput],
      previousRows: new Map([[previous.id, previous]]),
      context,
    })).toThrow('последующие этапы')
  })

  it('does not let duplicate controls activate the primary PSTO cycle protection', () => {
    const previous = {
      id: 34,
      joint: 'F34',
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО-1',
      pstoResult: 'проведено',
      pstoDate: '2026-08-02',
      duplicateControls: [{ id: 1, method: 'ТВМТ', result: 'годен' }],
      pstoRepeatCycles: [],
    } as unknown as WeldJoint

    expect(getPrimaryPstoLifecycleDestructiveChangeReason({
      ...previous,
      pstoRequest: null,
      pstoResult: null,
      pstoDate: null,
    } as unknown as WeldInput, previous)).toBe('')
  })

  it('blocks new primary PSTO data while the line assignment is partial', () => {
    const previous = {
      id: 35,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-8',
      joint: 'F35',
      pstoRequired: 'да',
    } as WeldJoint
    const lineKey = getPstoLineIdentityKey(previous)

    const record = {
      ...previous,
      pstoRequest: 'ПСТО-001',
      pstoRequestDate: '2026-08-20',
    } as unknown as WeldInput
    const partialLineContext = {
      ...context,
      pstoLineAssignments: new Map([[lineKey, {
        rowCount: 3,
        assignedCount: 1,
        basis: '',
      }]]),
    }

    expect(getSystemWorkflowStageTransitionReason(
      record,
      previous,
      partialLineContext,
    )).toContain('Программе ПСТО')
    expect(() => validateServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context: partialLineContext,
    })).toThrow('Программе ПСТО')
  })

  it('blocks an imported move of an existing primary LNK set onto a PSTO line', () => {
    const previous = {
      id: 351,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-обычная',
      joint: 'F351',
      pstoRequired: null,
      vikRequest: 'Заявка ВИК-001',
      vikResult: 'годен',
      vikConclusion: 'Заключение ВИК-001',
      preHeatTreatmentControls: [],
      pstoRepeatCycles: [],
    } as unknown as WeldJoint
    const record = { ...previous, line: 'L-ПСТО' } as unknown as WeldInput
    const assignedTargetContext = {
      ...context,
      pstoLineAssignments: new Map([[getPstoLineIdentityKey(record), {
        rowCount: 2,
        assignedCount: 2,
        cancelledCount: 0,
      }]]),
    }

    expect(() => prepareServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context: assignedTargetContext,
      importMode: true,
    })).toThrow('сохранить основной комплект')
  })

  it('does not demand a pre-TO stage decision when a moved weld inherits an exemption', () => {
    const previous = {
      id: 354,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-обычная',
      joint: 'F354',
      pstoRequired: null,
      vikRequest: 'Заявка ВИК-001',
      vikResult: 'годен',
      vikConclusion: 'Заключение ВИК-001',
      preHeatTreatmentControls: [],
      pstoRepeatCycles: [],
    } as unknown as WeldJoint
    const record = {
      ...previous,
      line: 'L-ПСТО-освобождена',
      preHeatTreatmentLnkExempt: true,
    } as unknown as WeldInput

    expect(() => prepareServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context: {
        ...context,
        pstoLineAssignments: new Map([[getPstoLineIdentityKey(record), {
          rowCount: 2,
          assignedCount: 2,
          cancelledCount: 0,
        }]]),
      },
      importMode: true,
    })).not.toThrow()
    expect(record.pstoRequired).toBe('да')
  })

  it('allows an explicit keep-primary move to create only the temporary DZ-20 backfill task', () => {
    const previous = {
      id: 353,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-обычная',
      joint: 'F353',
      pstoRequired: null,
      hasVik: 'да',
      vikRequest: 'Заявка ВИК основная',
      vikRequestDate: '2026-08-07',
      vikResult: 'годен',
      vikConclusionDate: '2026-08-08',
      vikConclusion: 'Заключение ВИК основное',
    } as unknown as WeldJoint
    const assigned = {
      ...previous,
      line: 'L-ПСТО',
      pstoRequired: 'да',
    } as unknown as WeldInput

    expect(() => validateServerWeldRecords({
      records: [assigned],
      previousRows: new Map([[previous.id, previous]]),
      context,
    })).toThrow('до завершения цикла ПСТО и ТВМТ')

    expect(() => validateServerWeldRecords({
      records: [assigned],
      previousRows: new Map([[
        previous.id,
        buildPstoAssignedKeepPrimaryValidationRow(previous as unknown as WeldRow) as unknown as WeldJoint,
      ]]),
      context,
    })).not.toThrow()
  })

  it('allows importing the same line move when the weld has only duplicate control data', () => {
    const previous = {
      id: 352,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-обычная',
      joint: 'F352',
      pstoRequired: null,
      vikResult: 'ожидает заявку',
      duplicateControls: [{ id: 1, method: 'ВИК', result: 'годен' }],
      preHeatTreatmentControls: [],
      pstoRepeatCycles: [],
    } as unknown as WeldJoint
    const record = { ...previous, line: 'L-ПСТО' } as unknown as WeldInput

    expect(prepareServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context: {
        ...context,
        pstoLineAssignments: new Map([[getPstoLineIdentityKey(record), {
          rowCount: 2,
          assignedCount: 2,
          cancelledCount: 0,
        }]]),
      },
      importMode: true,
    })[0]?.pstoRequired).toBe('да')
  })

  it('blocks an imported move with PSTO history onto an officially cancelled line', () => {
    const previous = {
      id: 353,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-ПСТО',
      joint: 'F353',
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО-001',
      pstoResult: 'проведено',
      preHeatTreatmentControls: [],
      pstoRepeatCycles: [],
    } as unknown as WeldJoint
    const record = { ...previous, line: 'L-отменена' } as unknown as WeldInput

    expect(() => prepareServerWeldRecords({
      records: [record],
      previousRows: new Map([[previous.id, previous]]),
      context: {
        ...context,
        pstoLineAssignments: new Map([[getPstoLineIdentityKey(record), {
          rowCount: 2,
          assignedCount: 0,
          cancelledCount: 2,
          cancellationDate: '2026-08-20',
          cancellationBasis: 'ТР-1',
        }]]),
      },
      importMode: true,
    })).toThrow('перенос через карточку стыка')
  })

  it('blocks post-TO LNK until the PSTO and TVMT cycle is complete', () => {
    const previous = {
      id: 36,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-9',
      joint: 'F36',
      pstoRequired: 'да',
      hasVik: 'да',
      preHeatTreatmentControls: [{
        id: 20,
        weldJointId: 36,
        method: 'ВИК',
        requestName: 'ВИК до ТО',
        result: 'годен',
      }],
    } as unknown as WeldJoint
    const lineKey = getPstoLineIdentityKey(previous)

    expect(getSystemWorkflowStageTransitionReason({
      ...previous,
      vikRequest: 'ВИК после ТО',
      vikRequestDate: '2026-08-20',
    } as unknown as WeldInput, previous, {
      pstoLineAssignments: new Map([[lineKey, {
        rowCount: 2,
        assignedCount: 2,
        basis: '',
      }]]),
    })).toContain('после ТО недоступен')
  })

  it('does not let a duplicate TVMT result unlock the primary TVMT workflow', () => {
    const previous = {
      id: 37,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-10',
      joint: 'F37',
      pstoRequired: 'да',
      duplicateControls: [{ id: 30, method: 'ТВМТ', result: 'годен' }],
    } as unknown as WeldJoint
    const lineKey = getPstoLineIdentityKey(previous)

    expect(getSystemWorkflowStageTransitionReason({
      ...previous,
      tvmtRequest: 'ТВМТ-001',
      tvmtRequestDate: '2026-08-20',
    } as unknown as WeldInput, previous, {
      pstoLineAssignments: new Map([[lineKey, {
        rowCount: 1,
        assignedCount: 1,
        basis: '',
      }]]),
    })).toContain('ожидает заявку ПСТО')
  })

  it('checks VIK chronology when only another NDT result is changed', () => {
    const previous = {
      id: 19,
      joint: 'F19',
      weldDate: '2026-07-01',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: 'РД',
      stamp1K: 'АВС1',
      hasRk: 'да',
      rkResult: null,
    } as WeldJoint
    const record = {
      ...previous,
      rkResult: 'годен',
      rkConclusionDate: '2026-07-03',
    } as unknown as WeldInput

    expect(() =>
      validateServerWeldRecords({
        records: [record],
        previousRows: new Map([[previous.id, previous]]),
        context,
      }),
    ).toThrow('ЗВ-18')
  })

  it('uses remotely configured welding methods for server-side stamp validation', () => {
    const customContext: ServerWeldValidationContext = {
      ...context,
      dataListSettings: {
        ...DEFAULT_DATA_LIST_SETTINGS,
        connectionTypes: ['С17'],
        materialGroups: ['М01'],
        weldingTypes: ['МАД'],
      },
      welderStamps: [{
        id: 1,
        naksStamp: 'АВС1',
        welderName: 'Иванов Иван',
        internalStamp: '',
        weldType: 'МАД',
        materialGroups: 'М01',
        diameterFrom: '',
        diameterTo: '',
        thicknessFrom: '',
        thicknessTo: '',
        validFrom: '',
        validTo: '',
        naksPermits: [{
          id: 'naks-custom',
          weldType: 'МАД',
          materialGroups: 'М01',
          diameterFrom: '1',
          diameterTo: '100',
          thicknessFrom: '1',
          thicknessTo: '10',
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
          note: '',
        }],
        dlsPermits: [],
        archived: false,
        archivedAt: '',
      }],
    }
    const record = {
      joint: 'S1',
      weldDate: '2026-07-15',
      weldingMethod: 'МАД',
      connectionType: 'С17',
      materialGroup: 'М01',
      d1: 57,
      d2: 57,
      t1: 3,
      t2: 3,
      stamp1K: 'АВС1',
    } as WeldInput

    expect(() =>
      validateServerWeldRecords({
        records: [record],
        previousRows: new Map(),
        context: customContext,
      }),
    ).not.toThrow()
  })

  it('accepts either thickness and either diameter during server-side stamp validation', () => {
    const customContext: ServerWeldValidationContext = {
      ...context,
      dataListSettings: {
        ...DEFAULT_DATA_LIST_SETTINGS,
        connectionTypes: ['С17'],
        materialGroups: ['M01'],
        weldingTypes: ['РАД'],
      },
      welderStamps: [{
        id: 1,
        naksStamp: 'E0SM',
        welderName: 'Морозов Яков',
        internalStamp: '',
        weldType: 'РАД',
        materialGroups: 'M01',
        diameterFrom: '',
        diameterTo: '',
        thicknessFrom: '',
        thicknessTo: '',
        validFrom: '',
        validTo: '',
        naksPermits: [{
          id: 'naks-either-dt',
          weldType: 'РАД',
          materialGroups: 'M01',
          diameterFrom: '50',
          diameterTo: '60',
          thicknessFrom: '2',
          thicknessTo: '14',
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
          note: '',
        }],
        dlsPermits: [],
        archived: false,
        archivedAt: '',
      }],
    }
    const record = {
      joint: 'S1',
      weldDate: '2026-07-15',
      weldingMethod: 'РАД',
      connectionType: 'С17',
      materialGroup: 'M01',
      d1: 57,
      d2: 108,
      t1: 14,
      t2: 16,
      stamp1K: 'E0SM',
    } as WeldInput

    expect(() =>
      validateServerWeldRecords({
        records: [record],
        previousRows: new Map(),
        context: customContext,
      }),
    ).not.toThrow()
  })

  it('validates only Tmin for equal angular diameters on the server', () => {
    const welderStamp = {
      id: 1,
      naksStamp: 'E0SM',
      welderName: 'Морозов Яков',
      internalStamp: '',
      weldType: 'РАД',
      materialGroups: 'M01',
      diameterFrom: '',
      diameterTo: '',
      thicknessFrom: '',
      thicknessTo: '',
      validFrom: '',
      validTo: '',
      naksPermits: [{
        id: 'naks-angular-equal-diameter',
        weldType: 'РАД',
        materialGroups: 'M01',
        diameterFrom: '20',
        diameterTo: '30',
        thicknessFrom: '2',
        thicknessTo: '4',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        note: '',
      }],
      dlsPermits: [],
      archived: false,
      archivedAt: '',
    }
    const customContext: ServerWeldValidationContext = {
      ...context,
      dataListSettings: {
        ...DEFAULT_DATA_LIST_SETTINGS,
        connectionTypes: ['У17'],
        materialGroups: ['M01'],
        weldingTypes: ['РАД'],
      },
      welderStamps: [welderStamp],
    }
    const record = {
      joint: 'S2',
      weldDate: '2026-07-15',
      weldingMethod: 'РАД',
      connectionType: 'У17',
      materialGroup: 'M01',
      d1: 25,
      d2: 25,
      t1: 3,
      t2: 30,
      stamp1K: 'E0SM',
    } as WeldInput

    expect(() =>
      validateServerWeldRecords({
        records: [record],
        previousRows: new Map(),
        context: customContext,
      }),
    ).not.toThrow()

    const incompatibleContext = {
      ...customContext,
      welderStamps: [{
        ...welderStamp,
        naksPermits: welderStamp.naksPermits.map((permit) => ({
          ...permit,
          thicknessFrom: '20',
          thicknessTo: '40',
        })),
      }],
    }

    expect(() =>
      validateServerWeldRecords({
        records: [record],
        previousRows: new Map(),
        context: incompatibleContext,
      }),
    ).toThrow('ЗВ-08')
  })

  it('blocks a result-only change that introduces a forbidden small-diameter repair', () => {
    const previous = {
      id: 17,
      joint: 'S17',
      d1: 55,
      d2: 57,
      hasVik: 'да',
      vikResult: 'годен',
      hasRk: 'да',
      rkResult: 'годен',
    } as WeldJoint
    const record = {
      ...previous,
      rkResult: 'ремонт',
    } as unknown as WeldInput

    expect(() =>
      validateServerWeldRecords({
        records: [record],
        previousRows: new Map([[previous.id, previous]]),
        context,
      }),
    ).toThrow('ЗВ-20')
  })

  it('blocks an unrelated edit when an old repair is forbidden by diameter', () => {
    const previous = {
      id: 18,
      joint: 'S18',
      d1: 55,
      d2: 57,
      hasRk: 'да',
      rkResult: 'ремонт',
      responsible: '',
    } as WeldJoint
    const record = {
      ...previous,
      responsible: 'Иванов',
    } as unknown as WeldInput

    expect(() =>
      validateServerWeldRecords({
        records: [record],
        previousRows: new Map([[previous.id, previous]]),
        context,
      }),
    ).toThrow('ЗВ-20')
  })
})
