import type { Dispatch, SetStateAction } from 'react'
import type { WeldFilters } from '@/server/weld-contracts'
import type { ActiveReport } from '@/lib/home-state'
import type { DispatcherTask, WeldRow } from '@/lib/dispatcher-types'
import type { OpenJointPictureOptions } from '@/lib/joint-picture-navigation'
import {
  DISPATCHER_TASKS_FIELD_KEY,
  DISPATCHER_TASKS_WITH_FILTER,
} from '@/lib/dispatcher-task-row-codes'
import {
  buildExactJointFilters,
  buildJointChainFilters,
  buildLineFilters,
  buildPercentageLineStampFilters,
  buildRowIdListFilters,
  getJointBaseFromRow,
  getRepeatedJointTaskActionText,
  getRepeatedJointTaskBaseJoint,
} from '@/lib/report-navigation'

type UseJointChainActionsOptions = {
  activeReport: ActiveReport
  setActiveReport: Dispatch<SetStateAction<ActiveReport>>
  setChainRecord: Dispatch<SetStateAction<WeldRow | null>>
  openChainPicture: (row: WeldRow, options?: OpenJointPictureOptions) => void
  setColumnFilters: Dispatch<SetStateAction<WeldFilters>>
  setHeatTreatmentFilters: Dispatch<SetStateAction<WeldFilters>>
  setLnkFilters: Dispatch<SetStateAction<WeldFilters>>
  setMessage: (value: string | null) => void
  onBeforeReportNavigation?: (report: ActiveReport) => void
}

export function useJointChainActions({
  activeReport,
  setActiveReport,
  setChainRecord,
  openChainPicture,
  setColumnFilters,
  setHeatTreatmentFilters,
  setLnkFilters,
  setMessage,
  onBeforeReportNavigation,
}: UseJointChainActionsOptions) {
  function beginReportNavigation(report: ActiveReport) {
    if (report !== activeReport) onBeforeReportNavigation?.(report)
  }

  function showRepeatedJointTaskChain(row: WeldRow, baseJoint: string, messageText: string) {
    const filters = buildJointChainFilters(row, baseJoint)
    if (activeReport === 'lnk') {
      setActiveReport('lnk')
      setLnkFilters(filters)
    } else if (activeReport === 'heatTreatment') {
      setActiveReport('heatTreatment')
      setHeatTreatmentFilters(filters)
    } else {
      setActiveReport('weldingJournal')
      setColumnFilters(filters)
    }
    setChainRecord(null)
    setMessage(messageText)
  }

  function openRepeatedJointTaskPicture(task: DispatcherTask) {
    if (task.kind === 'welder-stamp-expiry') return
    if (task.kind === 'line-consistency' || task.kind === 'percentage-line-control') {
      openChainPicture(task.row, { initialTab: 'line', focusedTaskKey: task.key })
      setMessage(`Открыта картина линии ${String(task.row.line ?? '-').trim() || '-'}`)
      return
    }
    openChainPicture(task.row, { initialTab: 'actions', focusedTaskKey: task.key })
    setMessage(`Открыта картина стыка ${String(task.row.joint ?? '-').trim() || '-'}`)
  }

  function openLineInDispatcher(row: WeldRow) {
    beginReportNavigation('weldingJournal')
    setChainRecord(null)
    setActiveReport('weldingJournal')
    setColumnFilters({
      ...buildLineFilters(row),
      [DISPATCHER_TASKS_FIELD_KEY]: DISPATCHER_TASKS_WITH_FILTER,
    } as WeldFilters)
    setMessage(`Открыты задачи линии ${String(row.line ?? '-').trim() || '-'}`)
  }

  function showRepeatedJointTask(task: DispatcherTask) {
    if (task.kind === 'welder-stamp-expiry') return
    if (task.kind === 'line-consistency') {
      setChainRecord(null)
      const filters = buildLineFilters(task.row)
      if (activeReport === 'lnk') {
        setActiveReport('lnk')
        setLnkFilters(filters)
      } else if (activeReport === 'heatTreatment') {
        setActiveReport('heatTreatment')
        setHeatTreatmentFilters(filters)
      } else {
        setActiveReport('weldingJournal')
        setColumnFilters(filters)
      }
      setMessage(`Показана линия ${task.line}: ${task.title.toLowerCase()}`)
      return
    }
    if (task.kind === 'percentage-line-control') {
      setChainRecord(null)
      const filters = task.targetRowIds?.length
        ? { ...buildLineFilters(task.row), ...buildRowIdListFilters(task.targetRowIds) }
        : buildPercentageLineStampFilters(task)
      if (activeReport === 'lnk') {
        setActiveReport('lnk')
        setLnkFilters(filters)
      } else if (activeReport === 'heatTreatment') {
        setActiveReport('heatTreatment')
        setHeatTreatmentFilters(filters)
      } else {
        setActiveReport('weldingJournal')
        setColumnFilters(filters)
      }
      setMessage(
        task.targetRowIds?.length
          ? `Показаны стыки задачи "${task.title.toLowerCase()}" на линии ${task.line}: ${task.targetRowIds.length}`
          : `Показаны стыки клейма ${task.stamp} на линии ${task.line}: ${task.title.toLowerCase()}`,
      )
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
    } else if (activeReport === 'heatTreatment') {
      setActiveReport('heatTreatment')
      setHeatTreatmentFilters(filters)
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
      beginReportNavigation('weldingJournal')
      setActiveReport('weldingJournal')
      setColumnFilters(filters)
      setMessage(`Открыт стык ${String(row.joint ?? '-')} в сварочном журнале`)
      return
    }
    if (activeReport === 'weldingJournal') {
      beginReportNavigation('lnk')
      setActiveReport('lnk')
      setLnkFilters(filters)
      setMessage(`Открыт стык ${String(row.joint ?? '-')} в отчете ЛНК`)
    }
  }

  function openRowInReport(row: WeldRow, report: 'weldingJournal' | 'lnk' | 'heatTreatment') {
    setChainRecord(null)
    const filters = buildExactJointFilters(row)
    beginReportNavigation(report)
    if (report === 'weldingJournal') {
      setActiveReport('weldingJournal')
      setColumnFilters(filters)
      setMessage(`Открыт стык ${String(row.joint ?? '-')} в сварочном журнале`)
      return
    }
    if (report === 'lnk') {
      setActiveReport('lnk')
      setLnkFilters(filters)
      setMessage(`Открыт стык ${String(row.joint ?? '-')} в отчете ЛНК`)
      return
    }
    setActiveReport('heatTreatment')
    setHeatTreatmentFilters(filters)
    setMessage(`Открыт стык ${String(row.joint ?? '-')} в отчете ПСТО`)
  }

  function openRowsInReport(rows: WeldRow[], report: 'weldingJournal' | 'lnk' | 'heatTreatment') {
    const rowIds = rows.map((row) => row.id)
    if (rowIds.length === 0) return
    if (rowIds.length === 1) {
      openRowInReport(rows[0], report)
      return
    }

    setChainRecord(null)
    beginReportNavigation(report)
    const filters = buildRowIdListFilters(rowIds) as WeldFilters
    const count = rowIds.length
    if (report === 'weldingJournal') {
      setActiveReport('weldingJournal')
      setColumnFilters(filters)
      setMessage(`Открыты выбранные стыки в сварочном журнале: ${count}`)
      return
    }
    if (report === 'lnk') {
      setActiveReport('lnk')
      setLnkFilters(filters)
      setMessage(`Открыты выбранные стыки в отчете ЛНК: ${count}`)
      return
    }
    setActiveReport('heatTreatment')
    setHeatTreatmentFilters(filters)
    setMessage(`Открыты выбранные стыки в отчете ПСТО: ${count}`)
  }

  function openChainBaseInCurrentReport(row: WeldRow) {
    const baseJoint = getJointBaseFromRow(row)
    const filters = buildJointChainFilters(row, baseJoint)
    setChainRecord(null)
    if (activeReport === 'lnk') {
      setLnkFilters(filters)
    } else if (activeReport === 'heatTreatment') {
      setHeatTreatmentFilters(filters)
    } else {
      setColumnFilters(filters)
    }
    setMessage(`Показана вся цепочка стыка ${baseJoint}`)
  }

  return {
    openChainBaseInCurrentReport,
    openChainRowInCurrentReport,
    openLineInDispatcher,
    openLinkedReportRow,
    openRowInReport,
    openRowsInReport,
    openRepeatedJointTaskPicture,
    showRepeatedJointTask,
    showRepeatedJointTaskChain,
  }
}
