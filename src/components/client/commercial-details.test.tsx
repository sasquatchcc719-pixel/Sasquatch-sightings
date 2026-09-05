import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientCommercialDetails } from './commercial-details'
import { ClientPortal } from './client-portal'
import {
  emptyProfile,
  newAgreementContent,
  type CommercialAgreement,
  type CommercialData,
} from '@/lib/ops/commercial'

vi.mock('@/supabase/client', () => ({ createClient: vi.fn() }))
afterEach(cleanup)
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
        .getByText('The details that make a visit seamless.')
        .closest('details'),
    ).not.toHaveAttribute('open')
    expect(
      screen.queryByText('Sign and accept agreement'),
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
})
