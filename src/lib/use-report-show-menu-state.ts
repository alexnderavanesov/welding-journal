import { useState } from 'react'

export function useReportShowMenuState() {
  const [isPstoShowMenuOpen, setIsPstoShowMenuOpen] = useState(false)
  const [isLnkShowMenuOpen, setIsLnkShowMenuOpen] = useState(false)
  const [isWeldingJournalShowMenuOpen, setIsWeldingJournalShowMenuOpen] = useState(false)

  return {
    isPstoShowMenuOpen,
    isLnkShowMenuOpen,
    isWeldingJournalShowMenuOpen,
    setIsPstoShowMenuOpen,
    setIsLnkShowMenuOpen,
    setIsWeldingJournalShowMenuOpen,
  }
}
