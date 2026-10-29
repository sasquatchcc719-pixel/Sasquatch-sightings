import type { McpActor } from './business-operations'

export type CommercialWorkspaceActor = McpActor & { clientId: string }

const WORKSPACE_URL =
  'https://sasquatch-outreach.vercel.app/api/integrations/harry/workspace'
const REQUEST_LIMIT = 32 * 1024
const RESPONSE_LIMIT = 2 * 1024 * 1024
const ACTIONS = new Set([
  'get_playbook',
  'email_agent_status',
  'workday_status',
  'list_escalations',
  'list_email_work',
  'list_accounts',
  'search_sources',
  'get_account',
  'get_history',
  'create_account',
  'update_account',
  'match_sightings',
  'measurement_slots',
  'preview_measurement',
  'confirm_measurement',
  'recover_measurement',
  'status',
])
const WRITES = new Set([
  'create_account',
  'update_account',
  'confirm_measurement',
  'recover_measurement',
])

export class CommercialWorkspaceError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

function workspaceSecret(): string | null {
  const secret = process.env.OUTREACH_WORKSPACE_BRIDGE_SECRET
  return secret &&
    secret.length >= 32 &&
    secret.length <= 4096 &&
    secret.trim() === secret &&
    !/[\r\n]/.test(secret)
    ? secret
    : null
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectsSensitiveKeys(value: unknown): boolean {
  const pending: unknown[] = [value]
  while (pending.length) {
    const item = pending.pop()
    if (Array.isArray(item)) {
      for (const child of item) pending.push(child)
    } else if (record(item)) {
      for (const [key, child] of Object.entries(item)) {
        const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
        if (
          /token|secret|password|authorization|apikey|credential/.test(
            normalized,
          )
        )
          return true
        pending.push(child)
      }
    }
  }
  return false
}

function verifyControls(value: unknown) {
  if (!record(value) || !record(value.controls)) return false
  const controls = value.controls
  if (
    Object.keys(controls).length !== 3 ||
    typeof controls.emailSendingDisabled !== 'boolean' ||
    typeof controls.bookingEnabled !== 'boolean'
  )
    return false
  return controls.emailSendingDisabled
    ? controls.mode === 'workspace_and_preview_only'
    : controls.mode === 'controlled_email_pilot' ||
        controls.mode === 'autonomous_email'
}

async function boundedResponse(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > RESPONSE_LIMIT) {
    await response.body?.cancel()
    throw new CommercialWorkspaceError(
      'The commercial workspace response was too large.',
      'RESPONSE_TOO_LARGE',
    )
  }
  if (!response.body)
    throw new CommercialWorkspaceError(
      'The commercial workspace returned an empty response.',
      'INVALID_RESPONSE',
    )
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > RESPONSE_LIMIT) {
        await reader.cancel()
        throw new CommercialWorkspaceError(
          'The commercial workspace response was too large.',
          'RESPONSE_TOO_LARGE',
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Actor comes exclusively from the already verified Sightings OAuth context. */
export async function commercialWorkspaceRequest(
  actor: CommercialWorkspaceActor,
  actionPayload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (
    !record(actionPayload) ||
    typeof actionPayload.action !== 'string' ||
    !ACTIONS.has(actionPayload.action)
  )
    throw new CommercialWorkspaceError(
      'This commercial workspace action is not exposed.',
      'ACTION_NOT_ALLOWED',
    )
  if (
    !actor.scopes.includes('business:read') ||
    (WRITES.has(actionPayload.action) &&
      !actor.scopes.includes('business:write'))
  )
    throw new CommercialWorkspaceError(
      'The current OAuth grant does not include this workspace action.',
      'INSUFFICIENT_SCOPE',
    )
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      actor.subject,
    ) ||
    !/^[a-z0-9._~-]{1,200}$/i.test(actor.clientId)
  )
    throw new CommercialWorkspaceError(
      'Verified Sightings owner and client identity are required.',
      'INVALID_ACTOR',
    )
  const secret = workspaceSecret()
  if (!secret)
    throw new CommercialWorkspaceError(
      'The commercial workspace connection is not configured.',
      'NOT_CONFIGURED',
    )
  let body: string
  try {
    body = JSON.stringify(actionPayload)
  } catch {
    throw new CommercialWorkspaceError(
      'The commercial workspace request must contain JSON data.',
      'INVALID_INPUT',
    )
  }
  if (Buffer.byteLength(body, 'utf8') > REQUEST_LIMIT)
    throw new CommercialWorkspaceError(
      'The commercial workspace request was too large.',
      'REQUEST_TOO_LARGE',
    )
  try {
    const response = await fetch(WORKSPACE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
        'x-sightings-owner': actor.subject,
        'x-sightings-client': actor.clientId,
      },
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new CommercialWorkspaceError(
        response.status === 409
          ? 'The account changed. Read it again before making another update.'
          : response.status === 404
            ? 'The commercial measuring visit request was not found.'
            : 'The commercial workspace could not complete this request.',
        response.status === 409
          ? 'STALE_ACCOUNT'
          : response.status === 404
            ? 'NOT_FOUND'
            : 'UPSTREAM_UNAVAILABLE',
      )
    }
    const result = await boundedResponse(response)
    if (
      !verifyControls(result) ||
      !record(result) ||
      !record(result.result) ||
      rejectsSensitiveKeys(result)
    )
      throw new CommercialWorkspaceError(
        'The commercial workspace response failed its safety checks.',
        'UNSAFE_RESPONSE',
      )
    return result as Record<string, unknown>
  } catch (error) {
    if (error instanceof CommercialWorkspaceError) throw error
    throw new CommercialWorkspaceError(
      'The commercial workspace is unavailable. Read the account before retrying any change.',
      'UPSTREAM_UNAVAILABLE',
    )
  }
}

export async function getCommercialWorkspaceStatus(
  actor: CommercialWorkspaceActor,
): Promise<{
  configured: boolean
  verified: boolean
  allowedCapabilities: string[]
  lastSeen: string | null
  controls: {
    emailSendingDisabled: boolean
    bookingEnabled: boolean
    mode:
      | 'workspace_and_preview_only'
      | 'controlled_email_pilot'
      | 'autonomous_email'
  }
}> {
  const unavailable = {
    configured: Boolean(workspaceSecret()),
    verified: false,
    allowedCapabilities: [] as string[],
    lastSeen: null,
    controls: {
      emailSendingDisabled: true,
      bookingEnabled: false,
      mode: 'workspace_and_preview_only' as const,
    },
  }
  if (!unavailable.configured) return unavailable
  try {
    const response = await commercialWorkspaceRequest(actor, {
      action: 'status',
    })
    const result = response.result
    if (
      !record(result) ||
      result.connection !== 'verified' ||
      !Array.isArray(result.capabilities) ||
      !result.capabilities.length ||
      !result.capabilities.every((item) => typeof item === 'string') ||
      typeof result.lastSeenAt !== 'string' ||
      result.lastSeenAt.length > 64 ||
      !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(result.lastSeenAt) ||
      !Number.isFinite(Date.parse(result.lastSeenAt))
    )
      return unavailable
    return {
      configured: true,
      verified: true,
      allowedCapabilities: Array.isArray(result.capabilities)
        ? [
            ...new Set(
              result.capabilities.filter(
                (item): item is string =>
                  typeof item === 'string' &&
                  ACTIONS.has(item) &&
                  (!WRITES.has(item) ||
                    actor.scopes.includes('business:write')),
              ),
            ),
          ]
        : [],
      lastSeen: result.lastSeenAt,
      controls: response.controls as {
        emailSendingDisabled: boolean
        bookingEnabled: boolean
        mode:
          | 'workspace_and_preview_only'
          | 'controlled_email_pilot'
          | 'autonomous_email'
      },
    }
  } catch {
    return unavailable
  }
}
