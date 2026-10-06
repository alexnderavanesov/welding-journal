import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ProgramResultSummary } from './line-program-result-summary'
import { buildProgramHistory } from './line-program-joint-details'
import type { WeldRow } from '@/lib/dispatcher-types'

afterEach(cleanup)
it('omits PSTO and TVMT only from the assignment summary and leaves all NK stages unscrolled', () => {
  const row: WeldRow = {
    id: 1, joint: 'F1', hasVik: 'да', vikResult: 'годен', hasRk: 'да', rkResult: 'годен',
    pstoRequired: 'да', pstoResult: 'проведено', pstoRequest: 'ПСТО-ЗАЯВКА', heatTreatmentDiagram: 'ПСТО-1',
    tvmtResult: 'годен', tvmtConclusion: 'ТВМТ-1',
    preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ВИК', result: 'годен' }],
    duplicateControls: [
      { id: 2, weldJointId: 1, method: 'РК', result: 'годен', conclusion: 'ДУБЛЬ-1', conclusionDate: '2026-09-01', controlDate: '2026-09-01' },
    ],
    layeredControlAssigned: true,
  }
  const before = structuredClone(row)
  render(<ProgramResultSummary row={row} />)
  const summary = screen.getByLabelText('Результат F1')
  expect(summary).not.toHaveTextContent(/ПСТО|ТВМТ/)
  for (const label of ['НК до ТО', 'Основной этап', 'Дубли контроля', 'Послойный: ожидает заключений']) {
    expect(screen.getByText(label)).toBeVisible()
  }
  expect(summary).not.toHaveClass('max-h-24', 'overflow-y-auto')
  const thermal = buildProgramHistory(row).sections.find(section => section.title === 'ПСТО и ТВМТ')
  expect(thermal?.controls.map(control => [control.method, control.result, control.conclusion])).toEqual([
    ['ПСТО', 'проведено', 'ПСТО-1'], ['ТВМТ', 'годен', 'ТВМТ-1'],
  ])
  expect(buildProgramHistory(row).sections.find(section => section.title === 'Дубли контроля')?.controls.map(control => control.method)).toEqual(['РК'])
  expect(row).toStrictEqual(before)
})
it('shows the NK empty state when only PSTO and TVMT have results', () => {
  render(<ProgramResultSummary row={{ id: 1, joint: 'F1', pstoResult: 'проведено', tvmtResult: 'годен' }} />)
  expect(screen.getByLabelText('Результат F1')).toHaveTextContent(/^Нет результатов НК$/)
})
const rejected: WeldRow = { id: 1, joint: 'F1', hasVik: 'да', vikResult: 'годен', hasRk: 'да', rkResult: 'ремонт', rkConclusion: 'РК-1', hasUzk: 'да', uzkResult: 'ожидает заявку', hasPvk: 'да', pvkResult: 'ожидает заявку' }
it('shows no need instead of pending methods after rejection, retaining saved facts and assignments', () => {
  const before = structuredClone(rejected)
  render(<ProgramResultSummary row={rejected} />)
  expect(screen.getByText('УЗК: нет потребности')).toBeVisible()
  expect(screen.getByText('ПВК: нет потребности')).toBeVisible()
  expect(screen.getByText('ВИК: годен')).toBeVisible()
  expect(screen.getByText('РК: ремонт')).toBeVisible()
  expect(buildProgramHistory(rejected).sections.find(s => s.title === 'Основной этап')?.controls.find(c => c.method === 'УЗК')?.result).toBe('нет потребности')
  expect(rejected).toStrictEqual(before)
})
it('does not hide completed, rejected or cancelled methods or their documents', () => {
  render(<ProgramResultSummary row={{ ...rejected, uzkResult: 'годен', uzkConclusion: 'УЗК-1', hasPvk: 'отменен' }} />)
  expect(screen.getByText('УЗК: годен')).toHaveAttribute('title', expect.stringContaining('УЗК-1'))
  expect(screen.getByText('ПВК: отменен')).toBeVisible()
  expect(screen.getByText('РК: ремонт')).toBeVisible()
})
it.each([true, false])('only active pre-heat rejection changes pending primary methods (enabled=%s)', enabled => {
  const row: WeldRow = { ...rejected, rkResult: 'ожидает НК', rkConclusion: null, pstoRequired: 'да', preHeatTreatmentLnkEnabled: enabled, preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'РК', result: 'вырез' }, { id: 2, weldJointId: 1, method: 'ПВК', result: 'ожидает НК', requestName: 'ПВК до ТО' }] }
  render(<ProgramResultSummary row={row} />)
  expect(screen.getByText(`УЗК: ${enabled ? 'нет потребности' : 'ожидает заявку'}`)).toBeVisible()
  expect(screen.getByText('РК: вырез')).toBeVisible()
  expect(buildProgramHistory(row).sections[0].controls[1].result).toBe(enabled ? 'нет потребности' : 'ожидает НК')
})
it('does not inherit rejection from another joint', () => {
  render(<><ProgramResultSummary row={rejected} /><ProgramResultSummary row={{ ...rejected, id: 2, joint: 'F2', rkResult: 'годен' }} /></>)
  expect(screen.getByLabelText('Результат F2')).toHaveTextContent('УЗК: ожидает заявку')
})
it('keeps rejected duplicate evidence and completed primary facts while stopping pending methods', () => {
  const row: WeldRow = { ...rejected, rkResult: 'годен', duplicateControls: [{ id: 1, weldJointId: 1, method: 'РК', result: 'вырез', conclusion: 'ДУБЛЬ-1', conclusionDate: '2026-09-01', controlDate: '2026-09-01' }] }
  render(<ProgramResultSummary row={row} />)
  expect(screen.getByText('РК: годен')).toBeVisible()
  expect(screen.getByText('РК: вырез')).toHaveAttribute('title', expect.stringContaining('ДУБЛЬ-1'))
  expect(screen.getByText('УЗК: нет потребности')).toBeVisible()
})
