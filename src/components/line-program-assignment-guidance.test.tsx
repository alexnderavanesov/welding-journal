import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProgramAssignmentGuidance } from './line-program-assignment-guidance'
import { calculateLineProgram } from '@/lib/line-program-calculation'
import type { LineProgramRecord } from '@/lib/line-program'
import type { WeldRow } from '@/lib/dispatcher-types'

afterEach(cleanup)
const line: LineProgramRecord = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', category: 'II', groupName: 'A', weldControlPercent: 100, pvkControlPercent: 20, configurationIssue: null, version: '1' }
const rows: WeldRow[] = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, joint: `F${i + 1}`, connectionType: 'С17', weldDate: '2026-09-01', stamp1K: i < 5 ? 'A' : 'B', hasRk: i < 2 ? 'да' : null, hasPvk: i === 0 ? 'да' : null }))

describe('saved assignment guidance', () => {
  it('reserves the collapsed additional-control hint before the first additional assignment', () => {
    const view = render(<ProgramAssignmentGuidance line={line} rows={rows} groups={calculateLineProgram(rows, 100, 20)} />)
    const slots = () => view.container.querySelectorAll('[data-program-additional-hint]')
    expect(slots()).toHaveLength(2)
    for (const slot of slots()) expect(slot).toHaveClass('min-h-[23px]')
    expect(screen.queryByText('Состав зачёта · с учётом «доп»')).not.toBeInTheDocument()
    const next = rows.map((row, index) => index === 2 ? { ...row, hasUzk: 'дополнительный' } : row)
    view.rerender(<ProgramAssignmentGuidance line={line} rows={next} groups={calculateLineProgram(next, 100, 20)} draft />)
    expect(slots()).toHaveLength(2)
    expect(screen.getByText('Состав зачёта · с учётом «доп»')).toBeVisible()
  })
  it('shows the arithmetic behind additional control displacing a normal yes', () => {
    const source = rows.slice(0, 4).map((row, i) => ({ ...row, hasRk: i < 2 ? 'да' : i === 2 ? 'дополнительный' : null }))
    render(<ProgramAssignmentGuidance line={{ ...line, weldControlPercent: 50 }} rows={source} groups={calculateLineProgram(source, 50, 20)} />)
    const common = screen.getByTestId('assignment-guidance-common')
    expect(common).toHaveTextContent('Назначено: 3К назначению: 0')
    expect(common).toHaveTextContent('Назначено стыков: 3 = только «да» 2 + только «доп» 1 + совместно 0')
    expect(common).toHaveTextContent('Зачёт по нормам клейм: 3 = только «да» 2 + только «доп» 1 + совместно 0')
    expect(common).toHaveTextContent('Текущая норма: 2 · Обычных «да» сверх нормы: 1')
  })
  it('separates unique mixed joints from quota places across their own stamps', () => {
    const source = [{ ...rows[0], stamp1Z: 'B', hasRk: 'да', hasUzk: 'дополнительный' }]
    render(<ProgramAssignmentGuidance line={{ ...line, weldControlPercent: 30 }} rows={source} groups={calculateLineProgram(source, 30, 20)} />)
    const common = screen.getByTestId('assignment-guidance-common')
    expect(common).toHaveTextContent('Назначено: 1К назначению: 0')
    expect(common).toHaveTextContent('Назначено стыков: 1 = только «да» 0 + только «доп» 0 + совместно 1')
    expect(common).toHaveTextContent('Зачёт по нормам клейм: 2 = только «да» 0 + только «доп» 0 + совместно 2')
    expect(common).toHaveTextContent('Текущая норма: 2 · Обычных «да» сверх нормы: 0')
    expect(common).toHaveTextContent('Один стык может закрывать место в норме каждого своего клейма.')
  })
  it('shows pre-weld plans but no percentage quota for the unstamped group', () => {
    const source = [{ id: 20, connectionType: 'У17', hasPvk: 'да', layeredControlAssigned: true }]
    render(<ProgramAssignmentGuidance line={{ ...line, weldControlPercent: 30 }} rows={source} groups={calculateLineProgram(source, 30, 20)} unassigned draft />)
    expect(screen.getByTestId('assignment-guidance-common')).toHaveTextContent('без клейма:Назначено: 1К назначению: 0')
    expect(screen.getByTestId('assignment-guidance-pvk')).toHaveTextContent('без клейма:Назначено: 1К назначению: 0')
    expect(screen.getAllByText(/В процентную норму стык войдёт после сварки/)).toHaveLength(2)
  })
  it.each([undefined, 'B'])('keeps full-line common demand and stamp-based PVK for scope %s', stamp => {
    const fullRows = [...rows, { id: 11, joint: 'F11', connectionType: 'С17' }]
    render(<ProgramAssignmentGuidance line={line} stamp={stamp} groups={calculateLineProgram(fullRows, 100, 20)} />)
    expect(screen.getByTestId('assignment-guidance-common')).toHaveTextContent('РК - УЗК · вся линия:Назначено: 2К назначению: 9')
    expect(screen.getByTestId('assignment-guidance-pvk')).toHaveTextContent(stamp ? 'ПВК · клеймо B:Назначено: 0К назначению: 1' : 'ПВК · по клеймам:Назначено: 1К назначению: 1')
  })

  it('does not fill another stamp’s gap with an overassignment and narrows to the selected stamp', () => {
    const percentLine = { ...line, weldControlPercent: 20, pvkControlPercent: 20 }
    const groups = calculateLineProgram(rows, 20, 20)
    const view = render(<ProgramAssignmentGuidance line={percentLine} groups={groups} />)
    expect(screen.getByTestId('assignment-guidance-common')).toHaveTextContent('по клеймам:Назначено: 2К назначению: 1')
    view.rerender(<ProgramAssignmentGuidance line={percentLine} groups={groups} stamp="B" />)
    expect(screen.getByTestId('assignment-guidance-common')).toHaveTextContent('клеймо B:Назначено: 0К назначению: 1')
  })

  it('shows full-line PVK when its own percentage is 100', () => {
    render(<ProgramAssignmentGuidance line={{ ...line, pvkControlPercent: 100 }} groups={calculateLineProgram(rows, 100, 100)} />)
    expect(screen.getByTestId('assignment-guidance-pvk')).toHaveTextContent('вся линия:Назначено: 1К назначению: 9')
  })
  it('counts one physical assignment across multiple stamps without unreachable assignment debt', () => {
    const source = [{ ...rows[0], stamp1Z: 'B', connectionType: 'У19', layeredControlAssigned: true, hasRk: null, hasPvk: 'да' }, { ...rows[1], stamp1K: 'C', hasRk: null, vikResult: 'ремонт' }]
    render(<ProgramAssignmentGuidance line={{ ...line, weldControlPercent: 30 }} groups={calculateLineProgram(source, 30, 20)} draft />)
    expect(screen.getByTestId('assignment-guidance-common')).toHaveTextContent('Назначено: 1К назначению: 0')
    expect(screen.queryByText(/Не закрывается/)).not.toBeInTheDocument()
    expect(screen.getByText(/С учётом несохранённых изменений/)).toBeVisible()
  })
})
