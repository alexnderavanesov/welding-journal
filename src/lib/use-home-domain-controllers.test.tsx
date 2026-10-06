import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useHomeDocumentController } from '@/lib/use-home-document-controller'
import { useHomeLnkController } from '@/lib/use-home-lnk-controller'
import { useHomePstoController } from '@/lib/use-home-psto-controller'
import { useHomeWeldEditorController } from '@/lib/use-home-weld-editor-controller'
import { useHomeJournalController } from '@/lib/use-home-journal-controller'
import { createRequestDocumentIdentity } from '@/lib/request-document-identity'

function useDomainControllers() {
  return {
    lnk: useHomeLnkController(),
    psto: useHomePstoController(),
    documents: useHomeDocumentController({
      setMessage: () => undefined,
      setGenerationMenuOpen: () => undefined,
      setShowMenuOpen: () => undefined,
      welderStamps: [],
    }),
    weldEditor: useHomeWeldEditorController(),
    journal: useHomeJournalController(),
  }
}

describe('home page domain controllers', () => {
  it('keeps registry searches, candidate selections and journal dialogs in their owning domains', () => {
    const { result } = renderHook(() => useDomainControllers())
    const pstoDraft = result.current.psto.pstoResultDraft
    act(() => {
      result.current.lnk.setLnkResultRegistrySearch('F901')
      result.current.lnk.setPreHeatTreatmentCandidateIds([1, 2, 3])
      result.current.journal.setCoilRestorationRootId(7)
      result.current.journal.setIsImportDialogOpen(true)
    })
    expect(result.current.lnk.lnkResultRegistrySearch).toBe('F901')
    expect(result.current.lnk.preHeatTreatmentCandidateIds).toEqual([1, 2, 3])
    expect(result.current.psto.pstoResultRegistrySearch).toBe('')
    expect(result.current.psto.pstoResultDraft).toBe(pstoDraft)
    expect(result.current.journal.coilRestorationRootId).toBe(7)
    expect(result.current.journal.isImportDialogOpen).toBe(true)
  })

  it('does not render again when candidate document identity has not changed', () => {
    let renders = 0
    const { result } = renderHook(() => { renders++; return useHomePstoController() })
    act(() => result.current.handlePstoRepeatCandidateRequestChange(createRequestDocumentIdentity('P1', '2026-10-01')))
    const stored = result.current.pstoRepeatCandidateRequest
    // React may perform one bailout render after a changed state; subsequent
    // identical dialog notifications must settle, not form an effect loop.
    act(() => result.current.handlePstoRepeatCandidateRequestChange(createRequestDocumentIdentity('P1', '2026-10-01')))
    const settledRenders = renders
    for (let attempt = 0; attempt < 10; attempt++) {
      act(() => result.current.handlePstoRepeatCandidateRequestChange(createRequestDocumentIdentity('P1', '2026-10-01')))
    }
    expect(result.current.pstoRepeatCandidateRequest).toBe(stored)
    expect(renders).toBe(settledRenders)
  })

  it('opens and closes the PSTO history with fresh selection and bounded registry size', () => {
    const { result } = renderHook(() => useHomePstoController())
    act(() => {
      result.current.setPstoResultRegistrySearch('old search')
      result.current.setPstoResultRegistryLimit(500)
      result.current.setPstoResultDraft(current => ({ ...current, rowIds: new Set([17]) }))
      result.current.setManagedPstoDiagramDrafts({ 17: 'old diagram' })
    })
    act(() => result.current.openAllPstoHistory())
    expect(result.current.isPstoResultManagerOpen).toBe(true)
    expect(result.current.isPstoResultRegistryAll).toBe(true)
    expect(result.current.pstoResultRegistrySearch).toBe('')
    expect(result.current.pstoResultDraft.rowIds.size).toBe(0)
    expect(result.current.managedPstoDiagramDrafts).toEqual({})
    const initialLimit = result.current.pstoResultRegistryLimit
    act(() => result.current.closePstoResultManager())
    expect(result.current.isPstoResultManagerOpen).toBe(false)
    expect(result.current.isPstoResultRegistryAll).toBe(false)
    expect(result.current.pstoResultRegistryLimit).toBe(initialLimit)
  })

  it('keeps LNK interaction state isolated from PSTO, documents, and weld editing', () => {
    const { result } = renderHook(() => useDomainControllers())
    const pstoDraft = result.current.psto.pstoResultDraft

    act(() => {
      result.current.lnk.setPreHeatTreatmentLnkWorkflowMode('request')
      result.current.lnk.setIsLnkWorkflowMenuOpen(true)
    })

    expect(result.current.lnk.preHeatTreatmentLnkWorkflowMode).toBe('request')
    expect(result.current.lnk.isLnkWorkflowMenuOpen).toBe(true)
    expect(result.current.psto.pstoResultDraft).toBe(pstoDraft)
    expect(result.current.psto.pstoRepeatWorkflowMode).toBeNull()
    expect(result.current.documents.documentGenerationRequest).toBeNull()
    expect(result.current.weldEditor.editing).toBeNull()
  })

  it('keeps PSTO interaction state isolated from LNK dialogs', () => {
    const { result } = renderHook(() => useDomainControllers())
    const lnkDraft = result.current.lnk.lnkResultDraft

    act(() => {
      result.current.psto.setPstoRepeatWorkflowMode('result')
      result.current.psto.setIsPstoLineProgramOpen(true)
    })

    expect(result.current.psto.pstoRepeatWorkflowMode).toBe('result')
    expect(result.current.psto.isPstoLineProgramOpen).toBe(true)
    expect(result.current.lnk.lnkResultDraft).toBe(lnkDraft)
    expect(result.current.lnk.isLnkResultModalOpen).toBe(false)
  })

  it('opens only one PSTO workflow family at a time', () => {
    const { result } = renderHook(() => useDomainControllers())

    act(() => result.current.psto.openTvmtWorkflow('request'))
    expect(result.current.psto.tvmtWorkflowMode).toBe('request')

    act(() => result.current.psto.openPstoRepeatWorkflow('result'))
    expect(result.current.psto.tvmtWorkflowMode).toBeNull()
    expect(result.current.psto.pstoRepeatWorkflowMode).toBe('result')

    act(() => result.current.psto.openPstoLineProgram())
    expect(result.current.psto.pstoRepeatWorkflowMode).toBeNull()
    expect(result.current.psto.isPstoLineProgramOpen).toBe(true)
  })

  it('switches LNK between primary and pre-heat-treatment dialogs atomically', () => {
    const { result } = renderHook(() => useDomainControllers())

    act(() => {
      result.current.lnk.setIsLnkResultModalOpen(true)
      result.current.lnk.setIsDuplicateControlModalOpen(true)
    })
    act(() => result.current.lnk.openPreHeatTreatmentLnkWorkflow('result', 'ВИК'))

    expect(result.current.lnk.isLnkResultModalOpen).toBe(false)
    expect(result.current.lnk.isDuplicateControlModalOpen).toBe(false)
    expect(result.current.lnk.preHeatTreatmentLnkWorkflowMode).toBe('result')
    expect(result.current.lnk.preHeatTreatmentLnkInitialMethodCode).toBe('ВИК')

    act(() => result.current.lnk.openPreHeatTreatmentResultRegistry({ registryMode: 'request' }))
    expect(result.current.lnk.preHeatTreatmentLnkWorkflowMode).toBeNull()
    expect(result.current.lnk.isPreHeatTreatmentResultManagerOpen).toBe(true)
    expect(result.current.lnk.preHeatTreatmentResultManagerMode).toBe('request')
  })

  it('keeps line-move state inside the weld-editor controller', () => {
    const { result } = renderHook(() => useDomainControllers())

    act(() => {
      result.current.weldEditor.commitPstoLineMoveDraftState({
        rowId: 7,
        targetIdentity: { projectTitle: 'Проект', subtitleCode: 'Шифр', line: 'Линия' },
        targetIdentityKey: 'Проект\u0000Шифр\u0000Линия',
        status: 'checking',
      })
    })
    expect(result.current.weldEditor.pstoLineMoveDraftState?.rowId).toBe(7)

    act(() => result.current.weldEditor.resetPstoLineMoveDraftState())

    expect(result.current.weldEditor.pstoLineMoveDraftState).toBeNull()
    expect(result.current.psto.pstoRepeatWorkflowMode).toBeNull()
    expect(result.current.lnk.preHeatTreatmentLnkWorkflowMode).toBeNull()
  })
})
