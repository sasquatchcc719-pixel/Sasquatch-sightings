import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readCellularUsage } from './hologram-usage'

const originalKey = process.env.HOLOGRAM_API_KEY
const originalDeviceId = process.env.HOLOGRAM_DEVICE_ID
const originalOrgId = process.env.HOLOGRAM_ORG_ID

beforeEach(() => {
  process.env.HOLOGRAM_API_KEY = 'test-key'
  process.env.HOLOGRAM_DEVICE_ID = '6874649'
  process.env.HOLOGRAM_ORG_ID = '112601'
})

afterEach(() => {
  vi.restoreAllMocks()
  process.env.HOLOGRAM_API_KEY = originalKey
  process.env.HOLOGRAM_DEVICE_ID = originalDeviceId
  process.env.HOLOGRAM_ORG_ID = originalOrgId
})

it('returns carrier-billed usage against the configured data limit', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              id: 5856987,
              simcardid: 6874649,
              intended_plan_data: 0,
              links: {
                cellular: [{ overagelimit: 1_000_000_000, state: 'active' }],
              },
            },
          ],
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              periods_back: '0',
              bytes: 100_030_000,
              cur_period_end: '2026-12-07T00:00:00Z',
            },
          ],
        }),
      ),
    )

  await expect(readCellularUsage()).resolves.toMatchObject({
    deviceId: '6874649',
    simCardId: '6874649',
    usedBytes: 100_030_000,
    limitBytes: 1_000_000_000,
    remainingBytes: 899_970_000,
    percentUsed: 10.003,
    billingPeriodEnd: '2026-12-07T00:00:00Z',
    status: 'active',
  })
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    'https://dashboard.hologram.io/api/1/devices?orgid=112601&limit=100&withlocation=false',
    expect.objectContaining({ cache: 'no-store' }),
  )
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    'https://dashboard.hologram.io/api/1/usage/data/billing?deviceids=5856987&maxperiodsback=1&limit=10',
    expect.objectContaining({ cache: 'no-store' }),
  )
  expect(
    (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)
      .Authorization,
  ).toBe(`Basic ${Buffer.from('apikey:test-key').toString('base64')}`)
})

it('fails closed when the server-only credential is missing', async () => {
  delete process.env.HOLOGRAM_API_KEY
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  await expect(readCellularUsage()).rejects.toThrow(
    'Hologram usage is not configured',
  )
  expect(fetchMock).not.toHaveBeenCalled()
})
