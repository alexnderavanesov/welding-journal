import { describe, expect, it, vi } from 'vitest'

import { getDuplicateControlTableColumns } from '@/lib/duplicate-control-table-columns'

describe('duplicate control table columns', () => {
  it('uses the same quiet transparent section treatment as the next-action column', () => {
    const columns = getDuplicateControlTableColumns({
      activeReport: 'lnk',
      onOpenDuplicateControl: vi.fn(),
    })

    expect(columns).toHaveLength(1)
    expect(columns[0]).toMatchObject({
      section: 'Дубль контроль',
      appearance: 'quiet',
      collapsible: true,
    })
  })
})
