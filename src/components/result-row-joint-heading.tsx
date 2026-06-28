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
      <span className="block text-xs leading-5 text-slate-500">
        <JointProjectSubtitleMeta row={row} />
      </span>
      <span className="block text-xs leading-5 text-slate-500">
        <JointSpoolDateMeta row={row} />
      </span>
    </>
  )
}
