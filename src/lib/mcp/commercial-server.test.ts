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
  executePreparedAction: vi.fn(),
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
vi.mock('./business-operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./business-operations')>()),
  executePreparedAction: mocks.executePreparedAction,
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
  mocks.executePreparedAction.mockRejectedValue(
    new Error('Confirmation not found'),
  )
  mocks.status.mockResolvedValue({
    configured: false,
    verified: false,
    allowedCapabilities: [],
    lastSeen: null,
    controls,
  })
  createSasquatchMcpServer()
})
const call = (
  name: string,
  input: Record<string, unknown>,
  context: unknown = extra(),
) => mocks.tools.get(name)!.handler(input, context)
describe('commercial MCP workspace registration', () => {
  it('appends the commercial workspace, email queue and preview tools while preserving the prior catalog', () => {
    expect(MCP_SERVER_VERSION).toBe('1.10.3')
    expect([...mocks.tools.keys()]).toEqual([...MCP_TOOL_NAMES])
    expect(mocks.tools.size).toBe(56)
    const commercial = [...mocks.tools.keys()].filter((name) =>
      name.includes('commercial'),
    )
    expect(commercial).toHaveLength(16)
    expect(
      commercial.some((name) =>
        /send|confirm|recover|book/.test(name.replace('playbook', '')),
      ),
    ).toBe(true)
    expect(
      mocks.tools.get('create_commercial_account')!.annotations.readOnlyHint,
    ).toBe(false)
    expect(
      mocks.tools.get('preview_commercial_measurement')!.annotations
        .readOnlyHint,
    ).toBe(false)
    expect(
      mocks.tools.get('confirm_commercial_measurement')!.annotations
        .readOnlyHint,
    ).toBe(false)
    expect(MCP_SERVER_INSTRUCTIONS).toContain(
      'retired SMS Harry engine stays retired',
    )
    expect(MCP_SERVER_INSTRUCTIONS).toContain(
      'Never use preview_appointment_create',
    )
  })
  it.each([
    ['get_commercial_playbook', 'get_playbook', {}],
    ['get_commercial_email_agent_status', 'email_agent_status', {}],
    ['get_commercial_workday_status', 'workday_status', {}],
    ['list_commercial_escalations', 'list_escalations', { limit: 10 }],
    [
      'list_commercial_email_work',
      'list_email_work',
      { filter: 'reactivation', limit: 10 },
    ],
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
    [
      'confirm_commercial_measurement',
      'confirm_measurement',
      { account_id: id, operation_id: id, confirmed: true },
    ],
    [
      'recover_commercial_measurement',
      'recover_measurement',
      { account_id: id, operation_id: id },
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
  it('requires business:write for account and measuring mutations without upgrading grants', async () => {
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
    await expect(
      call(
        'confirm_commercial_measurement',
        { account_id: id, operation_id: id, confirmed: true },
        extra(['business:read']),
      ),
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
  it('routes a durable commercial operation through the existing executor when client metadata is stale', async () => {
    mocks.request.mockResolvedValue({
      controls: { ...controls, bookingEnabled: true },
      result: { operation: { id, state: 'confirmed' } },
    })

    const result = await call('execute_appointment_create', {
      confirmation_id: id,
      confirmed: true,
    })

    expect(mocks.request).toHaveBeenCalledWith(
      {
        subject: id,
        label: 'Fixture Owner',
        scopes: ['business:read', 'business:write'],
        clientId: 'existing-oauth-client',
      },
      { action: 'confirm_measurement', operation_id: id, confirmed: true },
    )
    expect(result.structuredContent).toEqual({
      result: {
        workflow: 'commercial_measurement',
        controls: { ...controls, bookingEnabled: true },
        operation: { id, state: 'confirmed' },
      },
    })
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
  it('accepts the verified live booking control', async () => {
    mocks.request.mockResolvedValue({
      result: {},
      controls: { ...controls, bookingEnabled: true },
    })
    await expect(call('get_commercial_playbook', {})).resolves.toBeDefined()
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
