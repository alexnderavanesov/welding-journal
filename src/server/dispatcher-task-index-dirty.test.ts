import { describe, expect, it, vi } from 'vitest'
import {
  getDispatcherDirtyScopes,
  markDispatcherTaskIndexDirty,
} from '@/server/dispatcher-task-index-dirty'

describe('markDispatcherTaskIndexDirty', () => {
  it('changes dispatcher and calculation revisions in one locked database operation', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)

    await markDispatcherTaskIndexDirty({ execute })

    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('keeps old and new weld line scopes distinct and removes exact duplicates', () => {
    const scopes = getDispatcherDirtyScopes(
      [
        { projectTitle: 'Project', subtitleCode: '400', line: 'L-2' },
        { projectTitle: 'Project', subtitleCode: '400', line: 'L-2' },
      ],
      new Map([[1, { projectTitle: 'Project', subtitleCode: '400', line: 'L-1' }]]),
    )

    expect(scopes).toEqual([
      { projectTitle: 'Project', subtitleCode: '400', line: 'L-2' },
      { projectTitle: 'Project', subtitleCode: '400', line: 'L-1' },
    ])
  })
})
