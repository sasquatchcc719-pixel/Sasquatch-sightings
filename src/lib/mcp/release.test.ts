// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, connection: vi.fn().mockResolvedValue(undefined) }
})

import { GET as getAbout } from '@/app/mcp/about/route'
import { getCapabilityCatalog } from './operations'
import { MCP_SERVER_NAME, MCP_SERVER_VERSION, MCP_TOOL_NAMES } from './release'
import { createSasquatchMcpServer } from './server'

const openConnections: Array<{ close(): Promise<void> }> = []

afterEach(async () => {
  await Promise.all(
    openConnections.splice(0).map((connection) => connection.close()),
  )
})

describe('MCP release identity', () => {
  it('keeps initialization, discovery, catalog, and about on one release', async () => {
    const server = createSasquatchMcpServer()
    const client = new Client({ name: 'release-fixture', version: '1.0.0' })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    openConnections.push(client, server)
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const discovered = await client.listTools()
    const catalog = getCapabilityCatalog()
    const aboutResponse = await getAbout()
    const about = await aboutResponse.json()

    expect(client.getServerVersion()).toEqual({
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    })
    expect(discovered.tools.map((tool) => tool.name)).toEqual([
      ...MCP_TOOL_NAMES,
    ])
    expect(discovered.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['list_conversations', 'get_conversation']),
    )
    expect(catalog.server).toEqual({
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    })
    expect(about.server).toEqual({
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      tool_count: MCP_TOOL_NAMES.length,
      tools: [...MCP_TOOL_NAMES],
    })
    expect(aboutResponse.headers.get('cache-control')).toBe('no-store')
  })
})
