// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { getCapabilityCatalog } from './operations'
import { MCP_SERVER_NAME, MCP_SERVER_VERSION, MCP_TOOL_NAMES } from './release'
import { createSasquatchMcpServer } from './server'

const expectedTools = [...MCP_TOOL_NAMES]

const originalReadTools = expectedTools.slice(0, 11)

const openConnections: Array<{ close(): Promise<void> }> = []

afterEach(async () => {
  await Promise.all(
    openConnections.splice(0).map((connection) => connection.close()),
  )
})

async function connectedClient() {
  const server = createSasquatchMcpServer()
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  openConnections.push(client, server)
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

describe('Sasquatch read-only MCP server', () => {
  it('initializes and discovers the backward-compatible and operations read-only tools', async () => {
    const client = await connectedClient()
    const { tools } = await client.listTools()

    expect(tools.map((tool) => tool.name)).toEqual(expectedTools)
    for (const tool of tools) {
      expect(tool.description).toBeTruthy()
      expect(tool.outputSchema).toMatchObject({ type: 'object' })
      expect(tool._meta?.securitySchemes).toEqual([
        { type: 'oauth2', scopes: ['openid', 'email'] },
      ])
    }
    for (const name of originalReadTools) {
      expect(
        tools.find((tool) => tool.name === name)?.annotations,
      ).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      })
    }
    expect(
      tools.find((tool) => tool.name === 'execute_customer_message')
        ?.annotations,
    ).toMatchObject({ readOnlyHint: false, openWorldHint: true })
    expect(
      tools.find((tool) => tool.name === 'execute_appointment_update')
        ?.annotations,
    ).toMatchObject({ readOnlyHint: false, destructiveHint: true })
  })

  it('rejects list_appointments without a date or complete range', async () => {
    const client = await connectedClient()
    const result = await client.callTool({
      name: 'list_appointments',
      arguments: {},
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain(
      'Provide date, or provide both start and end',
    )
  })

  it('rejects broad or empty business searches', async () => {
    const client = await connectedClient()
    const result = await client.callTool({
      name: 'search_business_records',
      arguments: { query: '' },
    })

    expect(result.isError).toBe(true)
  })

  it('builds the read-only capability catalog without database access', () => {
    const result = getCapabilityCatalog()

    expect(result).toMatchObject({
      server: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    })
    expect(JSON.stringify(result)).toContain('customer contact or campaigns')
  })
})
