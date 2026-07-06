import type { Dispatch, SetStateAction } from 'react'
import type { WeldFilters } from '@/server/welds'
import type { ActiveReport } from '@/lib/home-state'
import type { DispatcherTask, WeldRow } from '@/lib/dispatcher-types'
import {
  buildExactJointFilters,
  buildJointChainFilters,
  buildLineFilters,
  buildPercentageLineStampFilters,
  getJointBaseFromRow,
  getRepeatedJointTaskActionText,
  getRepeatedJointTaskBaseJoint,
} from '@/lib/report-navigation'

type UseJointChainActionsOptions = {
  activeReport: ActiveReport
  setActiveReport: Dispatch<SetStateAction<ActiveReport>>
  setChainRecord: Dispatch<SetStateAction<WeldRow | null>>
  setColumnFilters: Dispatch<SetStateAction<WeldFilters>>
  setLnkFilters: Dispatch<SetStateAction<WeldFilters>>
  setMessage: (value: string | null) => void
}

export function useJointChainActions({
  activeReport,
  setActiveReport,
  setChainRecord,
  setColumnFilters,
  setLnkFilters,
  setMessage,
}: UseJointChainActionsOptions) {
  function showRepeatedJointTaskChain(row: WeldRow, baseJoint: string, messageText: string) {
    const filters = buildJointChainFilters(row, baseJoint)
    if (activeReport === 'lnk') {
      setActiveReport('lnk')
      setLnkFilters(filters)
    } else {
      setActiveReport('weldingJournal')
      setColumnFilters(filters)
    }
    setChainRecord(row)
    setMessage(messageText)
  }

  function showRepeatedJointTask(task: DispatcherTask) {
    if (task.kind === 'welder-stamp-expiry') return
    if (task.kind === 'line-consistency') {
      setChainRecord(null)
      const filters = buildLineFilters(task.row)
      if (activeReport === 'lnk') {
        setActiveReport('lnk')
        setLnkFilters(filters)
      } else {
        setActiveReport('weldingJournal')
        setColumnFilters(filters)
      }
      setMessage(`Показана линия ${task.line}: ${task.title.toLowerCase()}`)
      return
    }
    if (task.kind === 'percentage-line-control') {
      setChainRecord(null)
      const filters = buildPercentageLineStampFilters(task)
      if (activeReport === 'lnk') {
        setActiveReport('lnk')
        setLnkFilters(filters)
      } else {
        setActiveReport('weldingJournal')
        setColumnFilters(filters)
      }
      setMessage(`Показаны стыки клейма ${task.stamp} на линии ${task.line}: ${task.title.toLowerCase()}`)
      return
    }
    const baseJoint = getRepeatedJointTaskBaseJoint(task)
    const actionText = getRepeatedJointTaskActionText(task)
    showRepeatedJointTaskChain(task.row, baseJoint, `Показана цепочка стыка ${baseJoint}: ${actionText}`)
  }

  function openChainRowInCurrentReport(row: WeldRow) {
    setChainRecord(null)
    const filters = buildExactJointFilters(row)
    if (activeReport === 'lnk') {
      setActiveReport('lnk')
      setLnkFilters(filters)
    } else {
      setActiveReport('weldingJournal')
      setColumnFilters(filters)
    }
    setMessage(`Открыт стык ${String(row.joint ?? '-')} в текущем отчете`)
  }

  function openLinkedReportRow(row: WeldRow) {
    setChainRecord(null)
    const filters = buildExactJointFilters(row)
    if (activeReport === 'lnk') {
      setActiveReport('weldingJournal')
      setColumnFilters(filters)
      setMessage(`Открыт стык ${String(row.joint ?? '-')} в сварочном журнале`)
      return
    }
    if (activeReport === 'weldingJournal') {
      setActiveReport('lnk')
      setLnkFilters(filters)
      setMessage(`Открыт стык ${String(row.joint ?? '-')} в отчете ЛНК`)
    }
  }

  function openChainBaseInCurrentReport(row: WeldRow) {
    const baseJoint = getJointBaseFromRow(row)
    showRepeatedJointTaskChain(row, baseJoint, `Показана вся цепочка стыка ${baseJoint}`)
  }

  return {
    openChainBaseInCurrentReport,
    openChainRowInCurrentReport,
    openLinkedReportRow,
    showRepeatedJointTask,
    showRepeatedJointTaskChain,
  }
}
