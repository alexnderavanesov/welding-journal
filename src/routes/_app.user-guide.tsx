import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/user-guide')({ beforeLoad: () => { throw redirect({ href: '/account?tab=guide' }) } })
