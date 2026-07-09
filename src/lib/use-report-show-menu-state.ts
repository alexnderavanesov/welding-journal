import { useState } from 'react'

export function useReportShowMenuState() {
  const [isPstoShowMenuOpen, setIsPstoShowMenuOpen] = useState(false)
  const [isLnkShowMenuOpen, setIsLnkShowMenuOpen] = useState(false)
  const [isWeldingJournalShowMenuOpen, setIsWeldingJournalShowMenuOpen] = useState(false)
  const [isWeldingJournalGenerateMenuOpen, setIsWeldingJournalGenerateMenuOpen] = useState(false)

  return {
    isPstoShowMenuOpen,
    isLnkShowMenuOpen,
    isWeldingJournalGenerateMenuOpen,
    isWeldingJournalShowMenuOpen,
    setIsPstoShowMenuOpen,
    setIsLnkShowMenuOpen,
    setIsWeldingJournalGenerateMenuOpen,
    setIsWeldingJournalShowMenuOpen,
  }
}
