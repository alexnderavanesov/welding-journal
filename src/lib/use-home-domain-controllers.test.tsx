import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useHomeDocumentController } from '@/lib/use-home-document-controller'
import { useHomeLnkController } from '@/lib/use-home-lnk-controller'
import { useHomePstoController } from '@/lib/use-home-psto-controller'
import { useHomeWeldEditorController } from '@/lib/use-home-weld-editor-controller'

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
  }
}

describe('home page domain controllers', () => {
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
