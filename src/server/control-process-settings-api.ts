import { createServerFn } from '@tanstack/react-start'

export type ControlProcessSettingsOverview = {
  preHeatTreatmentBlockerCount: number
}

export const getControlProcessSettingsOverview = createServerFn({ method: 'GET' })
  .handler(async (): Promise<ControlProcessSettingsOverview> => {
    const server = await import('@/server/control-process-settings')
    return server.getControlProcessSettingsOverview()
  })
