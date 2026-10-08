import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WelderStampCheckParameters } from './welder-stamp-check-parameters'
import { WelderStampCheckVisual } from './welder-stamp-check-visual'
import { DEFAULT_STAMP_CHECK_EXAMPLE } from '@/lib/welder-stamp-check-explanation'

afterEach(cleanup)

describe('coloured qualification examples', () => {
  it('labels the meaning without relying on colour or implying a pass/fail verdict', () => {
    render(<WelderStampCheckParameters />)
    const legend = screen.getByLabelText('Цветовые обозначения примеров')
    expect(legend).toHaveTextContent('А · сварщик А')
    expect(legend).toHaveTextContent('Б · сварщик Б')
    expect(legend).toHaveTextContent('А + Б · у каждого отдельно')
    expect(legend).toHaveTextContent('Не проверяется')
    expect(legend).toHaveTextContent('а не «годен / не годен»')
    expect(legend).toHaveTextContent('не общий допуск команды')
  })

  it('colours the right fields for all twelve examples and never splits dimensions between welders', () => {
    render(<WelderStampCheckParameters />)
    const rows = screen.getByRole('table').querySelectorAll('[data-stamp-check-scenario]')
    // Expectations from the agreed rules, including the temporarily retained homogeneous U rule.
    const participating = [
      ['d1', 'd2', 't1', 't2'], ['d1', 'd2', 't1', 't2'], ['d1', 'd2', 't1', 't2'], ['d1', 'd2', 't1', 't2'],
      ['d1', 't1'], ['d2', 't2'], ['d1', 'd2', 't2'], ['d1', 't1'],
      ['d1', 't1', 'd2', 't2'], ['d1', 't1', 'd2', 't2'], ['d1', 't1', 'd2', 't2'], ['d1', 't1', 'd2', 't2'],
    ]
    expect(rows).toHaveLength(12)
    rows.forEach((row, index) => {
      const visual = row.querySelector('[data-stamp-check-visual]')!
      const fields = [...visual.querySelectorAll<HTMLElement>('[data-check-fields]')]
      const used = fields.filter(node => node.dataset.checkOwner !== 'unused')
      expect(used.flatMap(node => node.dataset.checkFields!.split(' ')).sort()).toEqual([...participating[index]].sort())
      expect(fields.flatMap(node => node.dataset.checkFields!.split(' ')).sort()).toEqual(['d1', 'd2', 't1', 't2'])
      expect(used.every(node => node.dataset.checkOwner === (index % 2 === 0 ? 'a' : 'both'))).toBe(true)
      expect(visual.querySelector('[data-check-owner="b"]') !== null).toBe(index % 2 === 1)
      expect(within(visual as HTMLElement).queryAllByText('ИЛИ')).toHaveLength(index < 4 ? 2 : 0)
      const alternatives = visual.querySelectorAll('[data-check-alternatives]')
      expect(alternatives).toHaveLength(index < 4 ? 2 : 0)
      for (const alternative of alternatives) {
        expect(alternative.textContent).toMatch(/^\(/)
        expect(alternative.textContent).toMatch(/\)$/)
      }
      if (index >= 8) expect(visual).toHaveTextContent('И другая группа:')
    })
  })

  it.each([
    ['6', '3', ['t1']], ['3', '6', ['t2']], ['3', '3', []],
  ])('only greys an unused thickness for equal-diameter homogeneous U (%s/%s)', (t1, t2, unused) => {
    const { container } = render(<WelderStampCheckVisual example={{ ...DEFAULT_STAMP_CHECK_EXAMPLE, connectionType: 'У19', t1, t2 }} />)
    expect([...container.querySelectorAll<HTMLElement>('[data-check-fields][data-check-owner="unused"]')].map(node => node.dataset.checkFields)).toEqual(unused)
    expect(container.querySelector('[data-check-fields="d1 d2"]')).toHaveAttribute('data-check-owner', 'a')
  })

  it('does not render a misleading picture for incomplete parameters', () => {
    const { container } = render(<WelderStampCheckVisual example={{ ...DEFAULT_STAMP_CHECK_EXAMPLE, d1: '' }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
