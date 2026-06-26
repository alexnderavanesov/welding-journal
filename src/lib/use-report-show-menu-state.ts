import { useState } from 'react'

export function useReportShowMenuState() {
  const [isPstoShowMenuOpen, setIsPstoShowMenuOpen] = useState(false)
  const [isLnkShowMenuOpen, setIsLnkShowMenuOpen] = useState(false)

  return {
    isPstoShowMenuOpen,
    isLnkShowMenuOpen,
    setIsPstoShowMenuOpen,
    setIsLnkShowMenuOpen,
  }
}
