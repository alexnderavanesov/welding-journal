import { describe, expect, it, vi } from 'vitest'

import { buildWorkflowContextMenuItems } from '@/lib/workflow-context-menu-items'

describe('workflow context menu groups', () => {
  it('keeps workflow actions behind three stable top-level groups', () => {
    const openRequest = vi.fn()
    const openResult = vi.fn()
    const editResult = vi.fn()
    const items = buildWorkflowContextMenuItems({
      requests: [{ id: 'new-request', label: 'Новая заявка', onSelect: openRequest }],
      results: [{ id: 'new-result', label: 'Внести результат', onSelect: openResult }],
      editing: [{ id: 'edit-result', label: 'Редактировать результат', onSelect: editResult }],
    })

    expect(items.map((item) => isActionItem(item) ? item.label : '')).toEqual([
      'Заявки',
      'Результаты и заключения',
      'Редактирование',
    ])
    expect(items[0]).toMatchObject({ children: [{ id: 'new-request' }] })
    expect(items[1]).toMatchObject({ children: [{ id: 'new-result' }] })
    expect(items[2]).toMatchObject({ children: [{ id: 'edit-result' }] })

    const requestGroup = items[0]
    if (!isActionItem(requestGroup)) throw new Error('Expected action group')
    const requestAction = requestGroup.children?.[0]
    if (!requestAction || !isActionItem(requestAction)) throw new Error('Expected request action')
    requestAction.onSelect()
    expect(openRequest).toHaveBeenCalledTimes(1)
  })

  it('omits an empty optional group and trims redundant separators', () => {
    const items = buildWorkflowContextMenuItems({
      requests: [
        { type: 'separator', id: 'leading' },
        { id: 'new-request', label: 'Новая заявка', onSelect: vi.fn() },
        { type: 'separator', id: 'trailing' },
      ],
      results: [],
      editing: [],
      additional: [],
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      label: 'Заявки',
      children: [{ id: 'new-request' }],
    })
  })
})

function isActionItem(item: ReturnType<typeof buildWorkflowContextMenuItems>[number]) {
  return item.type !== 'separator' && item.type !== 'label'
}
