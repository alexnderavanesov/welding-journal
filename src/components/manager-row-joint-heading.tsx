import {
  JointFullMeta,
  JointTitleLine,
} from '@/components/joint-meta'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ReactNode } from 'react'

type ManagerRowJointHeadingProps = {
  row: WeldRow
  children?: ReactNode
  metaElement?: 'div' | 'span'
  titleClassName?: string
  metaClassName?: string
  truncate?: boolean
}

export function ManagerRowJointHeading({
  row,
  children,
  metaElement: MetaElement = 'div',
  titleClassName,
  metaClassName = 'mt-1 text-xs text-slate-500',
  truncate = false,
}: ManagerRowJointHeadingProps) {
  return (
    <>
      <JointTitleLine row={row} className={titleClassName} truncate={truncate} />
      <MetaElement className={metaClassName}>
        <JointFullMeta row={row} />
        {children}
      </MetaElement>
    </>
  )
}
