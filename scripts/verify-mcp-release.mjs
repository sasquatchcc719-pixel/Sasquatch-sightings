import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(
  await readFile(
    new URL('../src/lib/mcp/release-manifest.json', import.meta.url),
    'utf8',
  ),
)
const target = process.argv.slice(2).find((argument) => argument !== '--')
const origin = (target ?? 'https://sightings.sasquatchcarpet.com').replace(
  /\/$/,
  '',
)
const url = `${origin}/mcp/about`
const response = await fetch(url, { redirect: 'error' })

if (!response.ok) {
  throw new Error(`${url} returned HTTP ${response.status}`)
}

const body = await response.json()
const actual = body?.server
if (!actual) {
  throw new Error(`${url} does not publish a server release manifest`)
}

const catalogMatches =
  actual.tool_count === manifest.tools.length &&
  Array.isArray(actual.tools) &&
  actual.tools.length === manifest.tools.length &&
  manifest.tools.every((name, index) => actual.tools[index] === name)

if (
  actual.name !== manifest.name ||
  actual.version !== manifest.version ||
  !catalogMatches
) {
  throw new Error(
    `${url} release mismatch: expected ${manifest.name}@${manifest.version} with ${manifest.tools.length} tools, received ${actual.name ?? 'missing'}@${actual.version ?? 'missing'} with ${Array.isArray(actual.tools) ? actual.tools.length : 'missing'} tools`,
  )
}

console.log(
  `Verified ${actual.name}@${actual.version}: ${actual.tool_count} tools at ${url}`,
)
