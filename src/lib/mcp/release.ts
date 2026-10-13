import manifest from './release-manifest.json'

export const MCP_SERVER_NAME = manifest.name
export const MCP_SERVER_VERSION = manifest.version
export const MCP_TOOL_NAMES = manifest.tools as readonly string[]

export function assertMcpToolCatalog(actualNames: readonly string[]) {
  const expected = [...MCP_TOOL_NAMES]
  const actual = [...actualNames]
  if (
    actual.length !== new Set(actual).size ||
    expected.length !== actual.length ||
    expected.some((name, index) => name !== actual[index])
  ) {
    throw new Error(
      `MCP ${MCP_SERVER_VERSION} tool catalog mismatch: expected ${expected.join(', ')}, received ${actual.join(', ')}`,
    )
  }
}

export function getMcpReleaseManifest() {
  return {
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
    tool_count: MCP_TOOL_NAMES.length,
    tools: [...MCP_TOOL_NAMES],
  }
}
