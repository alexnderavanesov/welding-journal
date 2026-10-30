import { createFileRoute } from '@tanstack/react-router'
import { AppRouteError } from '@/components/app-route-error'
import { AccountPage } from '@/components/account-page'
export const Route = createFileRoute('/activity')({ component: () => <AccountPage initialTab="activity" />, errorComponent: AppRouteError, ssr: false })
