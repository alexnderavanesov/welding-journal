import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DispatcherTaskDetails } from './dispatcher-task-ui'
import { buildPercentageLineControlTasks } from '@/lib/percentage-line-tasks'
import type { WeldRow } from '@/lib/dispatcher-types'

afterEach(cleanup)

// Independent plan case: ten physical joints, eight rejected by VIK, two
// available. Common quota round(10*.5)=5; PVK round(10*.3)=3. Both actionable
// requirements are two, regardless of the two different theoretical quotas.
const rows: WeldRow[] = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1, joint: `F${i + 1}`, projectTitle: 'P', subtitleCode: 'S', line: 'L',
  weldDate: '2026-09-01', connectionType: 'С17', stamp1K: 'A',
  weldControlPercent: 50, pvkControlPercent: 30,
  hasVik: 'да', vikResult: i < 8 ? 'ремонт' : 'годен',
}))

describe('dispatcher metrics use achievable debt and the matching control percent', () => {
  it.each(['common', 'pvk'] as const)('does not reintroduce impossible assignments in %s task metrics', kind => {
    const task = buildPercentageLineControlTasks(rows).find(task => task.issue === 'missing' && (task.demandKind ?? 'common') === kind)!
    expect(task).toMatchObject({ count: 2, requiredControls: 2 })
    render(<DispatcherTaskDetails task={task} />)
    expect(screen.getByText('Требуется').parentElement).toHaveTextContent('Требуется2')
    expect(screen.getByText('Осталось').parentElement).toHaveTextContent('Осталось2')
  })

  it('labels a PVK task with 30%, not the common 50%', () => {
    const task = buildPercentageLineControlTasks(rows).find(task => task.demandKind === 'pvk')!
    render(<DispatcherTaskDetails task={task} />)
    expect(screen.getByText('Контроль').parentElement).toHaveTextContent('Контроль30%')
  })

  it('leaves no missing task when the two available joints have been assigned', () => {
    const assigned = rows.map(row => row.id > 8 ? { ...row, hasRk: 'да', hasPvk: 'да' } : row)
    expect(buildPercentageLineControlTasks(assigned).filter(task => task.issue === 'missing')).toEqual([])
  })
})
