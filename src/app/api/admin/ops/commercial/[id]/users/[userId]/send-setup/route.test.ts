import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAnyRole: vi.fn(),
  send: vi.fn(),
  renderToBuffer: vi.fn(),
  buildEmailHtml: vi.fn(),
  insert: vi.fn(),
  getUserById: vi.fn(),
  generateLink: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.requireAnyRole }))
vi.mock('@/lib/ops/commercial-server', () => ({
  AGREEMENT_SELECT: 'id,customer_id,status,content',
}))
vi.mock('@react-pdf/renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@react-pdf/renderer')>()
  return { ...actual, renderToBuffer: mocks.renderToBuffer }
})
vi.mock('@/lib/ops/communications', () => ({
  buildEmailHtml: mocks.buildEmailHtml,
}))
vi.mock('@/lib/ops/email-bcc', () => ({
  opsEmailBcc: () => 'owner@example.com',
}))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send }
  },
}))

const ids = {
  customer: '22222222-2222-4222-8222-222222222222',
  contact: '33333333-3333-4333-8333-333333333333',
  auth: '44444444-4444-4444-8444-444444444444',
  agreement: '11111111-1111-4111-8111-111111111111',
  operation: '55555555-5555-4555-8555-555555555555',
}

const agreement = {
  id: ids.agreement,
  customer_id: ids.customer,
  source_estimate_id: null,
  previous_version_id: null,
  version: 1,
  revision: 1,
  status: 'published',
  content: {
    title: 'Cleaning & Maintenance Agreement',
    business_name: 'Saltgrass Colorado Springs',
    service_address_id: null,
    service_address: '1405 Jamboree Drive, Colorado Springs, CO',
    effective_from: '2026-09-05',
    effective_until: '',
    provider_name: 'Charles Sewell',
    payment_terms: 'Monthly invoicing.',
    cancellation_terms: '24 hours notice requested.',
    access_terms: 'Provide access.',
    quality_standards: 'Inspect completed work.',
    exclusions: 'Unlisted work is excluded.',
    additional_terms: 'Dates require confirmation.',
    lines: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        name: 'Commercial carpet cleaning',
        area: 'Dining room',
        phase: 'recurring',
        quantity: 2258,
        unit: 'per_sq_ft',
        unit_price: 0.35,
        method: 'Hot water extraction',
        frequency: 'Quarterly',
        service_window: 'After closing',
        notes: '',
        service_catalog_item_id: null,
        length_value: null,
        width_value: null,
        area_segments: null,
      },
    ],
  },
  content_hash: 'hash',
  published_at: '2026-09-05T12:00:00Z',
  signed_at: null,
  signed_name: null,
  signed_title: null,
  signed_email: null,
  signature_consent: null,
  created_at: '2026-09-05T12:00:00Z',
}

function query(data: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(async () => ({ data, error: null }))
  builder.insert = mocks.insert
  return builder
}

function database(contactCanSign = true) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'ops_customers')
        return query({
          id: ids.customer,
          business_name: 'Saltgrass Colorado Springs',
          full_name: 'Saltgrass Colorado Springs',
        })
      if (table === 'ops_client_users')
        return query({
          id: ids.contact,
          user_id: ids.auth,
          display_name: 'Alex Manager',
          email: 'alex@example.com',
          is_active: true,
          can_sign_agreements: contactCanSign,
        })
      if (table === 'ops_commercial_agreements') return query(agreement)
      if (table === 'ops_email_log') return query(null)
      throw new Error(`Unexpected table ${table}`)
    }),
    auth: {
      admin: {
        getUserById: mocks.getUserById,
        generateLink: mocks.generateLink,
      },
    },
  }
}

const createAdminClient = vi.hoisted(() => vi.fn())
vi.mock('@/supabase/server', () => ({ createAdminClient }))

import { POST } from './route'

function request() {
  return new NextRequest('https://sightings.sasquatchcarpet.com/api/send', {
    method: 'POST',
    body: JSON.stringify({
      agreement_id: ids.agreement,
      operation_id: ids.operation,
      subject: 'Your Saltgrass customer setup',
      body: 'This is the complete customer setup message. It explains the secure portal, agreement review, recurring service, one-time choice, and confirmed appointments.'.repeat(
        2,
      ),
    }),
  })
}

describe('commercial customer setup delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://sightings.sasquatchcarpet.com')
    createAdminClient.mockReturnValue(database())
    mocks.getUserById.mockResolvedValue({
      data: { user: { id: ids.auth, email: 'alex@example.com' } },
      error: null,
    })
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: 'secure-hash' } },
      error: null,
    })
    mocks.renderToBuffer.mockResolvedValue(Buffer.from('%PDF-agreement'))
    mocks.buildEmailHtml.mockReturnValue('<html>setup</html>')
    mocks.send.mockResolvedValue({ data: { id: 'resend-1' }, error: null })
    mocks.insert.mockResolvedValue({ error: null })
  })

  it('sends the reviewed email, secure link, and exact agreement PDF', async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ id: ids.customer, userId: ids.contact }),
    })

    expect(response.status).toBe(200)
    expect(mocks.generateLink).toHaveBeenCalledWith({
      type: 'magiclink',
      email: 'alex@example.com',
    })
    expect(mocks.buildEmailHtml).toHaveBeenCalledWith(
      expect.any(String),
      'commercial_portal_setup',
      {
        cta: {
          label: 'Open portal and review agreement',
          url: expect.stringContaining(
            '/auth/confirm?token_hash=secure-hash&type=magiclink&next=%2Fclient',
          ),
        },
      },
    )
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alex@example.com',
        bcc: 'owner@example.com',
        attachments: [
          expect.objectContaining({
            filename: 'saltgrass-colorado-springs-service-agreement-v1.pdf',
          }),
        ],
      }),
      { idempotencyKey: `commercial-setup-${ids.operation}` },
    )
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: ids.customer,
        template_key: 'commercial_portal_setup',
        status: 'sent',
        resend_id: 'resend-1',
      }),
    )
  })

  it('refuses to send to a contact who cannot sign', async () => {
    createAdminClient.mockReturnValue(database(false))

    const response = await POST(request(), {
      params: Promise.resolve({ id: ids.customer, userId: ids.contact }),
    })

    expect(response.status).toBe(422)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('reports when delivery succeeds but its audit record cannot be saved', async () => {
    mocks.insert.mockResolvedValueOnce({
      error: new Error('email log unavailable'),
    })

    const response = await POST(request(), {
      params: Promise.resolve({ id: ids.customer, userId: ids.contact }),
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error:
        'The setup email was sent, but its delivery record could not be saved. Retry this same send to repair the record without sending a duplicate email.',
    })
    expect(mocks.send).toHaveBeenCalledWith(expect.any(Object), {
      idempotencyKey: `commercial-setup-${ids.operation}`,
    })
  })
})
