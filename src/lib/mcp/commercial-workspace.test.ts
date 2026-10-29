// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commercialWorkspaceRequest,
  getCommercialWorkspaceStatus,
  type CommercialWorkspaceActor,
} from './commercial-workspace'

const actor: CommercialWorkspaceActor = {
  subject: '10000000-0000-4000-8000-000000000001',
  label: 'Fixture Owner',
  clientId: '10000000-0000-4000-8000-000000000002',
  scopes: ['business:read', 'business:write'],
}
const controls = {
  emailSendingDisabled: true,
  bookingEnabled: false,
  mode: 'workspace_and_preview_only',
}
const secret = 'private-fixture-only-bridge-key-1234567890'
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubEnv('OUTREACH_WORKSPACE_BRIDGE_SECRET', secret)
  fetchMock = vi
    .fn()
    .mockImplementation(async () =>
      Response.json({ result: { data: [] }, controls }),
    )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fixed commercial workspace adapter', () => {
  it('uses one fixed authenticated backend, trusted OAuth actor headers, no cache, no redirects and a bounded timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const payload = {
      action: 'get_account',
      account_id: 'fixture-account',
      owner: 'forged-body-owner',
    }
    expect(await commercialWorkspaceRequest(actor, payload)).toEqual({
      result: { data: [] },
      controls,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sasquatch-outreach.vercel.app/api/integrations/harry/workspace',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
        cache: 'no-store',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret}`,
          'x-sightings-owner': actor.subject,
          'x-sightings-client': actor.clientId,
        },
      }),
    )
    expect(timeout).toHaveBeenCalledWith(25_000)
  })

  it.each([
    'get_playbook',
    'email_agent_status',
    'list_email_work',
    'list_accounts',
    'search_sources',
    'get_account',
    'get_history',
    'match_sightings',
    'measurement_slots',
    'preview_measurement',
    'status',
  ])(
    'allows the bounded read or preview action %s with business:read',
    async (action) => {
      await commercialWorkspaceRequest(
        { ...actor, scopes: ['business:read'] },
        { action },
      )
      expect(fetchMock).toHaveBeenCalledOnce()
    },
  )

  it.each(['create_account', 'update_account'])(
    'requires business:write for %s',
    async (action) => {
      await expect(
        commercialWorkspaceRequest(
          { ...actor, scopes: ['business:read'] },
          { action },
        ),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_SCOPE' })
      expect(fetchMock).not.toHaveBeenCalled()
      await commercialWorkspaceRequest(actor, { action })
      expect(fetchMock).toHaveBeenCalledOnce()
    },
  )

  it('requires business:read even when business:write was claimed', async () => {
    await expect(
      commercialWorkspaceRequest(
        { ...actor, scopes: ['business:write'] },
        { action: 'update_account' },
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SCOPE' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    'confirm',
    'recover',
    'send',
    'send_email',
    'execute_appointment_create',
    'https://evil.example',
    'unknown',
  ])(
    'rejects consequential or unknown %s before any request, regardless of flags',
    async (action) => {
      vi.stubEnv('OUTREACH_MEASUREMENT_WRITES_ENABLED', 'true')
      vi.stubEnv('EMAIL_SENDING_DISABLED', 'false')
      await expect(
        commercialWorkspaceRequest(actor, { action }),
      ).rejects.toMatchObject({ code: 'ACTION_NOT_ALLOWED' })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it.each(['', 'too-short', `${secret}\n`])(
    'fails closed for missing or malformed configuration',
    async (value) => {
      vi.stubEnv('OUTREACH_WORKSPACE_BRIDGE_SECRET', value)
      await expect(
        commercialWorkspaceRequest(actor, { action: 'status' }),
      ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it.each([
    { subject: 'forged\nowner' },
    { clientId: 'forged\nclient' },
    { clientId: '' },
  ])('rejects malformed OAuth identity before fetch: %j', async (patch) => {
    await expect(
      commercialWorkspaceRequest({ ...actor, ...patch }, { action: 'status' }),
    ).rejects.toMatchObject({ code: 'INVALID_ACTOR' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('bounds UTF-8 request bytes before sending', async () => {
    await expect(
      commercialWorkspaceRequest(actor, {
        action: 'update_account',
        note: '界'.repeat(12_000),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    {},
    { controls: { ...controls, emailSendingDisabled: false } },
    { controls: { ...controls, bookingEnabled: true } },
    { controls: { ...controls, mode: 'enabled' } },
    { controls: { ...controls, sendEnabled: true } },
    {
      controls,
      result: { data: [{ nested: { preview_token: 'hidden-proof' } }] },
    },
    { controls, result: { data: { refreshToken: 'hidden-proof' } } },
    { controls, result: { data: { 'bridge-secret': 'hidden-proof' } } },
    { controls, result: { data: { Authorization: 'hidden-proof' } } },
    { controls, result: { data: { apiKey: 'hidden-proof' } } },
  ])(
    'rejects unsafe controls or sensitive keys recursively: %j',
    async (body) => {
      fetchMock.mockResolvedValue(Response.json(body))
      await expect(
        commercialWorkspaceRequest(actor, { action: 'get_account' }),
      ).rejects.toMatchObject({ code: 'UNSAFE_RESPONSE' })
    },
  )

  it('rejects a declared oversized response before reading its body', async () => {
    fetchMock.mockResolvedValue(
      new Response('not-read', {
        headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) },
      }),
    )
    await expect(
      commercialWorkspaceRequest(actor, { action: 'get_history' }),
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  })

  it('bounds streamed response bytes even without Content-Length', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024))
        controller.enqueue(new Uint8Array(1))
      },
      cancel,
    })
    fetchMock.mockResolvedValue(new Response(stream))
    await expect(
      commercialWorkspaceRequest(actor, { action: 'get_history' }),
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it.each([401, 403, 500])(
    'does not disclose upstream error bodies for HTTP %s',
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json({ error: `private contact data ${secret}` }, { status }),
      )
      await expect(
        commercialWorkspaceRequest(actor, { action: 'get_account' }),
      ).rejects.toMatchObject({
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'The commercial workspace could not complete this request.',
      })
    },
  )

  it('reports stale account conflicts without leaking response text', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: secret }, { status: 409 }),
    )
    await expect(
      commercialWorkspaceRequest(actor, { action: 'update_account' }),
    ).rejects.toMatchObject({ code: 'STALE_ACCOUNT' })
  })

  it.each(['timeout', 'invalid-json', 'redirect'])(
    'sanitizes %s failures',
    async (kind) => {
      if (kind === 'invalid-json')
        fetchMock.mockResolvedValue(new Response(secret))
      else fetchMock.mockRejectedValue(new Error(secret))
      await expect(
        commercialWorkspaceRequest(actor, { action: 'status' }),
      ).rejects.toMatchObject({
        code: 'UPSTREAM_UNAVAILABLE',
        message:
          'The commercial workspace is unavailable. Read the account before retrying any change.',
      })
    },
  )
})

describe('commercial workspace capability status', () => {
  it('reports an unconfigured bridge without fetching', async () => {
    vi.stubEnv('OUTREACH_WORKSPACE_BRIDGE_SECRET', '')
    expect(await getCommercialWorkspaceStatus(actor)).toEqual({
      configured: false,
      verified: false,
      allowedCapabilities: [],
      lastSeen: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('reports configured but unverified when remote safety checks fail', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ controls: { ...controls, bookingEnabled: true } }),
    )
    expect(await getCommercialWorkspaceStatus(actor)).toEqual({
      configured: true,
      verified: false,
      allowedCapabilities: [],
      lastSeen: null,
    })
  })
  it('maps the exact verified upstream wrapper while filtering unavailable actions', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        controls,
        result: {
          connection: 'verified',
          capabilities: [
            'get_account',
            'email_agent_status',
            'get_account',
            'confirm',
            'send_email',
            'update_account',
          ],
          lastSeenAt: '2026-10-28T22:00:00.000Z',
        },
      }),
    )
    const status = await getCommercialWorkspaceStatus(actor)
    expect(status).toEqual({
      configured: true,
      verified: true,
      allowedCapabilities: [
        'get_account',
        'email_agent_status',
        'update_account',
      ],
      lastSeen: '2026-10-28T22:00:00.000Z',
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: 'status',
    })
  })
  it.each([
    {
      connection: 'pending',
      capabilities: ['get_account'],
      lastSeenAt: '2026-10-28T22:00:00Z',
    },
    {
      connection: 'verified',
      capabilities: [],
      lastSeenAt: '2026-10-28T22:00:00Z',
    },
    {
      connection: 'verified',
      capabilities: [123],
      lastSeenAt: '2026-10-28T22:00:00Z',
    },
    {
      connection: 'verified',
      capabilities: ['get_account'],
      lastSeenAt: 'not-a-date',
    },
    { connection: 'verified', capabilities: ['get_account'] },
  ])(
    'does not mark incomplete or unverified status as connected: %j',
    async (result) => {
      fetchMock.mockResolvedValue(Response.json({ controls, result }))
      expect(await getCommercialWorkspaceStatus(actor)).toEqual({
        configured: true,
        verified: false,
        allowedCapabilities: [],
        lastSeen: null,
      })
    },
  )
  it('does not treat a top-level status object as the verified backend wrapper', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        controls,
        connection: 'verified',
        capabilities: ['get_account'],
        lastSeenAt: '2026-10-28T22:00:00Z',
      }),
    )
    expect((await getCommercialWorkspaceStatus(actor)).verified).toBe(false)
  })
  it('omits workspace writes when the current token lacks business:write', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        controls,
        result: {
          connection: 'verified',
          capabilities: ['get_account', 'update_account'],
          lastSeenAt: '2026-10-28T22:00:00Z',
        },
      }),
    )
    expect(
      (
        await getCommercialWorkspaceStatus({
          ...actor,
          scopes: ['business:read'],
        })
      ).allowedCapabilities,
    ).toEqual(['get_account'])
  })
})
