// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendPartnerSMS: vi.fn(),
  from: vi.fn(),
  settingResult: {
    data: { value: { enabled: false } } as unknown,
    error: null as { message: string } | null,
  },
  partnerEq: vi.fn(),
  alertInsert: vi.fn(),
  recentAlerts: [] as Array<{ partner_id: string; station_type: string }>,
}))

vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))

vi.mock('@/lib/twilio', () => ({
  sendPartnerSMS: mocks.sendPartnerSMS,
}))

const oldDate = '2020-01-01T00:00:00.000Z'
type PartnerFixture = {
  id: string
  location_name: string | null
  company_name: string | null
  phone: string | null
  last_sasquatch_tap_at: string | null
  last_review_tap_at: string | null
  google_review_url: string | null
  total_taps: number
}

const eligiblePartner: PartnerFixture = {
  id: 'eligible-partner',
  location_name: 'Eligible Location',
  company_name: null,
  phone: '+17195550100',
  last_sasquatch_tap_at: oldDate,
  last_review_tap_at: null,
  google_review_url: null,
  total_taps: 1,
}

function installDatabaseMock(partners: PartnerFixture[] = [eligiblePartner]) {
  mocks.partnerEq.mockResolvedValue({ data: partners, error: null })
  mocks.alertInsert.mockResolvedValue({ error: null })
  mocks.from.mockImplementation((table: string) => {
    if (table === 'system_settings') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => mocks.settingResult,
          }),
        }),
      }
    }
    if (table === 'partners') {
      return {
        select: () => ({ eq: mocks.partnerEq }),
      }
    }
    if (table === 'station_health_alerts') {
      return {
        select: () => ({
          gte: async () => ({ data: mocks.recentAlerts, error: null }),
        }),
        insert: mocks.alertInsert,
      }
    }
    throw new Error(`Unexpected table access: ${table}`)
  })
}

async function runCron() {
  const { GET } = await import('./route')
  const { NextRequest } = await import('next/server')
  const response = await GET(
    new NextRequest('http://localhost/api/cron/station-health', {
      headers: { authorization: 'Bearer unit-test-secret' },
    }),
  )
  return { response, body: await response.json() }
}

function expectNoOutreachWork() {
  expect(mocks.from).not.toHaveBeenCalledWith('partners')
  expect(mocks.from).not.toHaveBeenCalledWith('station_health_alerts')
  expect(mocks.sendPartnerSMS).not.toHaveBeenCalled()
  expect(mocks.alertInsert).not.toHaveBeenCalled()
}

describe('station-health automatic partner SMS switch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'unit-test-secret')
    mocks.settingResult = {
      data: { value: { enabled: false } },
      error: null,
    }
    mocks.recentAlerts = []
    mocks.sendPartnerSMS.mockResolvedValue(true)
    installDatabaseMock()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('does not read partners, send, or write cooldown records when saved OFF', async () => {
    const { response, body } = await runCron()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ enabled: false, skipped: true })
    expectNoOutreachWork()
  })

  it('defaults OFF when the setting is missing', async () => {
    mocks.settingResult = { data: null, error: null }

    const { response, body } = await runCron()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ enabled: false, skipped: true })
    expectNoOutreachWork()
  })

  it('fails closed before partner reads when the setting query errors', async () => {
    mocks.settingResult = {
      data: null,
      error: { message: 'database unavailable' },
    }

    const { response, body } = await runCron()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({ enabled: false, skipped: true })
    expectNoOutreachWork()
  })

  it('fails closed before partner reads when the saved value is unreadable', async () => {
    mocks.settingResult = { data: { value: { enabled: 'yes' } }, error: null }

    const { response, body } = await runCron()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({ enabled: false, skipped: true })
    expectNoOutreachWork()
  })

  it('when explicitly ON, keeps the existing location-partner eligibility scope', async () => {
    mocks.settingResult = {
      data: { value: { enabled: true } },
      error: null,
    }
    installDatabaseMock([
      eligiblePartner,
      {
        ...eligiblePartner,
        id: 'never-active',
        location_name: 'Never Active',
        total_taps: 0,
      },
      {
        ...eligiblePartner,
        id: 'no-phone',
        location_name: 'No Phone',
        phone: null,
      },
    ])

    const { response, body } = await runCron()

    expect(response.status).toBe(200)
    expect(mocks.partnerEq).toHaveBeenCalledWith('partner_type', 'location')
    expect(mocks.sendPartnerSMS).toHaveBeenCalledTimes(1)
    expect(mocks.sendPartnerSMS).toHaveBeenCalledWith(
      eligiblePartner.phone,
      expect.stringContaining('Sasquatch station'),
      eligiblePartner.id,
      'station_health',
    )
    expect(mocks.alertInsert).toHaveBeenCalledTimes(1)
    expect(body.results.alertsSent).toBe(1)
  })

  it('does not write sent/cooldown records when Twilio does not accept the SMS', async () => {
    mocks.settingResult = {
      data: { value: { enabled: true } },
      error: null,
    }
    mocks.sendPartnerSMS.mockResolvedValue(false)

    const { response, body } = await runCron()

    expect(response.status).toBe(200)
    expect(body.results.alertsSent).toBe(0)
    expect(body.results.errors).toEqual([
      'Eligible Location: SMS was not accepted',
    ])
    expect(mocks.alertInsert).not.toHaveBeenCalled()
  })
})
