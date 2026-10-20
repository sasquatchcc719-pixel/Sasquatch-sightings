import { createAdminClient } from '@/supabase/server'
import { encrypt, decrypt } from '@/lib/quickbooks-crypto'
import { randomUUID } from 'node:crypto'

const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const QB_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'

export const QB_RECONNECT_MESSAGE =
  'QuickBooks authorization is no longer valid. Reconnect QuickBooks; waiting sync jobs will resume automatically.'

export class QuickBooksTokenError extends Error {
  constructor(
    public readonly code: string,
    status: number,
  ) {
    super(
      code === 'invalid_grant'
        ? QB_RECONNECT_MESSAGE
        : `QB token refresh failed: ${status} (${code})`,
    )
  }
}

const refreshing = new Map<
  string,
  Promise<{ accessToken: string; realmId: string } | null>
>()

function tokenPayload(params: {
  realmId: string
  accessToken: string
  refreshToken: string
  accessTokenExpiresIn: number
  refreshTokenExpiresIn: number
}) {
  const now = Date.now()
  return {
    realm_id: encrypt(params.realmId),
    access_token: encrypt(params.accessToken),
    refresh_token: encrypt(params.refreshToken),
    access_token_expires_at: new Date(
      now + params.accessTokenExpiresIn * 1000,
    ).toISOString(),
    refresh_token_expires_at: new Date(
      now + params.refreshTokenExpiresIn * 1000,
    ).toISOString(),
    auth_error: null,
    refresh_lock_id: null,
    refresh_lock_until: null,
    updated_at: new Date(now).toISOString(),
  }
}

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
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    // Store only the provider's error code, never token-bearing response data.
    const code =
      typeof body.error === 'string' && /^[a-z_]+$/.test(body.error)
        ? body.error
        : 'token_endpoint_error'
    throw new QuickBooksTokenError(code, res.status)
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
  // This function is for a new user authorization. Routine refreshes below
  // preserve sync_enabled and condition the write on ownership of the lease.
  const payload = { ...tokenPayload(params), sync_enabled: true }

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

  if (error) throw error
  if (!data) return null

  const now = new Date()
  const accessExpiresAt = new Date(data.access_token_expires_at)
  const refreshExpiresAt = new Date(data.refresh_token_expires_at)

  if (refreshExpiresAt < now) return null

  if (data.auth_error === 'invalid_grant')
    throw new QuickBooksTokenError('invalid_grant', 400)
  const realmId = decrypt(data.realm_id)

  const fiveMinutes = 5 * 60 * 1000
  if (accessExpiresAt.getTime() - now.getTime() < fiveMinutes) {
    const existing = refreshing.get(data.id)
    if (existing) return existing
    const pending = refreshWithLease(supabase, data.id)
    refreshing.set(data.id, pending)
    try {
      return await pending
    } finally {
      refreshing.delete(data.id)
    }
  }

  return { accessToken: decrypt(data.access_token), realmId }
}

async function refreshWithLease(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const { data: current, error } = await supabase
      .from('quickbooks_oauth_tokens')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!current) return null
    if (current.auth_error === 'invalid_grant')
      throw new QuickBooksTokenError('invalid_grant', 400)
    if (
      new Date(current.access_token_expires_at).getTime() >
      Date.now() + 300_000
    ) {
      return {
        accessToken: decrypt(current.access_token),
        realmId: decrypt(current.realm_id),
      }
    }

    const lockId = randomUUID()
    const { data: claimed, error: claimError } = await supabase
      .from('quickbooks_oauth_tokens')
      .update({
        refresh_lock_id: lockId,
        refresh_lock_until: new Date(Date.now() + 60_000).toISOString(),
      })
      .eq('id', id)
      .eq('refresh_token', current.refresh_token)
      .or(
        `refresh_lock_until.is.null,refresh_lock_until.lt.${new Date().toISOString()}`,
      )
      .select('id')
      .maybeSingle()
    if (claimError) throw claimError
    if (!claimed) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      continue
    }

    try {
      const tokens = await refreshQBTokens(current.refresh_token)
      const payload = tokenPayload({
        realmId: decrypt(current.realm_id),
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresIn: tokens.expires_in,
        refreshTokenExpiresIn: tokens.x_refresh_token_expires_in,
      })
      // Cross-worker lease plus compare-and-swap: an old response cannot
      // overwrite another worker or a newer user authorization.
      for (let saveAttempt = 0; saveAttempt < 3; saveAttempt++) {
        const { data: saved, error: saveError } = await supabase
          .from('quickbooks_oauth_tokens')
          .update(payload)
          .eq('id', id)
          .eq('refresh_token', current.refresh_token)
          .eq('refresh_lock_id', lockId)
          .select('id')
          .maybeSingle()
        if (!saveError) {
          if (saved)
            return {
              accessToken: tokens.access_token,
              realmId: decrypt(current.realm_id),
            }
          break
        }
        // Retain the returned rotated token while retrying its persistence;
        // do not ask Intuit to rotate it again because one DB write failed.
        if (saveAttempt === 2) throw saveError
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      // A reconnect or another worker won. Read its credentials on the next loop.
    } catch (error) {
      const { data: latest, error: readError } = await supabase
        .from('quickbooks_oauth_tokens')
        .select('refresh_token')
        .eq('id', id)
        .maybeSingle()
      if (readError) throw readError
      if (latest && latest.refresh_token !== current.refresh_token) continue
      if (
        error instanceof QuickBooksTokenError &&
        error.code === 'invalid_grant'
      ) {
        const { error: stateError } = await supabase
          .from('quickbooks_oauth_tokens')
          .update({ auth_error: 'invalid_grant' })
          .eq('id', id)
          .eq('refresh_token', current.refresh_token)
          .eq('refresh_lock_id', lockId)
        if (stateError) throw stateError
      }
      throw error
    } finally {
      const { error: releaseError } = await supabase
        .from('quickbooks_oauth_tokens')
        .update({ refresh_lock_id: null, refresh_lock_until: null })
        .eq('id', id)
        .eq('refresh_lock_id', lockId)
      if (releaseError)
        console.error(
          '[QB auth] Could not release refresh lease:',
          releaseError.message,
        )
    }
  }
  throw new Error(
    'QuickBooks authorization renewal is already in progress; sync will retry automatically.',
  )
}

export async function getQBConnectionStatus(): Promise<{
  connected: boolean
  sync_enabled: boolean
  realmId: string | null
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
  reconnect_required: boolean
  connection_error: string | null
}> {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('quickbooks_oauth_tokens')
    .select(
      'realm_id, access_token_expires_at, refresh_token_expires_at, sync_enabled, auth_error',
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
      reconnect_required: false,
      connection_error: null,
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
    connected: !refreshExpired && data.auth_error !== 'invalid_grant',
    sync_enabled: data.sync_enabled ?? true,
    realmId,
    accessTokenExpiresAt: data.access_token_expires_at,
    refreshTokenExpiresAt: data.refresh_token_expires_at,
    reconnect_required: refreshExpired || data.auth_error === 'invalid_grant',
    connection_error:
      refreshExpired || data.auth_error === 'invalid_grant'
        ? QB_RECONNECT_MESSAGE
        : null,
  }
}
