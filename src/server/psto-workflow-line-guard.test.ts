import { describe, expect, it } from 'vitest'

import { getPstoWorkflowLineAssignmentError } from '@/server/psto-workflow-line-guard'

describe('PSTO workflow line guard', () => {
  it('allows a workflow only when every weld on the line has PSTO assigned', () => {
    const selected = [{
      id: 1,
      joint: 'F1',
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-1',
      pstoRequired: 'да',
    }]
    const lineRows = [
      selected[0],
      { ...selected[0], id: 2, joint: 'F2' },
    ]

    expect(getPstoWorkflowLineAssignmentError(selected, lineRows)).toBeNull()
  })

  it('blocks legacy partial line assignment before starting a profile workflow', () => {
    const selected = [{
      id: 1,
      joint: 'F1',
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-1',
      pstoRequired: 'да',
    }]
    const lineRows = [
      selected[0],
      { ...selected[0], id: 2, joint: 'F2', pstoRequired: null },
    ]

    expect(getPstoWorkflowLineAssignmentError(selected, lineRows)).toContain(
      'Сначала выровняйте ее в «Программе ПСТО»',
    )
  })

  it('does not include duplicate-control records in line completeness', () => {
    const selected = [{
      id: 1,
      joint: 'F1',
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-1',
      pstoRequired: 'да',
      duplicateControls: [{ id: 10, method: 'РК' }],
    }]

    expect(getPstoWorkflowLineAssignmentError(selected, selected)).toBeNull()
  })

  it('blocks a weld without a line', () => {
    expect(getPstoWorkflowLineAssignmentError([
      { id: 1, joint: 'F1', pstoRequired: 'да' },
    ], [])).toContain('не привязан к линии')
  })

  it('allows only a performed weld to finish its retained history outside an active PSTO line', () => {
    const performed = {
      id: 1,
      joint: 'F1',
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-2',
      pstoRequired: null,
      pstoResult: 'проведено',
    }
    const unassignedLine = [
      performed,
      { ...performed, id: 2, joint: 'F2', pstoResult: null },
    ]

    expect(getPstoWorkflowLineAssignmentError([performed], unassignedLine)).toContain(
      'Сначала выровняйте ее в «Программе ПСТО»',
    )
    expect(getPstoWorkflowLineAssignmentError(
      [performed],
      unassignedLine,
      { allowPerformedHistoryRows: true },
    )).toBeNull()
    expect(getPstoWorkflowLineAssignmentError(
      [unassignedLine[1]],
      unassignedLine,
      { allowPerformedHistoryRows: true },
    )).toContain('Сначала выровняйте ее в «Программе ПСТО»')
  })

  it('allows a cancelled weld with physical execution history to finish but does not start an untreated one', () => {
    const cancelledPerformed = {
      id: 3,
      joint: 'F3',
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'L-3',
      pstoRequired: 'отменен',
      pstoDate: '2026-08-20',
      pstoResult: null,
    }
    const cancelledUntreated = {
      ...cancelledPerformed,
      id: 4,
      joint: 'F4',
      pstoDate: null,
    }
    const lineRows = [cancelledPerformed, cancelledUntreated]

    expect(getPstoWorkflowLineAssignmentError(
      [cancelledPerformed],
      lineRows,
      { allowPerformedHistoryRows: true },
    )).toBeNull()
    expect(getPstoWorkflowLineAssignmentError(
      [cancelledUntreated],
      lineRows,
      { allowPerformedHistoryRows: true },
    )).toContain('Сначала выровняйте ее в «Программе ПСТО»')
  })
})
