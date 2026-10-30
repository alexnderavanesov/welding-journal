import { createFileRoute } from '@tanstack/react-router'
import { AppRouteError } from '@/components/app-route-error'
import { AccountPage } from '@/components/account-page'
export const Route = createFileRoute('/account')({ component: AccountPage, errorComponent: AppRouteError, ssr: false })
