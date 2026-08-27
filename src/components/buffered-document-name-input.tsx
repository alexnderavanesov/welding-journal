import { forwardRef, useEffect, useRef, useState, type ComponentProps } from 'react'

import { Input } from '@/components/ui/input'

const NAME_COMMIT_DELAY_MS = 250

type BufferedDocumentNameInputProps = Omit<ComponentProps<typeof Input>, 'onChange' | 'value'> & {
  value: string
  onCommit: (value: string) => void
}

export const BufferedDocumentNameInput = forwardRef<HTMLInputElement, BufferedDocumentNameInputProps>(
  ({ value, onCommit, onBlur, onKeyDown, ...inputProps }, ref) => {
    const [draft, setDraft] = useState(value)
    const onCommitRef = useRef(onCommit)
    const lastEmittedValueRef = useRef(value)

    useEffect(() => {
      onCommitRef.current = onCommit
    }, [onCommit])

    useEffect(() => {
      if (value === lastEmittedValueRef.current) return
      lastEmittedValueRef.current = value
      setDraft(value)
    }, [value])

    const commitValue = (nextValue: string) => {
      if (nextValue === lastEmittedValueRef.current) return
      lastEmittedValueRef.current = nextValue
      onCommitRef.current(nextValue)
    }

    useEffect(() => {
      if (draft === value) return
      const timeoutId = window.setTimeout(() => commitValue(draft), NAME_COMMIT_DELAY_MS)
      return () => window.clearTimeout(timeoutId)
    }, [draft, value])

    return (
      <Input
        {...inputProps}
        ref={ref}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          commitValue(draft)
          onBlur?.(event)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitValue(draft)
          onKeyDown?.(event)
        }}
      />
    )
  },
)

BufferedDocumentNameInput.displayName = 'BufferedDocumentNameInput'
