// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendOneSignalToExternalIds } from './onesignal'

const originalAppId = process.env.ONESIGNAL_APP_ID
const originalApiKey = process.env.ONESIGNAL_API_KEY

afterEach(() => {
  if (originalAppId === undefined) delete process.env.ONESIGNAL_APP_ID
  else process.env.ONESIGNAL_APP_ID = originalAppId
  if (originalApiKey === undefined) delete process.env.ONESIGNAL_API_KEY
  else process.env.ONESIGNAL_API_KEY = originalApiKey
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('OneSignal transactional push', () => {
  it('targets only the requested external IDs', async () => {
    process.env.ONESIGNAL_APP_ID = 'app-id'
    process.env.ONESIGNAL_API_KEY = 'api-key'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'notification-id' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(
      sendOneSignalToExternalIds({
        externalIds: ['david-user-id', 'david-user-id', ''],
        heading: 'Square payment received',
        content: '$325.00 from Tamara · Invoice #18209',
        data: { type: 'square_payment_received' },
        idempotencyKey: '2b84387a-2158-4fe2-9cba-36b528f297a4',
        url: 'https://sightings.sasquatchcarpet.com/tech',
      }),
    ).resolves.toEqual({ id: 'notification-id' })

    const request = fetchMock.mock.calls[0][1]
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.onesignal.com/notifications',
    )
    expect(request.headers.Authorization).toBe('Key api-key')
    const body = JSON.parse(String(request.body))
    expect(body).toMatchObject({
      app_id: 'app-id',
      include_aliases: { external_id: ['david-user-id'] },
      target_channel: 'push',
      idempotency_key: '2b84387a-2158-4fe2-9cba-36b528f297a4',
      url: 'https://sightings.sasquatchcarpet.com/tech',
    })
    expect(body).not.toHaveProperty('included_segments')
  })
})
