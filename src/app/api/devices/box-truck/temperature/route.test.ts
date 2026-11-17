import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  credentialEq: vi.fn(),
  credentialMaybeSingle: vi.fn(),
  trackerEq: vi.fn(),
  trackerMaybeSingle: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}))
import { GET } from './route'

const token = 'c'.repeat(64)
const request = (
  authorization: string | null = `Bearer ${token}`,
  query = '',
) =>
  new Request(
    `https://example.test/api/devices/box-truck/temperature${query}`,
    {
      headers: authorization ? { Authorization: authorization } : {},
    },
  )

describe('box truck display temperature', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    const credentialQuery = {
      eq: mocks.credentialEq,
      maybeSingle: mocks.credentialMaybeSingle,
    }
    const trackerQuery = {
      eq: mocks.trackerEq,
      maybeSingle: mocks.trackerMaybeSingle,
    }
    mocks.credentialEq.mockReturnValue(credentialQuery)
    mocks.trackerEq.mockReturnValue(trackerQuery)
    mocks.from.mockImplementation((table: string) => ({
      select: () =>
        table === 'fleet_temperature_display_tokens'
          ? credentialQuery
          : trackerQuery,
    }))
    mocks.credentialMaybeSingle.mockResolvedValue({
      data: { id: 'display' },
      error: null,
    })
    mocks.trackerMaybeSingle.mockResolvedValue({
      data: {
        id: 'truck',
        probe_temperature_c: 10,
        probe_received_at: new Date().toISOString(),
        temperature_low_f: 35,
        temperature_high_f: 90,
      },
      error: null,
    })
    mocks.rpc.mockResolvedValue({ data: [], error: null })
  })

  it('requires a display credential before reading the tracker', async () => {
    expect((await GET(request(null))).status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('returns only the current box-truck temperature state', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(mocks.credentialEq).toHaveBeenCalledWith(
      'token_hash',
      createHash('sha256').update(token).digest('hex'),
    )
    expect(await response.json()).toMatchObject({
      vehicle: "David's Box Truck",
      temperatureF: 50,
      lowF: 35,
      highF: 90,
      fresh: true,
      alarm: null,
      history: [],
    })
  })

  it('returns the requested recorded temperature history', async () => {
    const history = [
      {
        minute_at: '2026-11-17T18:00:00Z',
        temperature_f: 48,
        low_f: 46,
        high_f: 50,
      },
    ]
    mocks.rpc.mockResolvedValue({ data: history, error: null })

    const response = await GET(request(undefined, '?days=7'))

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith(
      'fleet_temperature_history_summary',
      { p_tracker_id: 'truck', p_days: 7 },
    )
    expect((await response.json()).history).toEqual(history)
  })

  it('rejects unsupported history ranges', async () => {
    expect((await GET(request(undefined, '?days=365'))).status).toBe(400)
    expect(mocks.trackerMaybeSingle).not.toHaveBeenCalled()
  })

  it('rejects a revoked credential', async () => {
    mocks.credentialMaybeSingle.mockResolvedValue({ data: null, error: null })
    expect((await GET(request())).status).toBe(401)
    expect(mocks.trackerMaybeSingle).not.toHaveBeenCalled()
  })

  it('does not expose database failures', async () => {
    mocks.trackerMaybeSingle.mockResolvedValue({
      data: null,
      error: { code: 'unavailable' },
    })
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Temperature unavailable' })
  })
})
