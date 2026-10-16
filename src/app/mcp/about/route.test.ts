// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, connection: vi.fn().mockResolvedValue(undefined) }
})

import { GET } from './route'
import {
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  MCP_TOOL_NAMES,
} from '@/lib/mcp/release'

describe('GET /mcp/about', () => {
  it('publishes the exact uncached release identity and tool catalog', async () => {
    const response = await GET()
    const body = await response.json()

    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body.server).toEqual({
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      tool_count: MCP_TOOL_NAMES.length,
      tools: [...MCP_TOOL_NAMES],
    })
    expect(body.server.tools).toContain('list_conversations')
    expect(body.server.tools).toContain('get_conversation')
    expect(body.access).toContain('direct owner instruction counts')
    expect(body.limitations).toContain(
      'Routine factual replies and exact customer-accepted scheduling may proceed under the standing secretary policy; new or materially changed commitments require one owner confirmation.',
    )
  })
})
