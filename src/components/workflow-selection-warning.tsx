export function WorkflowSelectionWarning({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
      {message}
    </p>
  ) : null
}
