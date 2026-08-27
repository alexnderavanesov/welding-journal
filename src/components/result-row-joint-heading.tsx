import {
  JointProjectSubtitleMeta,
  JointSpoolDateMeta,
  JointTitleLine,
} from '@/components/joint-meta'
import type { WeldRow } from '@/lib/dispatcher-types'

type ResultRowJointHeadingProps = {
  row: WeldRow
}

export function ResultRowJointHeading({ row }: ResultRowJointHeadingProps) {
  return (
    <>
      <JointTitleLine row={row} truncate />
      <span className="mt-0.5 grid min-w-0 gap-0.5 text-xs leading-4 text-slate-500">
        <span className="min-w-0 break-words">
          <JointProjectSubtitleMeta row={row} />
        </span>
        <span className="min-w-0 break-words">
          <JointSpoolDateMeta row={row} />
        </span>
      </span>
    </>
  )
}
