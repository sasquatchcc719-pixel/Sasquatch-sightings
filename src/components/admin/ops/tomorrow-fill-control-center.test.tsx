import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TomorrowFillControlCenter } from './tomorrow-fill-control-center'

const settings = {
  engine_enabled: true,
  send_enabled: false,
  dormancy_months: 8,
  customer_cooldown_days: 14,
  unanswered_limit: 4,
  rest_days: 60,
  minimum_audience_size: 5,
  default_wave_size: 5,
  max_discounted_bookings: 2,
  offer_code: 'TF35',
  offer_amount: 35,
  minimum_subtotal: 250,
  offer_valid_days: 14,
  message_template:
    'Hi {{first_name}}, save ${{offer_amount}}: {{booking_url}}',
}

const campaign = {
  id: '4c41883f-ed4e-482e-936f-55e924702303',
  target_date: '2026-09-29',
  status: 'pending_approval',
  selected_zips: ['80133', '80920'],
  openings: [
    {
      startTime: '16:00:00',
      endTime: '18:00:00',
      staffName: 'David Gonzalez',
    },
  ],
  exclusion_counts: {},
  open_minutes: 120,
  booked_minutes: 0,
  eligible_count: 29,
  sent_count: 0,
  failed_count: 0,
  booked_count: 0,
  attributed_revenue: 0,
  offer_code: 'TF35',
  offer_amount: 35,
  minimum_subtotal: 250,
  message_template:
    'Hi {{first_name}}, save ${{offer_amount}}: {{booking_url}}',
  created_at: '2026-09-29T00:43:00.000Z',
}

beforeEach(() => {
  window.history.replaceState({}, '', `/?campaign=${campaign.id}`)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        settings,
        campaigns: [campaign],
        selectedCampaignId: campaign.id,
        recipients: [],
        events: [],
      }),
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TomorrowFillControlCenter', () => {
  it('renders the camelCase opening contract produced by a live scan', async () => {
    render(<TomorrowFillControlCenter />)

    expect(await screen.findByText('Tomorrow Fill')).toBeInTheDocument()
    expect(screen.getByText('4:00 PM–6:00 PM · David Gonzalez')).toBeVisible()
    expect(screen.getByText('29 eligible')).toBeVisible()
  })
})
