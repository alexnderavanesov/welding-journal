import {
  JointFullMeta,
  JointTitleLine,
} from '@/components/joint-meta'
import type { WeldRow } from '@/lib/dispatcher-types'

type RequestRowJointHeadingProps = {
  row: WeldRow
}

export function RequestRowJointHeading({ row }: RequestRowJointHeadingProps) {
  return (
    <>
      <JointTitleLine row={row} truncate />
      <span className="block text-xs leading-5 text-slate-500">
        <JointFullMeta row={row} />
      </span>
    </>
  )
}
