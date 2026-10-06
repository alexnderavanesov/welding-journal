import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/percentage-lines')({
  beforeLoad: ({ location }) => {
    throw redirect({ href: location.href.replace('/percentage-lines', '/line-program'), replace: true })
  },
})
