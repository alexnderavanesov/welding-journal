import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildRepeatedJointTasks } from '@/lib/repeated-joint-tasks'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import type { WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

describe('buildRepeatedJointTasks', () => {
  it('creates one official same-name target task for multiple unofficial rejected source rows', () => {
    const rows = [
      row({ id: 1, joint: 'S2', officiality: 'неофициальный', rkResult: 'вырез' }),
      row({ id: 2, joint: 'S2', officiality: 'неофициальный', pvkResult: 'вырез' }),
      row({ id: 3, joint: 'S2', officiality: 'неофициальный', rkResult: 'вырез' }),
    ]

    const createTasks = buildRepeatedJointTasks(rows).filter((task) => task.kind === 'create')

    expect(createTasks).toHaveLength(1)
    expect(createTasks[0]).toEqual(expect.objectContaining({ sourceJoint: 'S2', targetJoint: 'S2' }))
  })

  it('keeps the next repeated joint create task when a premature coil needs integrity check', () => {
    const rows = [
      row({ id: 1, joint: 'S2', pvkResult: 'вырез' }),
      row({ id: 2, joint: 'S2W1', pvkResult: 'вырез' }),
      row({ id: 3, joint: 'S2W2', pvkResult: 'вырез' }),
      row({ id: 4, joint: 'S2Y1', pvkResult: '' }),
    ]

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'check', reason: 'проверить целостность катушки' }),
        expect.objectContaining({ kind: 'create', sourceJoint: 'S2W2', targetJoint: 'S2W3' }),
      ]),
    )
  })

  it('replaces the normal R/W task with a coil task after an accepted early decision', () => {
    const rows = [row({ id: 1, joint: 'F51', rkResult: 'ремонт' })]

    const tasks = buildRepeatedJointTasks(rows, [], [], {
      earlyCoilDecisionSourceRowIds: new Set([1]),
    })

    expect(tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'coil',
        sourceJoint: 'F51',
        targetJoints: ['F51Y1', 'F51Y2'],
        transitionMode: 'early-decision',
      }),
    ]))
    expect(tasks).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create', sourceJoint: 'F51', targetJoint: 'F51R1' }),
    ]))
  })

  it('accepts a complete early coil without producing a chain warning or another R/W task', () => {
    const rows = [
      row({ id: 1, joint: 'F51', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'F51Y1', weldDate: null }),
      row({ id: 3, joint: 'F51Y2', weldDate: null }),
    ]

    const tasks = buildRepeatedJointTasks(rows, [], [], {
      earlyCoilDecisionSourceRowIds: new Set([1]),
    })

    expect(tasks.some((task) => task.kind === 'create' || task.kind === 'coil')).toBe(false)
    expect(tasks.some((task) => task.kind === 'check' && task.reason === 'проверить целостность катушки')).toBe(false)
  })

  it('restores only the missing target when an accepted early coil pair was damaged', () => {
    const rows = [
      row({ id: 1, joint: 'F51', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'F51Y1', weldDate: null }),
    ]

    const tasks = buildRepeatedJointTasks(rows, [], [], {
      earlyCoilDecisionSourceRowIds: new Set([1]),
    })

    expect(tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'coil',
        sourceJoint: 'F51',
        targetJoints: ['F51Y2'],
        transitionMode: 'early-decision',
      }),
      expect.objectContaining({
        kind: 'check',
        reason: 'проверить целостность катушки',
      }),
    ]))
    expect(tasks).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create', targetJoint: 'F51R1' }),
    ]))
  })

  it.each([
    ['пустого', null],
    ['заполненного', '2026-07-03'],
  ])('keeps the chain warning and next R task after the base of a %s orphan was deleted', (_label, weldDate) => {
    const tasks = buildRepeatedJointTasks([
      row({ id: 2, joint: 'F44R1', weldDate, rkResult: 'ремонт' }),
    ])

    expect(tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'check',
        sourceJoint: 'F44R1',
        reason: 'проверить целостность цепочки',
      }),
      expect.objectContaining({
        kind: 'create',
        sourceJoint: 'F44R1',
        targetJoint: 'F44R2',
      }),
    ]))
  })

  it('offers both gap restoration and continuation from the last rejected surviving row', () => {
    const tasks = buildRepeatedJointTasks([
      row({ id: 1, joint: 'F44', rkResult: 'ремонт' }),
      row({ id: 3, joint: 'F44R2', rkResult: 'вырез' }),
    ])

    expect(tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'check', reason: 'проверить целостность цепочки' }),
      expect.objectContaining({ kind: 'create', sourceJoint: 'F44', targetJoint: 'F44R1' }),
      expect.objectContaining({ kind: 'create', sourceJoint: 'F44R2', targetJoint: 'F44R2W1' }),
    ]))
  })

  it.each([
    [
      'первого ремонта',
      [row({ id: 1, joint: 'F45', rkResult: 'ремонт' })],
      'F45R1',
    ],
    [
      'последующего ремонта',
      [
        row({ id: 1, joint: 'F46', rkResult: 'ремонт' }),
        row({ id: 2, joint: 'F46R1', rkResult: 'ремонт' }),
      ],
      'F46R2',
    ],
    [
      'третьего выреза перед лимитом катушки',
      [
        row({ id: 1, joint: 'S47', rkResult: 'вырез' }),
        row({ id: 2, joint: 'S47W1', rkResult: 'вырез' }),
        row({ id: 3, joint: 'S47W2', rkResult: 'вырез' }),
      ],
      'S47W3',
    ],
  ])('reoffers a deleted terminal row for %s', (_label, rows, targetJoint) => {
    expect(buildRepeatedJointTasks(rows)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create', targetJoint }),
    ]))
  })

  it('restores a deleted coil root and still continues its rejected surviving branch', () => {
    const tasks = buildRepeatedJointTasks([
      row({ id: 1, joint: 'S30', rkResult: 'вырез' }),
      row({ id: 2, joint: 'S30W1', rkResult: 'вырез' }),
      row({ id: 3, joint: 'S30W2', rkResult: 'вырез' }),
      row({ id: 4, joint: 'S30W3', rkResult: 'вырез' }),
      row({ id: 6, joint: 'S30Y1R1', rkResult: 'ремонт' }),
      row({ id: 7, joint: 'S30Y2' }),
    ])

    expect(tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'check', reason: 'проверить целостность цепочки', sourceJoint: 'S30Y1R1' }),
      expect.objectContaining({ kind: 'check', reason: 'проверить целостность катушки' }),
      expect.objectContaining({ kind: 'coil', sourceJoint: 'S30W3', targetJoints: ['S30Y1'] }),
      expect.objectContaining({ kind: 'create', sourceJoint: 'S30Y1R1', targetJoint: 'S30Y1R2' }),
    ]))
  })

  it('creates a nested early coil from the current Y branch base', () => {
    const rows = [
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1Y1', rkResult: 'ремонт' }),
      row({ id: 3, joint: 'S1Y2', rkResult: '' }),
    ]

    const tasks = buildRepeatedJointTasks(rows, [], [], {
      earlyCoilDecisionSourceRowIds: new Set([1, 2]),
    })

    expect(tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'coil',
        sourceJoint: 'S1Y1',
        targetJoints: ['S1Y1Y1', 'S1Y1Y2'],
        transitionMode: 'early-decision',
      }),
    ]))
  })

  it('uses rejected pre-TO and duplicate results as early-coil reasons', () => {
    const preHeatRows = [row({
      id: 1,
      joint: 'S20',
      hasVik: 'да',
      pstoRequired: 'да',
      preHeatTreatmentControls: [{
        id: 20,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        requestDate: '2026-07-01',
        result: 'вырез',
        conclusionDate: '2026-07-01',
        conclusionName: 'Заключение ВИК до ТО',
      }],
    })]
    const duplicateRows = [row({
      id: 2,
      joint: 'S21',
      duplicateControls: [{
        id: 21,
        weldJointId: 2,
        method: 'ВИК',
        result: 'ремонт',
        controlDate: '',
        conclusion: '',
        conclusionDate: '',
      }],
    })]

    expect(buildRepeatedJointTasks(preHeatRows, [], [], {
      earlyCoilDecisionSourceRowIds: new Set([1]),
      includeIncompleteStampChecks: false,
      includeJointCoreDataChecks: false,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'coil', methodCode: 'ВИК до ТО', targetJoints: ['S20Y1', 'S20Y2'] }),
    ]))
    expect(buildRepeatedJointTasks(duplicateRows, [], [], {
      earlyCoilDecisionSourceRowIds: new Set([2]),
      includeIncompleteStampChecks: false,
      includeJointCoreDataChecks: false,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'coil', methodCode: 'ВИК (дубль)', targetJoints: ['S21Y1', 'S21Y2'] }),
    ]))
  })

  it('keeps the existing automatic coil threshold unchanged', () => {
    const rows = [
      row({ id: 1, joint: 'S30', hasVik: 'да', vikRequest: 'ЗВК-1', vikRequestDate: '2026-07-01', vikResult: 'вырез', vikConclusionDate: '2026-07-01', vikConclusion: 'ВИК-1' }),
      row({ id: 2, joint: 'S30W1', hasVik: 'да', vikRequest: 'ЗВК-2', vikRequestDate: '2026-07-01', vikResult: 'вырез', vikConclusionDate: '2026-07-01', vikConclusion: 'ВИК-2' }),
      row({ id: 3, joint: 'S30W2', hasVik: 'да', vikRequest: 'ЗВК-3', vikRequestDate: '2026-07-01', vikResult: 'вырез', vikConclusionDate: '2026-07-01', vikConclusion: 'ВИК-3' }),
      row({ id: 4, joint: 'S30W3', hasVik: 'да', vikRequest: 'ЗВК-4', vikRequestDate: '2026-07-01', vikResult: 'вырез', vikConclusionDate: '2026-07-01', vikConclusion: 'ВИК-4' }),
    ]

    expect(buildRepeatedJointTasks(rows)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'check',
        reason: 'проверить целостность катушки',
      }),
      expect.objectContaining({
        kind: 'coil',
        sourceJoint: 'S30W3',
        targetJoints: ['S30Y1', 'S30Y2'],
        transitionMode: 'limit',
      }),
    ]))
  })

  it('does not reset the automatic coil counter when intermediate rows were deleted', () => {
    const tasks = buildRepeatedJointTasks([
      row({ id: 1, joint: 'S31', rkResult: 'вырез' }),
      row({ id: 4, joint: 'S31W3', rkResult: 'вырез' }),
    ])

    expect(tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'check', reason: 'проверить целостность цепочки' }),
      expect.objectContaining({ kind: 'check', reason: 'проверить целостность катушки' }),
      expect.objectContaining({
        kind: 'coil',
        sourceJoint: 'S31W3',
        targetJoints: ['S31Y1', 'S31Y2'],
        transitionMode: 'limit',
      }),
    ]))
    expect(tasks).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create', sourceJoint: 'S31W3', targetJoint: 'S31W4' }),
    ]))
  })

  it('creates a W-index repeated joint after duplicate control cut result', () => {
    const rows = [
      row({
        id: 1,
        joint: 'S10',
        duplicateControls: [{ id: 1, weldJointId: 1, method: 'РК', result: 'вырез', controlDate: '', conclusion: '', conclusionDate: '' }],
      }),
    ]

    const createTasks = buildRepeatedJointTasks(rows).filter((task) => task.kind === 'create')

    expect(createTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceJoint: 'S10',
          targetJoint: 'S10W1',
          methodCode: 'РК (дубль)',
          result: 'вырез',
        }),
      ]),
    )
  })

  it('creates an R-index repeated joint after duplicate control repair result', () => {
    const rows = [
      row({
        id: 1,
        joint: 'S11',
        duplicateControls: [{ id: 1, weldJointId: 1, method: 'ВИК', result: 'ремонт', controlDate: '', conclusion: '', conclusionDate: '' }],
      }),
    ]

    const createTasks = buildRepeatedJointTasks(rows).filter((task) => task.kind === 'create')

    expect(createTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceJoint: 'S11',
          targetJoint: 'S11R1',
          methodCode: 'ВИК (дубль)',
          result: 'ремонт',
        }),
      ]),
    )
  })

  it('creates a repeated joint after a rejected pre-heat-treatment result', () => {
    const rows = [
      row({
        id: 1,
        joint: 'S12',
        pstoRequired: 'да',
        hasRk: 'да',
        preHeatTreatmentControls: [{
          id: 12,
          weldJointId: 1,
          method: 'РК',
          result: 'ремонт',
          conclusionDate: '2026-08-04',
          conclusionName: 'ЗНК-РК до ТО',
        }],
      }),
    ]

    expect(buildRepeatedJointTasks(rows)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'create',
        sourceJoint: 'S12',
        targetJoint: 'S12R1',
        methodCode: 'РК до ТО',
        result: 'ремонт',
      }),
    ]))
  })

  it('removes an unused repeated-joint draft after its pre-heat-treatment rejection is cleared', () => {
    const rows = [
      row({ id: 1, joint: 'S12' }),
      row({ id: 2, joint: 'S12R1', weldDate: null, finalStatus: 'ожидает ремонт' }),
    ]

    expect(buildRepeatedJointTasks(rows)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'delete',
        targetJoint: 'S12R1',
      }),
    ]))
  })

  it('still removes a generated repeated-joint draft with derived waiting statuses', () => {
    const rows = [
      row({ id: 1, joint: 'S12' }),
      row({
        id: 2,
        joint: 'S12W1',
        weldDate: null,
        pstoRequired: 'да',
        hasVik: 'да',
        hasRk: 'да',
        vikResult: 'ожидает заявку',
        rkResult: 'ожидает заявку',
        pstoResult: 'ожидает заявку',
        finalStatus: 'ожидает ремонт',
      }),
    ]

    expect(buildRepeatedJointTasks(rows)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'delete',
        targetJoint: 'S12W1',
      }),
    ]))
    expect(buildRepeatedJointTasks(rows)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'check',
        targetJoint: 'S12W1',
      }),
    ]))
  })

  it('creates the repair inside an indexed base chain', () => {
    const tasks = buildRepeatedJointTasks([
      row({ id: 1, joint: 'FB01', rkResult: 'ремонт' }),
    ])

    expect(tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'create',
        sourceJoint: 'FB01',
        targetJoint: 'FB01R1',
      }),
    ]))
  })

  it('uses configured chain suffixes in server-side dispatcher calculations', () => {
    const systemIndexSettings = {
      ...DEFAULT_SYSTEM_INDEX_SETTINGS,
      shopJoint: 'A',
      fieldJoint: 'B',
      repair: 'C',
      cutout: 'D',
      coil: 'E',
    }

    const tasks = buildRepeatedJointTasks(
      [row({ id: 1, joint: 'B7', rkResult: 'ремонт' })],
      [],
      [],
      { systemIndexSettings },
    )

    expect(tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'create',
        sourceJoint: 'B7',
        targetJoint: 'B7C1',
      }),
    ]))
  })

  it('uses the project control result before duplicate control when choosing R or W target', () => {
    const rows = [
      row({
        id: 1,
        joint: 'F4',
        rkResult: 'вырез',
        duplicateControls: [{ id: 1, weldJointId: 1, method: 'РК', result: 'ремонт', controlDate: '', conclusion: '', conclusionDate: '' }],
      }),
    ]

    const createTasks = buildRepeatedJointTasks(rows).filter((task) => task.kind === 'create')

    expect(createTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceJoint: 'F4',
          targetJoint: 'F4W1',
          methodCode: 'РК',
          result: 'вырез',
        }),
      ]),
    )
  })

  it('offers to rename an orphan good repeated joint back to its missing source joint', () => {
    const tasks = buildRepeatedJointTasks([row({ id: 1, joint: 'S2W1', finalStatus: 'годен' })])

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'rename',
          currentJoint: 'S2W1',
          targetJoint: 'S2',
        }),
      ]),
    )
    expect(tasks.some((task) => task.kind === 'check' && task.reason === 'проверить целостность цепочки')).toBe(false)
  })

  it('restarts R/W counters while rebuilding a chain after an earlier result changes', () => {
    const rows = [
      row({ id: 1, joint: 'S1', rkResult: 'вырез' }),
      row({ id: 2, joint: 'S1R1', rkResult: 'ремонт' }),
      row({ id: 3, joint: 'S1R2' }),
    ]

    const tasks = buildRepeatedJointTasks(rows)
    const renameTasks = tasks.filter((task) => task.kind === 'rename')

    expect(renameTasks).toHaveLength(1)
    expect(renameTasks[0]).toEqual(expect.objectContaining({
      currentJoint: 'S1R1',
      targetJoint: 'S1W1',
      changes: [
        { rowId: 2, currentJoint: 'S1R1', targetJoint: 'S1W1' },
        { rowId: 3, currentJoint: 'S1R2', targetJoint: 'S1W1R1' },
      ],
    }))
    expect(tasks).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create', targetJoint: 'S1W1' }),
    ]))
  })

  it('preserves the factual R/W order while restarting the changed suffix counter', () => {
    const renameTasks = buildRepeatedJointTasks([
      row({ id: 1, joint: 'F1', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'F1W1', rkResult: 'вырез' }),
      row({ id: 3, joint: 'F1W2' }),
    ]).filter((task) => task.kind === 'rename')

    expect(renameTasks).toHaveLength(1)
    expect(renameTasks[0]?.changes).toEqual([
      { rowId: 2, currentJoint: 'F1W1', targetJoint: 'F1R1' },
      { rowId: 3, currentJoint: 'F1W2', targetJoint: 'F1R1W1' },
    ])
  })

  it('rebuilds only the continuation after a result changes in the middle of a chain', () => {
    const renameTasks = buildRepeatedJointTasks([
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1R1', rkResult: 'вырез' }),
      row({ id: 3, joint: 'S1R2', rkResult: 'ремонт' }),
      row({ id: 4, joint: 'S1R3' }),
    ]).filter((task) => task.kind === 'rename')

    expect(renameTasks).toHaveLength(1)
    expect(renameTasks[0]?.changes).toEqual([
      { rowId: 3, currentJoint: 'S1R2', targetJoint: 'S1R1W1' },
      { rowId: 4, currentJoint: 'S1R3', targetJoint: 'S1R2W1' },
    ])
  })

  it('replays every later result when several earlier links changed', () => {
    const renameTasks = buildRepeatedJointTasks([
      row({ id: 1, joint: 'S1', rkResult: 'вырез' }),
      row({ id: 2, joint: 'S1R1', rkResult: 'вырез' }),
      row({ id: 3, joint: 'S1R2', rkResult: 'ремонт' }),
      row({ id: 4, joint: 'S1R3' }),
    ]).filter((task) => task.kind === 'rename')

    expect(renameTasks).toHaveLength(1)
    expect(renameTasks[0]?.changes).toEqual([
      { rowId: 2, currentJoint: 'S1R1', targetJoint: 'S1W1' },
      { rowId: 3, currentJoint: 'S1R2', targetJoint: 'S1W2' },
      { rowId: 4, currentJoint: 'S1R3', targetJoint: 'S1W2R1' },
    ])
  })

  it('rebuilds counters with configured system suffixes', () => {
    const systemIndexSettings = {
      ...DEFAULT_SYSTEM_INDEX_SETTINGS,
      shopJoint: 'A',
      fieldJoint: 'B',
      repair: 'C',
      cutout: 'D',
      coil: 'E',
    }
    const renameTasks = buildRepeatedJointTasks([
      row({ id: 1, joint: 'B7', rkResult: 'вырез' }),
      row({ id: 2, joint: 'B7C1', rkResult: 'ремонт' }),
      row({ id: 3, joint: 'B7C2' }),
    ], [], [], { systemIndexSettings }).filter((task) => task.kind === 'rename')

    expect(renameTasks[0]?.changes).toEqual([
      { rowId: 2, currentJoint: 'B7C1', targetJoint: 'B7D1' },
      { rowId: 3, currentJoint: 'B7C2', targetJoint: 'B7D1C1' },
    ])
  })

  it('does not offer an automatic rename when the rebuilt name is already occupied', () => {
    const tasks = buildRepeatedJointTasks([
      row({ id: 1, joint: 'S1', rkResult: 'вырез' }),
      row({ id: 2, joint: 'S1R1', rkResult: 'ремонт' }),
      row({ id: 3, joint: 'S1W1' }),
    ])

    expect(tasks.some((task) => task.kind === 'rename')).toBe(false)
  })

  it('does not offer a conflicting create when a downstream collision blocks the chain rename', () => {
    const tasks = buildRepeatedJointTasks([
      row({ id: 1, joint: 'S1', rkResult: 'вырез' }),
      row({ id: 2, joint: 'S1R1', rkResult: 'ремонт' }),
      row({ id: 3, joint: 'S1R2' }),
      row({ id: 4, joint: 'S1W1R1' }),
    ])

    expect(tasks.some((task) => task.kind === 'rename')).toBe(false)
    expect(tasks).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'create', targetJoint: 'S1W1' }),
    ]))
    expect(tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'check', reason: 'проверить целостность цепочки' }),
    ]))
  })

  it('keeps the forced cutout target valid after the official repair limit', () => {
    const tasks = buildRepeatedJointTasks([
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1R1', rkResult: 'ремонт' }),
      row({ id: 3, joint: 'S1R2', rkResult: 'ремонт' }),
      row({ id: 4, joint: 'S1R2W1' }),
    ])

    expect(tasks.filter((task) => (
      task.row.id === 4 && (
        task.kind === 'rename' ||
        task.kind === 'delete' ||
        (task.kind === 'check' && task.key.startsWith('check-obsolete'))
      )
    ))).toEqual([])
  })

  it('adds a dispatcher task when a percentage line stamp lacks RK/UZK coverage', () => {
    const rows = Array.from({ length: 10 }, (_, index) => row({ id: index + 1, joint: `S${index + 1}`, stamp1K: 'ABC1' }))

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'missing',
          line: '330-FG-05-001',
          stamp: 'ABC1',
          count: 1,
        }),
      ]),
    )
  })

  it('adds an excess-control task only for normal yes values on a percentage line', () => {
    const rows = [
      row({ id: 1, joint: 'S1', stamp1K: 'ABC1', hasRk: 'да' }),
      row({ id: 2, joint: 'S2', stamp1K: 'ABC1', hasRk: 'да' }),
      row({ id: 3, joint: 'S3', stamp1K: 'ABC1', hasRk: 'дополнительный' }),
      ...Array.from({ length: 7 }, (_, index) => row({ id: index + 4, joint: `S${index + 4}`, stamp1K: 'ABC1' })),
    ]

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'excess',
          stamp: 'ABC1',
          count: 1,
        }),
      ]),
    )
  })

  it('requires both RK and UZK to be cancelled for deliberate coverage on a percentage line', () => {
    const rows = [
      row({ id: 1, joint: 'S1', stamp1K: 'ABC1', hasRk: 'отменен' }),
      ...Array.from({ length: 9 }, (_, index) => row({ id: index + 2, joint: `S${index + 2}`, stamp1K: 'ABC1' })),
    ]

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'missing',
          stamp: 'ABC1',
        }),
      ]),
    )
  })

  it('treats RK and UZK cancelled together as deliberate coverage on a percentage line', () => {
    const rows = [
      row({ id: 1, joint: 'S1', stamp1K: 'ABC1', hasRk: 'отменен', hasUzk: 'отменен' }),
      ...Array.from({ length: 9 }, (_, index) => row({ id: index + 2, joint: `S${index + 2}`, stamp1K: 'ABC1' })),
    ]

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'missing',
          stamp: 'ABC1',
        }),
      ]),
    )
  })

  it('adds a new-welder task for additional official stamps on a percentage line', () => {
    const rows = [
      row({ id: 1, joint: 'S1', stamp1K: 'ABC1', weldDate: '2026-07-01' }),
      row({ id: 2, joint: 'S2', stamp1K: 'ABC1', weldDate: '2026-07-02' }),
      row({ id: 3, joint: 'S3', stamp1K: 'ZZ99', weldDate: '2026-07-03' }),
    ]

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'new-welder',
          title: 'Новый сварщик на процентной линии',
          stamp: 'ZZ99',
        }),
      ]),
    )
    expect(tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'new-welder',
          stamp: 'ABC1',
        }),
      ]),
    )
  })

  it('keeps accepted new-welder percentage-line tasks stable for the same stamp', () => {
    const baseRows = [
      row({ id: 1, joint: 'S1', stamp1K: 'ABC1', weldDate: '2026-07-01' }),
      row({ id: 2, joint: 'S2', stamp1K: 'ARCH', weldDate: '2026-07-02' }),
    ]
    const changedRows = [
      ...baseRows,
      row({ id: 3, joint: 'S3', stamp1K: 'ARCH', weldDate: '2026-07-03' }),
      row({ id: 4, joint: 'S4', stamp1K: 'ZZ99', weldDate: '2026-07-04' }),
    ]

    const baseNewWelderTasks = buildRepeatedJointTasks(baseRows).filter(
      (task) => task.kind === 'percentage-line-control' && task.issue === 'new-welder',
    )
    const changedNewWelderTasks = buildRepeatedJointTasks(changedRows).filter(
      (task) => task.kind === 'percentage-line-control' && task.issue === 'new-welder',
    )

    const acceptedStampTask = baseNewWelderTasks.find((task) => task.kind === 'percentage-line-control' && task.stamp === 'ARCH')
    const sameStampTask = changedNewWelderTasks.find((task) => task.kind === 'percentage-line-control' && task.stamp === 'ARCH')
    const thirdStampTask = changedNewWelderTasks.find((task) => task.kind === 'percentage-line-control' && task.stamp === 'ZZ99')

    expect(sameStampTask?.key).toBe(acceptedStampTask?.key)
    expect(thirdStampTask?.key).not.toBe(acceptedStampTask?.key)
  })

  it('adds a percentage-line task for rejected primary official controls', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      row({
        id: index + 1,
        joint: `S${index + 1}`,
        stamp1K: 'ABC1',
        rkResult: index === 0 ? 'вырез' : '',
      }),
    )

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'rejected-primary',
          stamp: 'ABC1',
          count: 1,
        }),
      ]),
    )
  })

  it('does not start percentage-line follow-up when a primary joint is rejected by VIK', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      row({
        id: index + 1,
        joint: `S${index + 1}`,
        stamp1K: 'ABC1',
        hasVik: index === 0 ? 'дополнительный' : '',
        vikResult: index === 0 ? 'вырез' : '',
      }),
    )

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'rejected-primary',
          stamp: 'ABC1',
        }),
      ]),
    )
    expect(tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'missing',
          stamp: 'ABC1',
          requiredControls: 3,
        }),
      ]),
    )
  })

  it('does not count PSTO as a rejected primary percentage-line control', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      row({
        id: index + 1,
        joint: `S${index + 1}`,
        stamp1K: 'ABC1',
        hasRk: index === 0 ? 'да' : '',
        rkResult: index === 0 ? 'годен' : '',
        pstoRequired: index === 1 ? 'да' : '',
        pstoResult: index === 1 ? 'вырез' : '',
      }),
    )

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'rejected-primary',
          stamp: 'ABC1',
        }),
      ]),
    )
    expect(tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'missing',
          stamp: 'ABC1',
        }),
      ]),
    )
  })

  it('does not count rejected repair joints toward the primary rejected percentage-line limit', () => {
    const rows = [
      row({ id: 1, joint: 'S1', stamp1K: 'ABC1', rkResult: 'вырез' }),
      row({ id: 2, joint: 'S2', stamp1K: 'ABC1', rkResult: 'вырез' }),
      row({ id: 3, joint: 'S3', stamp1K: 'ABC1', rkResult: 'вырез' }),
      row({ id: 4, joint: 'S1R1', stamp1K: 'ABC1', rkResult: 'вырез' }),
      row({ id: 5, joint: 'S4', stamp1K: 'ABC1' }),
    ]

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'suspend-welder',
          stamp: 'ABC1',
        }),
      ]),
    )
    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'rejected-primary',
          stamp: 'ABC1',
          count: 3,
        }),
      ]),
    )
  })

  it('adds only one extra RK/UZK requirement after a rejected primary joint on a 1 percent line', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      row({
        id: index + 1,
        joint: `S${index + 1}`,
        stamp1K: 'ABC1',
        weldControlPercent: '1',
        rkResult: index === 0 ? 'вырез' : '',
      }),
    )

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'missing',
          stamp: 'ABC1',
          requiredControls: 2,
          coveredControls: 1,
          count: 1,
        }),
      ]),
    )
  })

  it('adds a suspend-welder warning after the fourth rejected primary percentage-line joint', () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      row({
        id: index + 1,
        joint: `S${index + 1}`,
        stamp1K: 'ABC1',
        rkResult: index < 4 ? 'вырез' : '',
        rkConclusionDate: index < 4 ? `0${index + 1}.07.2026` : '',
      }),
    )

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'suspend-welder',
          title: 'Отстранить сварщика от работы',
          stamp: 'ABC1',
          count: 4,
          suspensionFrom: '04.07.2026',
        }),
      ]),
    )
  })

  it('does not add a suspend-welder warning when the stamp is already suspended on the fourth rejected date', () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      row({
        id: index + 1,
        joint: `S${index + 1}`,
        stamp1K: 'ABC1',
        rkResult: index < 4 ? 'вырез' : '',
        rkConclusionDate: index < 4 ? `0${index + 1}.07.2026` : '',
      }),
    )
    const suspensions: WelderStampSuspensionRecord[] = [
      { id: 1, naksStamp: 'ABC1', suspendedFrom: '04.07.2026', suspendedTo: '' },
    ]

    const tasks = buildRepeatedJointTasks(rows, [], suspensions)

    expect(tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'suspend-welder',
          stamp: 'ABC1',
        }),
      ]),
    )
    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'missing',
          stamp: 'ABC1',
          title: 'Назначить 100% контроль по клейму',
        }),
      ]),
    )
  })

  it('does not ask for missing full-control joints when the remaining RK and UZK are cancelled', () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, index) =>
        row({
          id: index + 1,
          joint: `S${index + 1}`,
          stamp1K: 'ABC1',
          rkResult: 'вырез',
        }),
      ),
      row({ id: 5, joint: 'S5', stamp1K: 'ABC1', hasRk: 'отменен', hasUzk: 'отменен' }),
    ]

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'suspend-welder',
          stamp: 'ABC1',
        }),
      ]),
    )
    expect(tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'missing',
          stamp: 'ABC1',
        }),
      ]),
    )
  })
})

function row(values: Partial<WeldRow>): WeldRow {
  return {
    id: values.id ?? 1,
    projectTitle: values.projectTitle ?? 'ТКМ5',
    subtitleCode: values.subtitleCode ?? '-',
    line: values.line ?? '330-FG-05-001',
    weldControlPercent: values.weldControlPercent ?? '10',
    joint: values.joint ?? 'S1',
    weldDate: values.weldDate ?? '2026-07-01',
    ...values,
  } as WeldRow
}
