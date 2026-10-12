import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgreementEditor,
  CommercialAccount,
  CommercialAccounts,
} from './commercial-workspace'
import {
  newAgreementContent,
  type CommercialAgreement,
  emptyProfile,
} from '@/lib/ops/commercial'

vi.mock('@/supabase/client', () => ({ createClient: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function draft(): CommercialAgreement {
  const content = newAgreementContent('Example Business')
  content.service_address = '123 Main St, Colorado Springs, CO 80903'
  content.effective_from = '2026-09-05'
  content.payment_terms = 'Monthly invoicing.'
  content.lines[0].method = 'Hot water extraction'
  return {
    id: 'agreement-a',
    customer_id: 'customer-a',
    source_estimate_id: null,
    previous_version_id: null,
    version: 1,
    revision: 1,
    status: 'draft',
    content,
    content_hash: null,
    published_at: null,
    signed_at: null,
    signed_name: null,
    signed_title: null,
    signed_email: null,
    signature_consent: null,
    created_at: '2026-09-05T00:00:00Z',
  }
}

describe('commercial text reminder status', () => {
  const authorized = {
    phone: '+17195550100',
    enabled: true,
    consentAt: '2026-10-08T16:13:23Z',
    optedOutAt: null,
  }

  it.each([
    [authorized, 'Signed up', false],
    [{ ...authorized, consentAt: null }, 'Not signed up', false],
    [{ ...authorized, phone: '' }, 'Not signed up', false],
    [
      { ...authorized, enabled: false, optedOutAt: '2026-10-09T12:00:00Z' },
      'Opted out',
      false,
    ],
    [undefined, 'Not signed up', false],
    [undefined, 'Booking number', true],
  ])(
    'shows saved enrollment beside the account name: %j',
    async (preferences, label, usesBookingPhone) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            businessName: 'Example Business',
            profile: emptyProfile,
            smsPreferences: preferences,
            smsUsesBookingPhone: usesBookingPhone,
            agreements: [],
            addresses: [],
            estimates: [],
            users: [],
            plans: [],
          }),
        }),
      )
      render(<CommercialAccount customerId="customer-a" />)
      const heading = await screen.findByRole('heading', {
        name: 'Example Business',
      })
      expect(
        within(heading.parentElement!).getByText(`Text reminders: ${label}`),
      ).toBeInTheDocument()
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it('shows each business enrollment on its list card, including accounts without a profile', async () => {
    const enrolled = {
      scheduling_sms_phone: authorized.phone,
      scheduling_sms_enabled: true,
      scheduling_sms_consent_at: authorized.consentAt,
      scheduling_sms_opted_out_at: null,
    }
    const customers = [
      {
        id: 'enrolled',
        business_name: 'Enrolled Business',
        ops_commercial_profiles: [enrolled],
      },
      {
        id: 'missing',
        business_name: 'New Business',
        ops_commercial_profiles: null,
      },
      {
        id: 'booking',
        business_name: 'Existing Booking Business',
        phone: '+17195550100',
        ops_commercial_profiles: null,
      },
      {
        id: 'disabled',
        business_name: 'Disabled Profile Business',
        phone: '+17195550100',
        ops_commercial_profiles: { ...enrolled, scheduling_sms_enabled: false },
      },
      {
        id: 'stopped',
        business_name: 'Stopped Business',
        ops_commercial_profiles: {
          ...enrolled,
          scheduling_sms_enabled: false,
          scheduling_sms_opted_out_at: '2026-10-09T12:00:00Z',
        },
      },
    ].map((c) => ({
      ...c,
      full_name: '',
      ops_commercial_agreements: [],
      ops_client_users: [],
    }))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ customers, requests: [] }),
      }),
    )
    render(<CommercialAccounts />)
    for (const [name, label] of [
      ['Enrolled Business', 'Signed up'],
      ['New Business', 'Not signed up'],
      ['Stopped Business', 'Opted out'],
      ['Existing Booking Business', 'Booking number'],
      ['Disabled Profile Business', 'Not signed up'],
    ]) {
      const card = await screen.findByRole('link', { name: new RegExp(name) })
      expect(
        within(card).getByText(`Text reminders: ${label}`),
      ).toBeInTheDocument()
    }
  })
})

describe('commercial agreement approval', () => {
  it('puts the required representative field beside the approval controls', () => {
    render(
      <AgreementEditor agreement={draft()} addresses={[]} onChange={vi.fn()} />,
    )

    const representative = screen.getByLabelText(
      'Sasquatch approving representative (required)',
    )
    const review = screen.getByLabelText(
      'I approve this version for customer review on behalf of Sasquatch.',
    )
    const publish = screen.getByRole('button', {
      name: 'Publish for signature',
    })

    expect(representative).toHaveValue('')
    expect(publish).toBeDisabled()
    fireEvent.change(representative, { target: { value: 'Charles Sewell' } })
    expect(review).not.toBeChecked()
    fireEvent.click(review)
    expect(publish).toBeEnabled()
  })

  it('offers a one-time path from an accepted estimate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          businessName: 'Example Business',
          customerContact: {
            display_name: 'Alex Manager',
            email: 'alex@example.com',
            phone: '+17195551234',
          },
          profile: {
            legal_name: '',
            billing_contact: '',
            billing_email: '',
            purchase_order: '',
            access_instructions: '',
            service_windows: '',
            site_notes: '',
          },
          agreements: [],
          addresses: [],
          estimates: [
            {
              id: 'estimate-a',
              appointment_date: '2026-09-04',
              quoted_total: 1049.94,
              estimate_status: 'accepted',
            },
          ],
          users: [],
          plans: [],
        }),
      }),
    )

    render(<CommercialAccount customerId="customer-a" />)

    const schedule = await screen.findByRole('link', {
      name: /schedule one-time visit/i,
    })
    expect(schedule).toHaveAttribute(
      'href',
      '/admin/operations/estimates/estimate-a?schedule=1',
    )
    expect(screen.getByText('(719) 555-1234')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute(
      'href',
      'tel:+17195551234',
    )
    expect(screen.getByRole('link', { name: 'Text' })).toHaveAttribute(
      'href',
      'sms:+17195551234',
    )
    expect(
      screen.getByText(/copies the approved estimate line items/i),
    ).toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  })

  it('offers recurring setup from a signed agreement at the same hub', async () => {
    const agreement = draft()
    agreement.status = 'signed'
    agreement.content.lines[0].phase = 'recurring'
    agreement.content.lines[0].frequency = 'Monthly'
    agreement.signed_at = '2026-09-05T12:00:00Z'
    agreement.signed_name = 'Client Signer'
    agreement.signed_title = 'Manager'
    agreement.signed_email = 'client@example.com'
    agreement.signature_consent = 'Electronic signature accepted.'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          businessName: 'Example Business',
          profile: {
            legal_name: '',
            billing_contact: '',
            billing_email: '',
            purchase_order: '',
            access_instructions: '',
            service_windows: '',
            site_notes: '',
          },
          agreements: [agreement],
          addresses: [],
          estimates: [],
          users: [],
          plans: [],
        }),
      }),
    )

    render(<CommercialAccount customerId="customer-a" />)

    const recurring = await screen.findByRole('button', {
      name: 'Build recurring schedule',
    })
    expect(
      screen.getByText(/1 recurring service approved/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/sends generated visits into Recurring Work/i),
    ).toBeInTheDocument()
    expect(recurring).toBeEnabled()
    expect(
      await screen.findByRole('heading', {
        name: 'Build a service schedule from this agreement',
      }),
    ).toBeInTheDocument()
  })

  it('opens a pre-send review for a published agreement and signer', async () => {
    const agreement = draft()
    agreement.status = 'published'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          businessName: 'Example Business',
          profile: {
            legal_name: '',
            billing_contact: '',
            billing_email: '',
            purchase_order: '',
            access_instructions: '',
            service_windows: '',
            site_notes: '',
          },
          agreements: [agreement],
          addresses: [],
          estimates: [],
          users: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              display_name: 'Alex Manager',
              email: 'alex@example.com',
              is_active: true,
              can_sign_agreements: true,
            },
          ],
          plans: [],
        }),
      }),
    )

    render(<CommercialAccount customerId="customer-a" />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Review & send customer setup email',
      }),
    )
    expect(
      screen.getByRole('heading', {
        name: 'Review setup email before sending',
      }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('dialog')).getByText('alex@example.com'),
    ).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses the saved customer email with no billing profile and opens review without creating anything', async () => {
    const agreement = draft()
    agreement.status = 'published'
    const account = {
      businessName: 'Example Business',
      customerContact: { display_name: '', email: 'alex@example.com' },
      profile: {
        legal_name: '',
        billing_contact: '',
        billing_email: '',
        purchase_order: '',
        access_instructions: '',
        service_windows: '',
        site_notes: '',
      },
      agreements: [agreement],
      addresses: [],
      estimates: [],
      plans: [],
    }
    const contact = {
      id: '33333333-3333-4333-8333-333333333333',
      display_name: 'Alex Manager',
      email: 'alex@example.com',
      is_active: true,
      can_sign_agreements: true,
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...account, users: [] }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...account, users: [contact] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<CommercialAccount customerId="customer-a" />)

    expect(await screen.findByLabelText('Contact name (optional)')).toHaveValue(
      '',
    )
    expect(screen.getByLabelText('Customer email')).toHaveValue(
      'alex@example.com',
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Review & send customer setup email',
      }),
    )

    expect(
      await screen.findByRole('heading', {
        name: 'Review setup email before sending',
      }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('dialog')).getByText('alex@example.com'),
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(
      screen.getByText('Choose the recurring services first'),
    ).toBeInTheDocument()
  })
})
