import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/welder-stamps')({
  beforeLoad: ({ location }) => {
    throw redirect({ href: location.href.replace('/welder-stamps', '/references'), replace: true })
  },
})
