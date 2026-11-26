import type { PostProcessPopupParams } from 'ag-grid-community'
import { afterEach, expect, it } from 'vitest'
import { positionGridPopup } from './grid-popup-position'

afterEach(() => document.body.replaceChildren())

it('preserves outside focus on open and confines resize focus to the popup being dragged', () => {
  const outside = document.createElement('input')
  const popup = document.createElement('div')
  popup.innerHTML = '<input type="text"><input type="checkbox"><div class="ag-resizer"><span></span></div>'
  const other = popup.cloneNode(true) as HTMLElement
  document.body.append(outside, popup, other)
  outside.focus()
  for (const ePopup of [popup, other]) positionGridPopup({ ePopup } as PostProcessPopupParams)
  expect(document.activeElement).toBe(outside)

  const drag = () => popup.querySelector('span')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  expect(drag()).toBe(false)
  expect(document.activeElement).toBe(popup.firstElementChild)
  const checkbox = popup.querySelector<HTMLInputElement>('input[type="checkbox"]')!
  checkbox.focus()
  drag()
  expect(document.activeElement).toBe(checkbox)

  popup.querySelector('input[type="text"]')!.remove()
  outside.focus()
  drag()
  expect(document.activeElement).toBe(popup)
  expect(popup.tabIndex).toBe(-1)
})
