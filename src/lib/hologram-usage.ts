const HOLOGRAM_API_BASE = 'https://dashboard.hologram.io/api/1'
const DEFAULT_DEVICE_ID = '6874649'

type HologramCellularLink = {
  overagelimit?: number | null
  state?: string | null
}

type HologramDeviceResponse = {
  success?: boolean
  data?: {
    simcardid?: number | string | null
    intended_plan_data?: number | null
    links?: { cellular?: HologramCellularLink[] | null } | null
  }
}

type HologramUsageResponse = {
  success?: boolean
  data?: {
    current_billing_usage?: number | null
    billing_period_start?: string | null
    billing_period_end?: string | null
  }
}

export type CellularUsage = {
  deviceId: string
  simCardId: string
  usedBytes: number
  limitBytes: number | null
  remainingBytes: number | null
  percentUsed: number | null
  billingPeriodStart: string | null
  billingPeriodEnd: string | null
  status: string | null
  updatedAt: string
}

async function hologramRequest<T>(path: string, apiKey: string): Promise<T> {
  const response = await fetch(`${HOLOGRAM_API_BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString('base64')}`,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  })

  if (!response.ok) throw new Error('Hologram request failed')
  return response.json() as Promise<T>
}

export async function readCellularUsage(): Promise<CellularUsage> {
  const apiKey = process.env.HOLOGRAM_API_KEY?.trim()
  const deviceId = process.env.HOLOGRAM_DEVICE_ID?.trim() || DEFAULT_DEVICE_ID
  if (!apiKey) throw new Error('Hologram usage is not configured')

  const device = await hologramRequest<HologramDeviceResponse>(
    `/devices/${encodeURIComponent(deviceId)}`,
    apiKey,
  )
  const simCardId = device.data?.simcardid
  if (!device.success || simCardId == null)
    throw new Error('Hologram device is unavailable')

  const cellularLink = device.data?.links?.cellular?.[0]
  const configuredLimit = cellularLink?.overagelimit
  const planData = device.data?.intended_plan_data
  const limitBytes =
    configuredLimit === -1
      ? null
      : typeof configuredLimit === 'number'
        ? Math.max(0, configuredLimit)
        : typeof planData === 'number'
          ? Math.max(0, planData)
          : null

  const usage = await hologramRequest<HologramUsageResponse>(
    `/usage/billing/simcard/${encodeURIComponent(String(simCardId))}`,
    apiKey,
  )
  const usedBytes = usage.data?.current_billing_usage
  if (!usage.success || typeof usedBytes !== 'number')
    throw new Error('Hologram usage is unavailable')

  const safeUsedBytes = Math.max(0, usedBytes)
  const remainingBytes =
    limitBytes == null ? null : Math.max(0, limitBytes - safeUsedBytes)
  const percentUsed =
    limitBytes == null || limitBytes === 0
      ? null
      : Math.min(100, (safeUsedBytes / limitBytes) * 100)

  return {
    deviceId,
    simCardId: String(simCardId),
    usedBytes: safeUsedBytes,
    limitBytes,
    remainingBytes,
    percentUsed,
    billingPeriodStart: usage.data?.billing_period_start ?? null,
    billingPeriodEnd: usage.data?.billing_period_end ?? null,
    status: cellularLink?.state ?? null,
    updatedAt: new Date().toISOString(),
  }
}
