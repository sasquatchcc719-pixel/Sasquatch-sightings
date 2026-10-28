import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))
import { PartnerDashboard } from './partner-dashboard'

const partner = {
  id: 'fixture-partner',
  name: 'Fixture Partner',
  email: 'fixture@example.test',
  company_name: 'Fixture Business',
  credit_balance: 0,
  backlink_opted_in: false,
  backlink_verified: false,
}
const stats = {
  creditBalance: 0,
  totalReferrals: 0,
  convertedReferrals: 0,
  pendingReferrals: 0,
  bookedReferrals: 0,
}
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock = vi.fn().mockResolvedValue(
    Response.json({
      success: true,
      referral_id: 'saved-referral',
      status: 'pending',
      credit_awarded: false,
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(window, 'open').mockReturnValue(null)
  render(
    <PartnerDashboard
      partner={partner}
      referrals={[]}
      incomingWork={[]}
      stats={stats}
    />,
  )
  fireEvent.change(screen.getByLabelText('Client Name *'), {
    target: { value: 'Fixture Client' },
  })
  fireEvent.change(screen.getByLabelText('Client Phone *'), {
    target: { value: '7195550100' },
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('pending partner referral submission', () => {
  it('opens booking only after saving a pending referral and never claims booking or credit authority', async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Submit & Open Booking' }),
    )
    await screen.findByText(
      'Referral saved as pending. Credit is added after booking is verified.',
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/partners/referrals',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          client_name: 'Fixture Client',
          client_phone: '7195550100',
          notes: null,
        }),
      }),
    )
    expect(window.open).toHaveBeenCalledWith('/book', '_blank')
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('preserves details and does not open booking when referral saving fails', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: 'Submission unavailable' }, { status: 503 }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Submit & Open Booking' }),
    )
    await screen.findByText('Submission unavailable')
    expect(window.open).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Client Name *')).toHaveValue('Fixture Client')
    expect(
      screen.queryByText(/Referral saved as pending/),
    ).not.toBeInTheDocument()
  })

  it('ordinary submission saves only lead details without opening the booking form', async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Submit Referral' }))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      client_name: 'Fixture Client',
      client_phone: '7195550100',
      notes: null,
    })
    expect(window.open).not.toHaveBeenCalled()
  })
})
