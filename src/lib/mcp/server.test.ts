// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { getCapabilityCatalog } from './operations'
import { createSasquatchMcpServer } from './server'

const expectedTools = [
  'list_appointments',
  'get_appointment',
  'list_estimates',
  'get_estimate',
  'search_customers',
  'get_availability',
  'list_calls',
  'get_capability_catalog',
  'get_business_configuration',
  'search_business_records',
  'get_operational_summary',
]

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
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      })
      expect(tool._meta?.securitySchemes).toEqual([
        { type: 'oauth2', scopes: ['openid', 'email'] },
      ])
    }
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
      server: { name: 'sasquatch-sightings-read', version: '1.1.0' },
    })
    expect(JSON.stringify(result)).toContain('customer contact or campaigns')
  })
})
