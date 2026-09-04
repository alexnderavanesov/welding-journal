import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  EditingState,
  HeatTreatmentFieldEditingState,
  RkExposureEditingState,
} from '@/lib/home-state'
import {
  getPstoLineIdentityKey,
  normalizePstoLineIdentity,
  type PstoWeldLineMoveDecision,
  type PstoWeldLineMoveDisposition,
  type PstoWeldLineMovePreview,
  type WeldChainLineMovePlan,
} from '@/lib/psto-line-assignment'
import type { WeldInput } from '@/lib/weld-fields'
import { getPstoWeldLineMovePreview } from '@/server/weld-line-operations'

export type PstoLineMoveDraftState = {
  rowId: number
  targetIdentity: PstoWeldLineMovePreview['targetIdentity']
  targetIdentityKey: string
} & (
  | { status: 'checking' | 'clear' }
  | { status: 'error'; error: string }
  | {
      status: 'required'
      preview: PstoWeldLineMovePreview
      decisions: PstoWeldLineMoveDecision[] | null
      dialogOpen: boolean
    }
)

export function useHomeWeldEditorController() {
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [heatTreatmentFieldEditing, setHeatTreatmentFieldEditing] =
    useState<HeatTreatmentFieldEditingState | null>(null)
  const [rkExposureEditing, setRkExposureEditing] = useState<RkExposureEditingState | null>(null)
  const [pstoLineMoveDraftState, setPstoLineMoveDraftState] = useState<PstoLineMoveDraftState | null>(null)
  const pstoLineMoveDraftStateRef = useRef<PstoLineMoveDraftState | null>(null)
  const pstoLineMovePreviewRequestIdRef = useRef(0)
  const editingRowId = editing?.record.id ?? null
  const editingSourceLineIdentityKey = useMemo(
    () => getPstoLineIdentityKey(editing?.record ?? {}),
    [editing?.record.line, editing?.record.projectTitle, editing?.record.subtitleCode],
  )

  const commitPstoLineMoveDraftState = useCallback((next: PstoLineMoveDraftState | null) => {
    pstoLineMoveDraftStateRef.current = next
    setPstoLineMoveDraftState(next)
  }, [])

  const resetPstoLineMoveDraftState = useCallback(() => {
    pstoLineMovePreviewRequestIdRef.current += 1
    commitPstoLineMoveDraftState(null)
  }, [commitPstoLineMoveDraftState])

  useEffect(() => {
    resetPstoLineMoveDraftState()
  }, [editingRowId, resetPstoLineMoveDraftState])

  const checkEditedWeldLineMove = useCallback((identity: {
    projectTitle?: unknown
    subtitleCode?: unknown
    line?: unknown
  }, force = false) => {
    if (!editingRowId) {
      resetPstoLineMoveDraftState()
      return
    }

    const targetIdentity = normalizePstoLineIdentity(identity)
    const targetIdentityKey = getPstoLineIdentityKey(targetIdentity)
    const hasCompleteIdentity = Boolean(
      targetIdentity.projectTitle && targetIdentity.subtitleCode && targetIdentity.line,
    )
    if (!hasCompleteIdentity || targetIdentityKey === editingSourceLineIdentityKey) {
      resetPstoLineMoveDraftState()
      return
    }

    const current = pstoLineMoveDraftStateRef.current
    if (!force && current?.rowId === editingRowId && current.targetIdentityKey === targetIdentityKey) return

    const requestId = pstoLineMovePreviewRequestIdRef.current + 1
    pstoLineMovePreviewRequestIdRef.current = requestId
    commitPstoLineMoveDraftState({
      rowId: editingRowId,
      targetIdentity,
      targetIdentityKey,
      status: 'checking',
    })

    void getPstoWeldLineMovePreview({ data: {
      rowId: editingRowId,
      targetIdentity,
    } }).then((preview) => {
      if (pstoLineMovePreviewRequestIdRef.current !== requestId) return
      if (!preview) {
        commitPstoLineMoveDraftState({
          rowId: editingRowId,
          targetIdentity,
          targetIdentityKey,
          status: 'clear',
        })
        return
      }
      commitPstoLineMoveDraftState({
        rowId: editingRowId,
        targetIdentity,
        targetIdentityKey,
        status: 'required',
        preview,
        decisions: null,
        dialogOpen: true,
      })
    }).catch((error) => {
      if (pstoLineMovePreviewRequestIdRef.current !== requestId) return
      commitPstoLineMoveDraftState({
        rowId: editingRowId,
        targetIdentity,
        targetIdentityKey,
        status: 'error',
        error: error instanceof Error ? error.message : 'Не удалось проверить перенос стыка между линиями.',
      })
    })
  }, [
    commitPstoLineMoveDraftState,
    editingRowId,
    editingSourceLineIdentityKey,
    resetPstoLineMoveDraftState,
  ])

  const getPstoLineMoveSaveBlockReason = useCallback((draft: WeldInput) => {
    if (!editingRowId) return null
    const targetIdentity = normalizePstoLineIdentity(draft)
    if (!targetIdentity.projectTitle || !targetIdentity.subtitleCode || !targetIdentity.line) return null
    const targetIdentityKey = getPstoLineIdentityKey(targetIdentity)
    if (targetIdentityKey === editingSourceLineIdentityKey) return null

    const state = pstoLineMoveDraftState
    if (state?.rowId !== editingRowId || state.targetIdentityKey !== targetIdentityKey || state.status === 'checking') {
      return 'Проверяем перенос стыка между линиями. Дождитесь завершения проверки.'
    }
    if (state.status === 'error') return `Не удалось проверить перенос стыка: ${state.error}`
    if (state.status === 'required' && !state.decisions) {
      return 'Перед сохранением выберите, как обработать связанные документы и результаты.'
    }
    return null
  }, [editingRowId, editingSourceLineIdentityKey, pstoLineMoveDraftState])

  const openPstoLineMoveDraftDecision = useCallback(() => {
    const current = pstoLineMoveDraftStateRef.current
    if (!current) return
    if (current.status === 'error') {
      checkEditedWeldLineMove(current.targetIdentity, true)
      return
    }
    if (current.status === 'required') {
      commitPstoLineMoveDraftState({ ...current, dialogOpen: true })
    }
  }, [checkEditedWeldLineMove, commitPstoLineMoveDraftState])

  const pstoLineMovePreSaveDecision = useMemo(() => {
    const state = pstoLineMoveDraftState
    if (!state || state.rowId !== editingRowId) return null
    if (state.status === 'error') {
      return {
        status: 'error' as const,
        message: `Проверка переноса не выполнена: ${state.error}`,
        actionLabel: 'Повторить',
        onAction: openPstoLineMoveDraftDecision,
      }
    }
    if (state.status !== 'required') return null
    if (!state.decisions) {
      return {
        status: 'required' as const,
        message: 'До сохранения карточки нужно решить, как обработать связанные документы и результаты.',
        actionLabel: 'Выбрать',
        onAction: openPstoLineMoveDraftDecision,
      }
    }
    return {
      status: 'resolved' as const,
      message: getPstoLineMoveDraftDecisionSummary(state.preview, state.decisions),
      actionLabel: 'Изменить',
      onAction: openPstoLineMoveDraftDecision,
    }
  }, [editingRowId, openPstoLineMoveDraftDecision, pstoLineMoveDraftState])

  const getPstoLineMoveSaveData = useCallback((draft: WeldInput & { id?: number | null }): {
    pstoLineMoveDisposition?: PstoWeldLineMoveDisposition
    weldChainLineMovePlan?: WeldChainLineMovePlan
  } | null => {
    const targetIdentityKey = getPstoLineIdentityKey(draft)
    const state = pstoLineMoveDraftStateRef.current
    if (!(state?.status === 'required' &&
      state.rowId === draft.id &&
      state.targetIdentityKey === targetIdentityKey &&
      state.decisions)) return null

    if (state.preview.isChainMove) {
      return {
        weldChainLineMovePlan: {
          expectedRowIds: state.preview.expectedRowIds,
          expectedVersions: state.preview.expectedVersions,
          decisions: state.decisions,
        },
      }
    }
    const sourceDecision = state.decisions.find((decision) => decision.rowId === state.rowId)
    return sourceDecision ? { pstoLineMoveDisposition: sourceDecision.disposition } : null
  }, [])

  const confirmPstoLineMove = useCallback((decisions: PstoWeldLineMoveDecision[]) => {
    const current = pstoLineMoveDraftStateRef.current
    if (current?.status !== 'required') return
    commitPstoLineMoveDraftState({ ...current, decisions, dialogOpen: false })
  }, [commitPstoLineMoveDraftState])

  return {
    editing,
    setEditing,
    heatTreatmentFieldEditing,
    setHeatTreatmentFieldEditing,
    rkExposureEditing,
    setRkExposureEditing,
    pstoLineMoveDraftState,
    pstoLineMoveDraftStateRef,
    commitPstoLineMoveDraftState,
    resetPstoLineMoveDraftState,
    checkEditedWeldLineMove,
    getPstoLineMoveSaveBlockReason,
    pstoLineMovePreSaveDecision,
    getPstoLineMoveSaveData,
    confirmPstoLineMove,
  }
}

function getPstoLineMoveDraftDecisionSummary(
  preview: PstoWeldLineMovePreview,
  decisions: PstoWeldLineMoveDecision[],
) {
  if (preview.isChainMove) {
    const decisionCount = preview.rows.filter((row) => row.requiresDisposition).length
    return `Подтвержден перенос всей цепочки ${preview.rootJoint}: записей ${preview.rows.length}` +
      `${decisionCount > 0 ? `, решений по ПСТО и НК до ТО: ${decisionCount}` : ''}.`
  }
  const disposition = decisions.find((decision) => decision.rowId === preview.row.rowId)?.disposition ?? 'keepPrimary'
  const primaryMethods = preview.row.primaryMethods.join(', ') || 'ВИК/РК/УЗК/ПВК'
  if (disposition === 'movePrimaryToBeforeHeatTreatment') {
    return `Выбрано: при сохранении основной комплект ${primaryMethods} будет перенесен в «До ТО».`
  }
  if (disposition === 'deletePrimary') {
    return `Выбрано: при сохранении основной комплект ${primaryMethods} будет удален.`
  }
  if (disposition === 'promoteBeforeHeatTreatment') {
    const methods = preview.row.promotablePreMethods.join(', ') || 'НК до ТО'
    return `Выбрано: при сохранении завершенный комплект ${methods} станет основным.`
  }
  if (preview.targetState === 'assigned') {
    return `Выбрано: основной комплект ${primaryMethods} останется без изменений; отдельный НК до ТО можно оформить позже.`
  }
  if (preview.row.preservesPerformedHistory) {
    return 'Выбрано: при сохранении выполненная история ПСТО, ТВМТ и НК останется доступной.'
  }
  return 'Выбрано: при сохранении основной комплект останется, а незавершенные данные НК до ТО будут удалены.'
}
