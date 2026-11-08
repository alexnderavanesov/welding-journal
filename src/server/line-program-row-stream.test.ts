import { expect, it } from 'vitest'
import type { AccessIdentity, Permission } from '@/lib/access-permissions'
import { createProgramRowsStream, readProgramRowsStream } from '@/lib/line-program-row-stream'
import { packProgramRows, unpackProgramRows } from '@/lib/line-program-row-payload'
import { redactOperationResult } from './access-response'

it.each([
  { label: 'line-only reader', permissions: ['lines.view'] as Permission[] },
  { label: 'LNK reader', permissions: ['lines.view', 'lnk.view'] as Permission[] },
  { label: 'all work areas', permissions: ['lines.view', 'welding.view', 'lnk.view', 'psto.view'] as Permission[] },
])(
  'streams only the complete packed snapshot allowed for $label', async ({ permissions }) => {
    const identity: AccessIdentity = { id: 'reader', name: 'Reader', email: '', title: '', role: 'user', revision: 1, permissions }
    const rows = [{ id: 1, joint: 'F1', rowVersion: '123', weldingJournalNote: 'PRIVATE-WELD', lnkNote: 'PRIVATE-LNK', pstoResult: 'PRIVATE-PSTO',
      pvkControlPercent: null, programRepairRequirements: [],
      programChainState: { weldJointId: 1, kind: 'primary' as const, physicalRootId: 1, sourceRowId: null, coilParentId: null, coilSide: null, replacedByCoil: false },
      preHeatTreatmentControls: [{ id: 10, weldJointId: 1, method: 'РК' as const, createdAt: new Date('2026-11-07T01:02:03.004Z') }],
      pstoRepeatCycles: [{ id: 20, weldJointId: 1, sequence: 2, updatedAt: new Date('2026-11-07T02:03:04.005Z') }],
    }]
    const original = { total: 1, ...packProgramRows(rows), approvals: [], approvedKeys: [] }
    const authorized = redactOperationResult(identity, 'line-program.ts', 'getLineProgramJointPage', original)
    const received = await readProgramRowsStream(createProgramRowsStream(authorized))
    expect(received).toStrictEqual(authorized)
    expect(unpackProgramRows(received)).toStrictEqual(unpackProgramRows(authorized))
    if (!permissions.includes('welding.view')) expect(JSON.stringify(received)).not.toContain('PRIVATE-WELD')
    if (!permissions.includes('lnk.view')) {
      expect(JSON.stringify(received)).not.toContain('PRIVATE-LNK')
      expect(received).not.toHaveProperty('emptyRepairRequirementIds')
      expect(received.nullFields).not.toContain('pvkControlPercent')
    }
    if (!permissions.includes('psto.view')) expect(JSON.stringify(received)).not.toContain('PRIVATE-PSTO')
    if (!permissions.includes('welding.view') || !permissions.includes('lnk.view') || !permissions.includes('psto.view')) expect(received).not.toHaveProperty('chainStates')
  },
)
