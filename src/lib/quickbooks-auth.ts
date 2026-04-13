import { createAdminClient } from '@/supabase/server'
import { encrypt, decrypt } from '@/lib/quickbooks-crypto'

const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const QB_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'

export function getQBClientId(): string {
  return (process.env.QUICKBOOKS_CLIENT_ID || '').trim()
}

export function getQBClientSecret(): string {
  return (process.env.QUICKBOOKS_CLIENT_SECRET || '').trim()
}

export function getQBRedirectUri(): string {
  return (
    process.env.QUICKBOOKS_REDIRECT_URI ||
    'https://sightings.sasquatchcarpet.com/api/admin/quickbooks/callback'
  ).trim()
}

export function buildQBAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getQBClientId(),
    scope: 'com.intuit.quickbooks.accounting com.intuit.quickbooks.payment',
    redirect_uri: getQBRedirectUri(),
    response_type: 'code',
    state,
  })
  return `${QB_AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
  x_refresh_token_expires_in: number
  realmId?: string
}> {
  const credentials = Buffer.from(
    `${getQBClientId()}:${getQBClientSecret()}`,
  ).toString('base64')

  const res = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getQBRedirectUri(),
    }),
  })

  if (!res.ok) {
    throw new Error(`QB token exchange failed: ${res.status}`)
  }

  return res.json()
}

export async function refreshQBTokens(encryptedRefreshToken: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
  x_refresh_token_expires_in: number
}> {
  const refreshToken = decrypt(encryptedRefreshToken)
  const credentials = Buffer.from(
    `${getQBClientId()}:${getQBClientSecret()}`,
  ).toString('base64')

  const res = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    throw new Error(`QB token refresh failed: ${res.status}`)
  }

  return res.json()
}

export async function saveQBTokens(params: {
  realmId: string
  accessToken: string
  refreshToken: string
  accessTokenExpiresIn: number
  refreshTokenExpiresIn: number
}) {
  const supabase = createAdminClient()
  const now = Date.now()

  const payload = {
    realm_id: encrypt(params.realmId),
    access_token: encrypt(params.accessToken),
    refresh_token: encrypt(params.refreshToken),
    access_token_expires_at: new Date(
      now + params.accessTokenExpiresIn * 1000,
    ).toISOString(),
    refresh_token_expires_at: new Date(
      now + params.refreshTokenExpiresIn * 1000,
    ).toISOString(),
    updated_at: new Date().toISOString(),
  }

  const { data: existing } = await supabase
    .from('quickbooks_oauth_tokens')
    .select('id')
    .limit(1)
    .maybeSingle()

  if (existing?.id) {
    const { error } = await supabase
      .from('quickbooks_oauth_tokens')
      .update(payload)
      .eq('id', existing.id)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('quickbooks_oauth_tokens')
      .insert(payload)
    if (error) throw error
  }
}

export async function getValidQBAccessToken(): Promise<{
  accessToken: string
  realmId: string
} | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('quickbooks_oauth_tokens')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  const now = new Date()
  const accessExpiresAt = new Date(data.access_token_expires_at)
  const refreshExpiresAt = new Date(data.refresh_token_expires_at)

  if (refreshExpiresAt < now) return null

  const realmId = decrypt(data.realm_id)

  const fiveMinutes = 5 * 60 * 1000
  if (accessExpiresAt.getTime() - now.getTime() < fiveMinutes) {
    const refreshed = await refreshQBTokens(data.refresh_token)
    await saveQBTokens({
      realmId,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      accessTokenExpiresIn: refreshed.expires_in,
      refreshTokenExpiresIn: refreshed.x_refresh_token_expires_in,
    })
    return { accessToken: refreshed.access_token, realmId }
  }

  return { accessToken: decrypt(data.access_token), realmId }
}

export async function getQBConnectionStatus(): Promise<{
  connected: boolean
  sync_enabled: boolean
  realmId: string | null
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
}> {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('quickbooks_oauth_tokens')
    .select(
      'realm_id, access_token_expires_at, refresh_token_expires_at, sync_enabled',
    )
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) {
    return {
      connected: false,
      sync_enabled: false,
      realmId: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    }
  }

  const refreshExpired = new Date(data.refresh_token_expires_at) < new Date()

  let realmId: string | null = null
  try {
    realmId = decrypt(data.realm_id)
  } catch {
    realmId = data.realm_id
  }

  return {
    connected: !refreshExpired,
    sync_enabled: data.sync_enabled ?? true,
    realmId,
    accessTokenExpiresAt: data.access_token_expires_at,
    refreshTokenExpiresAt: data.refresh_token_expires_at,
  }
}
