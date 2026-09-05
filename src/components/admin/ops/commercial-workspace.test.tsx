import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgreementEditor, CommercialAccount } from './commercial-workspace'
import {
  newAgreementContent,
  type CommercialAgreement,
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

  it('surfaces accepted estimates as the manual scheduling handoff', async () => {
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
      name: /schedule approved work/i,
    })
    expect(schedule).toHaveAttribute(
      'href',
      '/admin/operations/estimates/estimate-a?schedule=1',
    )
    expect(
      screen.getByText(/estimate line items transfer automatically/i),
    ).toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  })
})
