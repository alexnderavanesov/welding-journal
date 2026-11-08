import type { listAccounts } from '@/server/account-api'

export type AccountListUser = Awaited<ReturnType<typeof listAccounts>>[number]
export const accountRoleLabel = (role: string) => role === 'owner' ? 'Владелец системы' : role === 'admin' ? 'Администратор' : 'Пользователь'
export const accountStatusLabel = (status: string) => status === 'active' ? 'Активирован' : 'Ожидает активации'
export function accountActivityLabel(user: AccountListUser, available: boolean) {
  if (!available) return 'Нет связи'
  if (user.online) return 'Онлайн'
  if (!user.lastActiveAt) return user.status === 'pending' ? 'Ещё не входил' : 'Нет данных'
  return Number.isFinite(new Date(user.lastActiveAt).getTime()) ? 'Был(а) на сайте' : 'Нет данных'
}
export function accountActivityOrder(user: AccountListUser) {
  if (user.online) return Number.MAX_SAFE_INTEGER
  const time = user.lastActiveAt ? new Date(user.lastActiveAt).getTime() : NaN
  return Number.isFinite(time) ? time : null
}
