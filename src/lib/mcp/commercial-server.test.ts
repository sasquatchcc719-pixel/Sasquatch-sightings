// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  tools: new Map<
    string,
    {
      inputSchema: { parse(input: unknown): unknown }
      annotations: Record<string, unknown>
      handler(
        input: Record<string, unknown>,
        extra: unknown,
      ): Promise<{ structuredContent: Record<string, unknown> }>
    }
  >(),
  request: vi.fn(),
  status: vi.fn(),
}))
vi.mock('@modelcontextprotocol/server', () => ({
  McpServer: class {
    server = { setRequestHandler: vi.fn() }
    registerTool(
      name: string,
      definition: Record<string, unknown>,
      handler: unknown,
    ) {
      mocks.tools.set(name, { ...definition, handler } as never)
    }
  },
}))
vi.mock('./commercial-workspace', () => ({
  commercialWorkspaceRequest: mocks.request,
  getCommercialWorkspaceStatus: mocks.status,
}))
import { createSasquatchMcpServer, MCP_SERVER_INSTRUCTIONS } from './server'
import { MCP_TOOL_NAMES, MCP_SERVER_VERSION } from './release'
import { capabilityCatalogOutputSchema } from './schemas'
const id = '10000000-0000-4000-8000-000000000001'
const controls = {
  mode: 'workspace_and_preview_only',
  emailSendingDisabled: true,
  bookingEnabled: false,
}
const extra = (scopes = ['business:read', 'business:write']) => ({
  http: {
    authInfo: {
      clientId: 'existing-oauth-client',
      scopes,
      extra: { subject: id, displayName: 'Fixture Owner' },
    },
  },
})
const brief = {
  need: '',
  buying_roles: '',
  timing: '',
  access: '',
  service_scope: '',
  evidence: '',
  unknowns: '',
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.tools.clear()
  mocks.request.mockResolvedValue({ controls, result: { account: { id } } })
  mocks.status.mockResolvedValue({
    configured: false,
    verified: false,
    allowedCapabilities: [],
    lastSeen: null,
  })
  createSasquatchMcpServer()
})
const call = (
  name: string,
  input: Record<string, unknown>,
  context: unknown = extra(),
) => mocks.tools.get(name)!.handler(input, context)
describe('commercial MCP workspace registration', () => {
  it('appends exactly ten workspace/preview tools while preserving the prior catalog', () => {
    expect(MCP_SERVER_VERSION).toBe('1.8.1')
    expect([...mocks.tools.keys()]).toEqual([...MCP_TOOL_NAMES])
    expect(mocks.tools.size).toBe(50)
    const commercial = [...mocks.tools.keys()].filter((name) =>
      name.includes('commercial'),
    )
    expect(commercial).toHaveLength(10)
    expect(
      commercial.some((name) =>
        /send|confirm|recover|book/.test(name.replace('playbook', '')),
      ),
    ).toBe(false)
    expect(
      mocks.tools.get('create_commercial_account')!.annotations.readOnlyHint,
    ).toBe(false)
    expect(
      mocks.tools.get('preview_commercial_measurement')!.annotations
        .readOnlyHint,
    ).toBe(true)
    expect(MCP_SERVER_INSTRUCTIONS).toContain(
      'retired SMS Harry engine stays retired',
    )
    expect(MCP_SERVER_INSTRUCTIONS).toContain('never use ordinary appointment')
  })
  it.each([
    ['get_commercial_playbook', 'get_playbook', {}],
    ['list_commercial_accounts', 'list_accounts', { filter: 'due' }],
    [
      'search_commercial_prospects',
      'search_sources',
      { source: 'lead', field: 'name', q: 'Fixture' },
    ],
    ['get_commercial_account', 'get_account', { account_id: id }],
    [
      'get_commercial_account_history',
      'get_history',
      { account_id: id, limit: 10 },
    ],
    [
      'create_commercial_account',
      'create_account',
      { source: 'lead', source_id: id, request_id: id },
    ],
    [
      'update_commercial_account',
      'update_account',
      {
        account_id: id,
        request_id: id,
        version: 1,
        stage: 'researched',
        assigned_to: 'Harry',
        next_action: '',
        next_action_at: null,
        brief,
      },
    ],
    ['match_commercial_customer', 'match_sightings', { account_id: id }],
    [
      'get_commercial_measurement_slots',
      'measurement_slots',
      {
        account_id: id,
        appointment_date: '2026-11-02',
        visit_duration_minutes: 60,
      },
    ],
    [
      'preview_commercial_measurement',
      'preview_measurement',
      {
        account_id: id,
        account_version: 1,
        request: {
          identity: {
            mode: 'existing',
            customer_id: id,
            service_address_id: id,
          },
          appointment_date: '2026-11-02',
          start_time: '09:00',
          assigned_staff_user_id: id,
          visit_duration_minutes: 60,
          job_description: 'Measure the fixture office',
        },
      },
    ],
  ])(
    'routes %s only through the fixed action and verified OAuth actor',
    async (name, action, input) => {
      const result = await call(
        name as string,
        input as Record<string, unknown>,
      )
      expect(mocks.request).toHaveBeenCalledWith(
        {
          subject: id,
          label: 'Fixture Owner',
          scopes: ['business:read', 'business:write'],
          clientId: 'existing-oauth-client',
        },
        expect.objectContaining({ action, ...input }),
      )
      expect(result.structuredContent).toEqual({
        result: { account: { id } },
        controls,
      })
    },
  )
  it('requires business:write for both account mutations without upgrading any grants', async () => {
    await expect(
      call(
        'create_commercial_account',
        { source: 'lead', source_id: id, request_id: id },
        extra(['business:read']),
      ),
    ).rejects.toThrow('business:write')
    await expect(
      call('update_commercial_account', {}, extra(['business:read'])),
    ).rejects.toThrow('business:write')
    expect(mocks.request).not.toHaveBeenCalled()
    await call('get_commercial_playbook', {}, extra(['business:read']))
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })
  it('requires authenticated business access before crossing the bridge', async () => {
    await expect(call('get_commercial_playbook', {}, {})).rejects.toThrow(
      'OAuth',
    )
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it.each([
    ['search_commercial_prospects', { source: 'lead', field: 'name', q: 'x' }],
    [
      'get_commercial_account_history',
      { account_id: id, before: '2026-11-01T00:00:00Z' },
    ],
    ['get_commercial_account_history', { account_id: id, limit: 21 }],
    [
      'get_commercial_measurement_slots',
      {
        account_id: id,
        appointment_date: '2026-02-30',
        visit_duration_minutes: 60,
      },
    ],
    [
      'get_commercial_measurement_slots',
      {
        account_id: id,
        appointment_date: '2026-11-01',
        visit_duration_minutes: 181,
      },
    ],
    ['get_commercial_account', { account_id: id, actor: 'forged-owner' }],
    [
      'create_commercial_account',
      { source: 'lead', source_id: id, request_id: 'not-a-uuid' },
    ],
    [
      'update_commercial_account',
      {
        account_id: id,
        request_id: id,
        version: 1,
        stage: 'won',
        assigned_to: 'Harry',
        next_action: '',
        next_action_at: null,
        brief,
      },
    ],
  ])(
    'rejects invalid or overbroad %s input before any upstream call',
    async (name, input) => {
      await expect(
        call(name as string, input as Record<string, unknown>),
      ).rejects.toThrow()
      expect(mocks.request).not.toHaveBeenCalled()
    },
  )
  it('refuses an upstream response claiming sending or booking is enabled', async () => {
    mocks.request.mockResolvedValue({
      controls: { ...controls, bookingEnabled: true },
    })
    await expect(call('get_commercial_playbook', {})).rejects.toThrow()
  })
  it('keeps old tools discoverable and capability catalog usable when upstream is unavailable', async () => {
    mocks.request.mockRejectedValue(
      new Error('Commercial workspace unavailable'),
    )
    await expect(
      call('get_commercial_account', { account_id: id }),
    ).rejects.toThrow('unavailable')
    const result = await call('get_capability_catalog', {})
    const catalog = capabilityCatalogOutputSchema.parse(
      result.structuredContent,
    )
    expect(catalog.commercial_workspace).toMatchObject({
      configured: false,
      verified: false,
      controls,
    })
    expect(
      catalog.capabilities.find(
        (capability) => capability.area === 'commercial_account_workspace',
      )?.access,
    ).toBe('partial')
    expect(mocks.tools.has('get_appointment')).toBe(true)
  })
})
