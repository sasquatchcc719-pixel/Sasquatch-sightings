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
import { ClientPortal, RequestForm } from './client-portal'
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
      json: async () => ({ request: { id: 'request-a' } }),
    })
    vi.stubGlobal('fetch', fetch)
    const submitted = vi.fn()
    render(
      <ClientCommercialDetails
        initialData={{ ...data, agreements: [agreement('published')] }}
        onRequestSubmitted={submitted}
      />,
    )
    fireEvent.click(
      screen.getByText('Private agreement', { selector: 'strong' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }))
    fireEvent.change(
      screen.getByLabelText('What would you like changed in version 1?'),
      { target: { value: 'Please remove upholstery.' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Send change request' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Change request sent for version 1.',
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('/api/client/requests')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      request_type: 'scope_change',
      agreement_id: 'agreement-a',
      message: 'Please remove upholstery.',
    })
    expect(submitted).toHaveBeenCalledOnce()
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
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }))
    fireEvent.change(
      screen.getByLabelText('What would you like changed in version 1?'),
      { target: { value: 'Quarterly please.' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Send change request' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to send. Please retry.',
    )
    expect(
      screen.getByLabelText('What would you like changed in version 1?'),
    ).toHaveValue('Quarterly please.')
    expect(
      screen.getByRole('button', { name: 'Send change request' }),
    ).toBeEnabled()
  })
  it.each([false, true])(
    'offers auto scrubbing without changing agreement scope (has agreement: %s)',
    (hasAgreement) => {
      const request = vi.fn()
      render(
        <ClientCommercialDetails
          initialData={{
            ...data,
            agreements: hasAgreement ? [agreement('published')] : [],
          }}
          onRequestService={request}
        />,
      )
      const card = screen
        .getByRole('heading', { name: 'Hard-surface auto scrubbing' })
        .closest('article')!
      expect(
        within(card).getByText('Quoted separately before service'),
      ).toBeInTheDocument()
      fireEvent.click(
        within(card).getByRole('button', { name: 'Request this service' }),
      )
      expect(request).toHaveBeenCalledWith('Hard-surface auto scrubbing')
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
      ).queryByText('Quoted separately before service'),
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
      screen.getByRole('button', { name: 'Explore services' }),
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
    const request = vi.fn()
    render(
      <ClientCommercialDetails
        initialData={{ ...data, agreements: [agreement('published')] }}
        readOnly
        canSign
        onRequestService={request}
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
      screen.getByRole('button', { name: 'Request changes' }),
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
  it('passes the selected service into a request without submitting anything', () => {
    const request = vi.fn()
    render(
      <ClientCommercialDetails initialData={data} onRequestService={request} />,
    )
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Request this service' })[0],
    )
    expect(request).toHaveBeenCalledWith('Carpet care')
  })
  it('lets the staff test drive open service requests without enabling real preview submissions', () => {
    const request = vi.fn()
    render(
      <ClientCommercialDetails
        initialData={data}
        readOnly
        previewServiceRequests
        onRequestService={request}
      />,
    )
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Request this service' })[0],
    )
    expect(request).toHaveBeenCalledWith('Carpet care')
  })
  it('runs the complete staff request simulation without calling the API', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    render(<CommercialClientPreview commercial={data} schedule={schedule} />)
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Request this service' })[0],
    )
    expect(screen.getByLabelText('Service needed')).toHaveValue('Carpet care')
    fireEvent.change(screen.getByLabelText('Details'), {
      target: { value: 'Please clean the lobby.' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Test request (nothing sent)' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Preview complete. No request was sent.',
    )
    expect(fetch).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
  it('opens the real request form with a selected service from the landing page', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
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
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Request this service' })[1],
    )
    expect(screen.getByLabelText('Service needed')).toHaveValue('Tile & grout')
    expect(
      screen.getByRole('button', { name: 'Schedule & requests' }),
    ).toHaveAttribute('aria-pressed', 'true')
    vi.restoreAllMocks()
  })
  it('keeps tile and upholstery requestable beside a carpet agreement without adding them to its scope', () => {
    const published = agreement('published')
    render(
      <ClientCommercialDetails
        initialData={{ ...data, agreements: [published] }}
        onRequestService={vi.fn()}
      />,
    )
    for (const name of ['Tile & grout', 'Upholstery care']) {
      const card = screen.getByRole('heading', { name }).closest('article')!
      expect(
        within(card).getByText('Quoted separately before service'),
      ).toBeInTheDocument()
      expect(
        within(card).getByRole('button', { name: 'Request this service' }),
      ).toBeEnabled()
    }
    expect(published.content.lines).toHaveLength(1)
  })
  it('sends custom frequency and start date through the real request payload without requiring duplicate notes', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ request: { id: 'request-a' } }),
    })
    vi.stubGlobal('fetch', fetch)
    render(<RequestForm appointments={[]} initialService="Tile & grout" />)
    fireEvent.change(
      screen.getByLabelText('How often do you need this service?'),
      { target: { value: 'Custom / seasonal' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Describe your preferred frequency',
    )
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.change(
      screen.getByLabelText('Describe your frequency or season'),
      { target: { value: 'Every 6 weeks, October–March' } },
    )
    fireEvent.change(screen.getByLabelText('Preferred date'), {
      target: { value: '2099-10-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Request received',
    )
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(
      expect.objectContaining({
        request_type: 'add_visit',
        details: expect.objectContaining({
          service: 'Tile & grout',
          frequency: 'Every 6 weeks, October–March',
          preferred_date: '2099-10-01',
        }),
      }),
    )
  })
  it('opens cancellation for the selected signed-contract visit without calling the direct skip API', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    const appointment = {
      id: 'visit-a',
      appointment_date: '2099-09-04',
      start_time: '09:00',
      end_time: '11:00',
      status: 'confirmed',
      client_note: null,
      recurring_template_id: null,
      template_label: null,
      line_items: [],
    }
    render(
      <ClientPortal
        businessName="Example Business"
        managerName="Manager"
        initialData={{ ...schedule, appointments: [appointment] }}
        initialCommercialData={{ ...data, agreements: [agreement('signed')] }}
        canSign={false}
        mustChangePassword={false}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Schedule & requests' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Request cancellation' }),
    )
    expect(screen.getByLabelText('Type of request')).toHaveValue('skip_visit')
    expect(screen.getByLabelText('Which visit?')).toHaveValue('visit-a')
    expect(fetch).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
