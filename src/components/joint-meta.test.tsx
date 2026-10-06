import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { JointFullMeta } from './joint-meta'
import { RequestRowJointHeading } from './request-row-joint-heading'
import { ResultRowJointHeading } from './result-row-joint-heading'
import { ManagerRowJointHeading } from './manager-row-joint-heading'
import type { WeldRow } from '@/lib/dispatcher-types'

const row = { id: 1, joint: 'F1', line: 'L1', projectTitle: 'Проект', subtitleCode: 'Шифр', connectionType: 'С17', spool: 'SPL-1' } as WeldRow

describe('shared metadata for LNK, PSTO and TVMT dialogs', () => {
  it.each([
    ['request', <RequestRowJointHeading row={row} />],
    ['stacked request / LNK result / TVMT', <RequestRowJointHeading row={row} stackMetadata />],
    ['PSTO result', <ResultRowJointHeading row={row} />],
    ['request editing', <ManagerRowJointHeading row={row} />],
    ['result editing', <JointFullMeta row={row} />],
  ])('shows the connection type once in %s', (_name, view) => {
    const { container } = render(view)
    expect(container).toHaveTextContent('Тип: С17')
    expect(screen.getAllByText('С17')).toHaveLength(1)
    expect(container).toHaveTextContent('SPL-1')
    expect(container).toHaveTextContent('Диаметр -')
    expect(container).toHaveTextContent('Дата сварки:')
  })

  it.each([undefined, null, '   '])('uses a dash for missing connection type %s', (connectionType) => {
    const { container } = render(<JointFullMeta row={{ ...row, connectionType }} />)
    expect(container).toHaveTextContent('Тип: —')
    expect(container).not.toHaveTextContent('undefined')
  })
})
