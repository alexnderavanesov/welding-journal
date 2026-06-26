import { useState } from 'react'
import type { DispatcherTask } from '@/lib/dispatcher-types'

export function useDispatcherTaskUiState() {
  const [dismissedRepeatedJointTaskKeys, setDismissedRepeatedJointTaskKeys] = useState<Set<string>>(new Set())
  const [expandedRepeatedJointTaskKeys, setExpandedRepeatedJointTaskKeys] = useState<Set<string>>(new Set())

  function dismissRepeatedJointTask(task: DispatcherTask) {
    setDismissedRepeatedJointTaskKeys((current) => new Set([...current, task.key]))
  }

  function dismissRepeatedJointTasks(tasks: DispatcherTask[]) {
    setDismissedRepeatedJointTaskKeys((current) => new Set([...current, ...tasks.map((task) => task.key)]))
  }

  function resetDismissedRepeatedJointTasks() {
    setDismissedRepeatedJointTaskKeys(new Set())
  }

  function isRepeatedJointTaskExpanded(task: DispatcherTask) {
    return expandedRepeatedJointTaskKeys.has(task.key)
  }

  function toggleRepeatedJointTaskDetails(task: DispatcherTask) {
    setExpandedRepeatedJointTaskKeys((current) => {
      const next = new Set(current)
      if (next.has(task.key)) {
        next.delete(task.key)
      } else {
        next.add(task.key)
      }
      return next
    })
  }

  return {
    dismissedRepeatedJointTaskKeys,
    dismissRepeatedJointTask,
    dismissRepeatedJointTasks,
    isRepeatedJointTaskExpanded,
    resetDismissedRepeatedJointTasks,
    setExpandedRepeatedJointTaskKeys,
    toggleRepeatedJointTaskDetails,
  }
}
