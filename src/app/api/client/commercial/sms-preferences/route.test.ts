import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SCHEDULING_SMS_CONSENT } from '@/lib/ops/commercial'

const mocks = vi.hoisted(() => ({
  requireClientManager: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireClientManager: mocks.requireClientManager,
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}))

import { PATCH } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireClientManager.mockResolvedValue({
    user: { id: 'auth-a' },
    client: { customer_id: 'customer-a' },
  })
  mocks.rpc.mockResolvedValue({ error: null })
})

describe('commercial scheduling text preferences', () => {
  it('records scoped express consent with the server-owned authorization text', async () => {
    const response = await PATCH(
      new NextRequest(
        'https://example.com/api/client/commercial/sms-preferences',
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Portal Browser',
            'x-forwarded-for': '192.0.2.1',
          },
          body: JSON.stringify({
            phone: '(719) 555-0100',
            enabled: true,
            consentAcknowledged: true,
          }),
        },
      ),
    )

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('set_commercial_sms_preference', {
      p_customer_id: 'customer-a',
      p_user_id: 'auth-a',
      p_phone: '+17195550100',
      p_enabled: true,
      p_consent_text: SCHEDULING_SMS_CONSENT,
      p_source: 'commercial_portal',
      p_ip_address: '192.0.2.1',
      p_user_agent: 'Portal Browser',
    })
  })

  it('rejects enabling texts without explicit authorization', async () => {
    const response = await PATCH(
      new NextRequest(
        'https://example.com/api/client/commercial/sms-preferences',
        {
          method: 'PATCH',
          body: JSON.stringify({
            phone: '719-555-0100',
            enabled: true,
            consentAcknowledged: false,
          }),
        },
      ),
    )

    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
