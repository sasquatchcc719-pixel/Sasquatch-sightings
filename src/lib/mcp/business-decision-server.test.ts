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
  load: vi.fn(),
  client: vi.fn(() => ({ fixture: true })),
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
vi.mock('@/lib/ops/business-decisions', () => ({
  loadBusinessDecisionSnapshot: mocks.load,
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: mocks.client,
  createClient: vi.fn(),
}))
import { createSasquatchMcpServer } from './server'
const context = (scopes = ['business:read'], expiresAt?: number) => ({
  http: {
    authInfo: {
      scopes,
      expiresAt,
      clientId: 'fixture',
      extra: { subject: 'owner' },
    },
  },
})
const snapshotTool = () => mocks.tools.get('get_business_decision_snapshot')!
beforeEach(() => {
  vi.clearAllMocks()
  mocks.tools.clear()
  createSasquatchMcpServer()
})
describe('business decision MCP tool', () => {
  it('registers a strict no-input, read-only tool', () => {
    const tool = snapshotTool()
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(tool.inputSchema.parse({})).toEqual({})
    expect(() => tool.inputSchema.parse({ refresh: true })).toThrow()
  })
  it.each([{}, context([]), context(['business:read'], 1)])(
    'rejects missing, insufficient and expired authorization before any data read',
    async (extra) => {
      await expect(snapshotTool().handler({}, extra)).rejects.toThrow(
        'OAuth authorization is required',
      )
      expect(mocks.client).not.toHaveBeenCalled()
      expect(mocks.load).not.toHaveBeenCalled()
    },
  )
  it('uses existing business read authorization and returns the shared snapshot', async () => {
    const result = {
      version: '1',
      read_only: true,
      coverage: { status: 'partial' },
    }
    mocks.load.mockResolvedValueOnce(result)
    const response = await snapshotTool().handler({}, context())
    expect(mocks.client).toHaveBeenCalledOnce()
    expect(mocks.load).toHaveBeenCalledWith({ fixture: true })
    expect(response.structuredContent).toEqual(result)
  })
})
