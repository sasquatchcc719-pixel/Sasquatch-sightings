import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { ClientCommercialDetails } from './commercial-details'
import { ClientPortal } from './client-portal'
import { CommercialClientPreview } from '@/components/admin/ops/commercial-client-preview'
import {
  emptyProfile,
  newAgreementContent,
  type CommercialAgreement,
  type CommercialData,
} from '@/lib/ops/commercial'

vi.mock('@/supabase/client', () => ({ createClient: vi.fn() }))
// jsdom does not implement scrolling; browser verification covers actual movement.
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const data: CommercialData = {
  businessName: 'Example Business',
  profile: { ...emptyProfile },
  addresses: [],
  agreements: [],
}
const schedule = { appointments: [], templates: [], requests: [] }
const agreement = (status: CommercialAgreement['status']) =>
  ({
    id: 'agreement-a',
    version: 1,
    status,
    content_hash: 'hash-a',
    content: {
      ...newAgreementContent('Example Business'),
      title: 'Private agreement',
      lines: [
        {
          ...newAgreementContent('Example Business').lines[0],
          name: 'Measured carpet care',
          method: 'Hot water extraction',
          quantity: 1000,
          unit: 'per_sq_ft',
          unit_price: 0.35,
        },
      ],
    },
  }) as CommercialAgreement

describe('commercial customer experience', () => {
  it('lets a non-signer send version-linked feedback without signing', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        request: { id: 'request-a' },
        telegram_sent: true,
      }),
    })
    vi.stubGlobal('fetch', fetch)
    render(
      <ClientCommercialDetails
        initialData={{ ...data, agreements: [agreement('published')] }}
      />,
    )
    fireEvent.click(
      screen.getByText('Private agreement', { selector: 'strong' }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Send a note or request changes' }),
    )
    fireEvent.change(screen.getByLabelText('Note about version 1'), {
      target: { value: 'Please remove upholstery.' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Send note to Charles' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Note sent for version 1.',
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Charles was alerted in Telegram.',
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('/api/client/requests')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      request_type: 'scope_change',
      agreement_id: 'agreement-a',
      message: 'Please remove upholstery.',
    })
    expect(
      screen.queryByRole('button', { name: 'Sign and accept agreement' }),
    ).not.toBeInTheDocument()
  })
  it('preserves feedback after a failed send and allows retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Unable to send. Please retry.' }),
      }),
    )
    render(
      <ClientCommercialDetails
        initialData={{ ...data, agreements: [agreement('published')] }}
      />,
    )
    fireEvent.click(
      screen.getByText('Private agreement', { selector: 'strong' }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Send a note or request changes' }),
    )
    fireEvent.change(screen.getByLabelText('Note about version 1'), {
      target: { value: 'Quarterly please.' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Send note to Charles' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to send. Please retry.',
    )
    expect(screen.getByLabelText('Note about version 1')).toHaveValue(
      'Quarterly please.',
    )
    expect(
      screen.getByRole('button', { name: 'Send note to Charles' }),
    ).toBeEnabled()
  })
  it.each([false, true])(
    'shows auto scrubbing without offering a portal request (has agreement: %s)',
    (hasAgreement) => {
      render(
        <ClientCommercialDetails
          initialData={{
            ...data,
            agreements: hasAgreement ? [agreement('published')] : [],
          }}
        />,
      )
      const card = screen
        .getByRole('heading', { name: 'Hard-surface auto scrubbing' })
        .closest('article')!
      expect(
        within(card).getByText('Contact Sasquatch for a quote'),
      ).toBeInTheDocument()
      expect(
        within(card).queryByRole('button', { name: 'Request this service' }),
      ).not.toBeInTheDocument()
    },
  )
  it('does not duplicate auto scrubbing already listed in an agreement', () => {
    const existing = agreement('published')
    existing.content.lines[0].name = 'Hard-surface auto scrubbing'
    render(
      <ClientCommercialDetails
        initialData={{ ...data, agreements: [existing] }}
      />,
    )
    expect(
      within(document.getElementById('commercial-care')!).getAllByRole(
        'heading',
        { name: 'Hard-surface auto scrubbing' },
      ),
    ).toHaveLength(1)
    expect(
      within(
        screen
          .getAllByRole('heading', { name: 'Hard-surface auto scrubbing' })[0]
          .closest('article')!,
      ).queryByText('Contact Sasquatch for a quote'),
    ).not.toBeInTheDocument()
  })
  it('shows the earliest same-day visit without mutating the shared schedule', () => {
    const appointments = ['14:00', '09:00'].map((time) => ({
      id: time,
      appointment_date: '2099-09-04',
      start_time: time,
      end_time: '15:00',
      status: 'confirmed',
      client_note: null,
      recurring_template_id: null,
      template_label: null,
      line_items: [],
    }))
    render(
      <ClientCommercialDetails
        initialData={data}
        schedule={{ ...schedule, appointments }}
        readOnly
      />,
    )
    expect(
      within(screen.getByRole('banner')).getByText('9:00 AM – 3:00 PM'),
    ).toBeInTheDocument()
    expect(appointments[0].start_time).toBe('14:00')
  })
  it('leads with the account, keeps profile fields collapsed, and gives honest empty states', () => {
    render(
      <ClientCommercialDetails
        initialData={data}
        schedule={schedule}
        readOnly
      />,
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Example Business',
    )
    expect(screen.getByText('Preparation in progress')).toBeInTheDocument()
    expect(
      screen
        .getByText('Business details & access instructions')
        .closest('details'),
    ).not.toHaveAttribute('open')
    expect(
      screen.queryByText('Sign and accept agreement'),
    ).not.toBeInTheDocument()
  })
  it('uses the website logo and opens the profile from the first-time action', () => {
    const scroll = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => {})
    render(<ClientCommercialDetails initialData={data} />)
    expect(
      screen.getByAltText('Sasquatch Carpet Cleaning').getAttribute('src'),
    ).toContain('sasquatch-website-logo.png')
    fireEvent.click(
      screen.getByRole('button', { name: 'Add business details' }),
    )
    const profile = screen
      .getByText('Business details & access instructions')
      .closest('details')
    expect(profile).toHaveAttribute('open')
    expect(profile?.querySelector('summary')).toHaveFocus()
    expect(profile?.querySelector('summary')).not.toHaveAttribute(
      'tabindex',
      '-1',
    )
    scroll.mockRestore()
  })
  it('prioritizes a published agreement and opens its terms without signing', () => {
    const scroll = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => {})
    render(
      <ClientCommercialDetails
        initialData={{ ...data, agreements: [agreement('published')] }}
        canSign
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Review & sign agreement' }),
    )
    expect(
      screen
        .getByText('Private agreement', { selector: 'strong' })
        .closest('details'),
    ).toHaveAttribute('open')
    expect(
      screen.getByRole('button', { name: 'Sign and accept agreement' }),
    ).toBeDisabled()
    scroll.mockRestore()
  })
  it('shows only the two distinct customer steps', () => {
    render(
      <ClientCommercialDetails
        initialData={{ ...data, agreements: [agreement('published')] }}
        schedule={schedule}
      />,
    )
    const steps = screen.getByLabelText('How to use your account')
    expect(within(steps).getAllByRole('button')).toHaveLength(2)
    expect(
      within(steps).getByRole('button', { name: /Review your agreement/ }),
    ).toBeInTheDocument()
    expect(
      within(steps).getByRole('button', { name: /Check your appointments/ }),
    ).toBeInTheDocument()
    expect(within(steps).queryByText('Review your services')).toBeNull()
  })
  it('does not ask a customer with billing contacts to repeat setup while an agreement is being prepared', () => {
    render(
      <ClientCommercialDetails
        initialData={{
          ...data,
          profile: {
            ...emptyProfile,
            billing_contact: 'Manager',
            billing_email: 'manager@example.com',
          },
        }}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'View agreement status' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Add business details' }),
    ).not.toBeInTheDocument()
  })
  it('never renders draft agreement names, prices, or services in the customer preview', () => {
    render(
      <ClientCommercialDetails
        initialData={{ ...data, agreements: [agreement('draft')] }}
        readOnly
      />,
    )
    expect(screen.queryByText('Private agreement')).not.toBeInTheDocument()
    expect(screen.queryByText('Measured carpet care')).not.toBeInTheDocument()
    expect(screen.queryByText('$350.00')).not.toBeInTheDocument()
  })
  it('exposes published terms and downloads but prevents preview signing or requests', () => {
    render(
      <ClientCommercialDetails
        initialData={{ ...data, agreements: [agreement('published')] }}
        readOnly
        canSign
      />,
    )
    fireEvent.click(
      screen.getByText('Private agreement', { selector: 'strong' }),
    )
    expect(screen.getByText('Print / PDF')).toHaveAttribute(
      'href',
      '/api/commercial/agreements/agreement-a/document',
    )
    expect(
      screen.queryByText('Sign and accept agreement'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Request this service')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Send a note or request changes',
      }),
    ).toBeDisabled()
  })
  it('keeps password and consent requirements for an authorized signer', () => {
    render(
      <ClientCommercialDetails
        initialData={{ ...data, agreements: [agreement('published')] }}
        canSign
      />,
    )
    fireEvent.click(
      screen.getByText('Private agreement', { selector: 'strong' }),
    )
    expect(screen.getByLabelText('Confirm your portal password')).toBeRequired()
    expect(screen.getByRole('checkbox')).toBeRequired()
    expect(
      screen.getByRole('button', { name: 'Sign and accept agreement' }),
    ).toBeDisabled()
  })
  it('keeps staff preview read-only without a browser request simulation', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<CommercialClientPreview commercial={data} schedule={schedule} />)
    expect(screen.getByText(/agreement notes are disabled/i)).toBeTruthy()
    expect(screen.queryByText('Browser-only test records')).toBeNull()
    expect(screen.queryByText('Request this service')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps the schedule focused on confirmed work and direct contact', () => {
    render(
      <ClientPortal
        businessName="Example Business"
        managerName="Manager"
        initialData={schedule}
        initialCommercialData={data}
        canSign={false}
        mustChangePassword={false}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))
    expect(
      screen.getByRole('link', { name: 'Text Sasquatch' }),
    ).toHaveAttribute('href', 'sms:7192498791')
    expect(screen.queryByText('New request')).toBeNull()
    expect(screen.queryByText('My requests')).toBeNull()
  })
  it('keeps tile and upholstery visible beside a carpet agreement without adding them to its scope', () => {
    const published = agreement('published')
    render(
      <ClientCommercialDetails
        initialData={{ ...data, agreements: [published] }}
      />,
    )
    for (const name of ['Tile & grout', 'Upholstery care']) {
      const card = screen.getByRole('heading', { name }).closest('article')!
      expect(
        within(card).getByText('Contact Sasquatch for a quote'),
      ).toBeInTheDocument()
      expect(
        within(card).queryByRole('button', { name: 'Request this service' }),
      ).not.toBeInTheDocument()
    }
    expect(published.content.lines).toHaveLength(1)
  })
})
