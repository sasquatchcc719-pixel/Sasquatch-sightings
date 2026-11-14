const HOLOGRAM_API_BASE = 'https://dashboard.hologram.io/api/1'
const DEFAULT_DEVICE_ID = '6874649'
const DEFAULT_ORG_ID = '112601'

type HologramCellularLink = {
  overagelimit?: number | null
  state?: string | null
}

type HologramDevice = {
  id?: number | string | null
  simcardid?: number | string | null
  intended_plan_data?: number | null
  links?: { cellular?: HologramCellularLink[] | null } | null
}

type HologramDeviceListResponse = {
  success?: boolean
  data?: HologramDevice[] | null
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

  if (!response.ok) {
    let providerError = ''
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === 'string') providerError = `: ${body.error}`
    } catch {
      // Keep provider failures concise and never log response bodies wholesale.
    }
    throw new Error(`Hologram request failed (${response.status})${providerError}`)
  }
  return response.json() as Promise<T>
}

export async function readCellularUsage(): Promise<CellularUsage> {
  const apiKey = process.env.HOLOGRAM_API_KEY?.trim()
  const deviceId = process.env.HOLOGRAM_DEVICE_ID?.trim() || DEFAULT_DEVICE_ID
  const orgId = process.env.HOLOGRAM_ORG_ID?.trim() || DEFAULT_ORG_ID
  if (!apiKey) throw new Error('Hologram usage is not configured')

  const devices = await hologramRequest<HologramDeviceListResponse>(
    `/devices?orgid=${encodeURIComponent(orgId)}&limit=100&withlocation=false`,
    apiKey,
  )
  const device = devices.data?.find((item) => String(item.id) === deviceId)
  const simCardId = device?.simcardid
  if (!devices.success || !device || simCardId == null)
    throw new Error('Hologram device is unavailable')

  const cellularLink = device.links?.cellular?.[0]
  const configuredLimit = cellularLink?.overagelimit
  const planData = device.intended_plan_data
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
