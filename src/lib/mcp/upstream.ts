import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'

const API_BASE = 'https://sightings.sasquatchcarpet.com/api/v1/'

export class UpstreamApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function getApiV1(
  path: string,
  searchParams: URLSearchParams,
  authInfo: AuthInfo,
): Promise<Record<string, unknown>> {
  const url = new URL(path.replace(/^\//, ''), API_BASE)
  url.search = searchParams.toString()

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${authInfo.token}`,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new UpstreamApiError('The Sightings API returned invalid JSON', 502)
  }

  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : `The Sightings API returned HTTP ${response.status}`
    throw new UpstreamApiError(message, response.status)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new UpstreamApiError('The Sightings API returned invalid JSON', 502)
  }

  return body as Record<string, unknown>
}
