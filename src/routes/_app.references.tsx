import { createFileRoute, redirect } from '@tanstack/react-router'
import { CHECK_PARAMETERS_HREF, isLegacyCheckParametersLocation } from '@/lib/reference-navigation'

export const Route = createFileRoute('/_app/references')({
  beforeLoad: ({ location }) => {
    if (isLegacyCheckParametersLocation(location.href)) throw redirect({ href: CHECK_PARAMETERS_HREF, replace: true })
  },
})
