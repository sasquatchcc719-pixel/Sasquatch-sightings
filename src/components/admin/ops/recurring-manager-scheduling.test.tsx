import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateTemplateForm } from './recurring-manager'

const address = {
  id: 'address-1',
  label: null,
  street_1: '123 Test St',
  city: 'Denver',
  state: 'CO',
  zip_code: '80000',
}
const source = {
  id: 'source-1',
  kind: 'estimate',
  customer_id: 'customer-1',
  service_address_id: address.id,
  appointment_date: '2026-09-19',
  start_time: '09:00',
  end_time: '11:00',
  assigned_staff_user_id: 'tech-1',
  internal_notes: null,
  ops_customers: {
    id: 'customer-1',
    full_name: 'Test Customer',
    business_name: 'Flexible Account',
    phone: '5551234567',
    email: null,
    ops_service_addresses: [address],
  },
  ops_service_addresses: address,
  ops_appointment_line_items: [
    {
      service_catalog_item_id: 'service-1',
      name_snapshot: 'Tile cleaning',
      notes: '',
      quantity: 1,
      unit_price: 100,
      duration_minutes: 120,
      buffer_minutes: 0,
    },
  ],
}

type Payload = {
  preview_only?: boolean
  schedule?: {
    scheduling_mode: string
    visit_overrides: Record<string, { date: string; start_time: string }>
  }
  rules: unknown
  template?: {
    scheduling_mode: string
    visit_overrides: Record<string, { date: string; start_time: string }>
  }
  reviewed_occurrences?: unknown[]
}
const requests: Payload[] = []
let generationErrors: string[] = []
let saveError = ''
let deferPreview: (() => Promise<unknown>) | null = null
const json = (data: unknown) => ({ ok: true, json: async () => data })

beforeEach(() => {
  requests.length = 0
  generationErrors = []
  saveError = ''
  deferPreview = null
  vi.stubGlobal('alert', vi.fn())
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/admin/ops/services') return json({ services: [] })
      if (url === '/api/admin/ops/staff')
        return json({
          staff: [
            { id: 'tech-1', display_name: 'Test Technician' },
            { id: 'tech-2', display_name: 'Second Technician' },
          ],
        })
      if (url === '/api/admin/ops/appointments/source-1')
        return json({ appointment: source })
      if (url === '/api/admin/ops/recurring' && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as Payload
        requests.push(payload)
        if (payload.preview_only) {
          if (deferPreview) return deferPreview()
          const override = payload.schedule?.visit_overrides['2026-10-19']
          return json({
            occurrences: [
              {
                original_date: '2026-10-19',
                date: override?.date || '2026-10-20',
                start_time: override?.start_time || '09:00',
                end_time: override ? '15:00' : '11:00',
                status: 'clear',
                shifted: true,
                reason: 'Original time is occupied.',
                conflict: null,
                alternatives: [
                  {
                    date: '2026-10-20',
                    start_time: '13:00',
                    end_time: '15:00',
                  },
                  {
                    date: '2026-10-21',
                    start_time: '13:00',
                    end_time: '15:00',
                  },
                ].filter(
                  (option) =>
                    option.date !== (override?.date || '2026-10-20') ||
                    option.start_time !== (override?.start_time || '09:00'),
                ),
              },
              {
                original_date: '2026-11-19',
                date: '2026-11-19',
                start_time: '09:00',
                end_time: '11:00',
                status: 'clear',
                shifted: false,
                conflict: null,
              },
            ],
          })
        }
        if (saveError)
          return { ok: false, json: async () => ({ error: saveError }) }
        return json({
          template: { id: 'new-plan' },
          generation: { created: 1, skipped: 0, errors: generationErrors },
        })
      }
      throw new Error(`Unexpected fetch ${url}`)
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openForm() {
  const onBack = vi.fn()
  render(<CreateTemplateForm onBack={onBack} sourceAppointmentId="source-1" />)
  await screen.findByText('Flexible Account')
  await waitFor(() =>
    expect(
      screen.queryByText('Copying the estimate or service job…'),
    ).not.toBeInTheDocument(),
  )
  return onBack
}
const save = () =>
  screen.getByRole('button', { name: 'Create Recurring Plan & Jobs' })
const preview = () =>
  screen.getByRole('button', { name: 'Find openings automatically' })

describe('flexible recurring schedule review', () => {
  it('automatically enables opening search from fixed mode in the same request', async () => {
    await openForm()
    await userEvent.click(
      screen.getByRole('checkbox', { name: /Flexible dates to fit/ }),
    )
    await userEvent.click(preview())
    await screen.findByText('All 2 reviewed visits are clear')
    expect(requests[0].schedule?.scheduling_mode).toBe('flexible')
    expect(
      screen.getByRole('checkbox', { name: /Flexible dates to fit/ }),
    ).toBeChecked()
  })

  it('lets the user pick another arrival time for one visit and persists it on save', async () => {
    await openForm()
    await userEvent.click(preview())
    await userEvent.selectOptions(
      await screen.findByRole('combobox', {
        name: 'Arrival time for visit originally due 2026-10-19',
      }),
      '13:00',
    )
    await screen.findByText('Tue, Oct 20, 2026 · 1:00 PM–3:00 PM', {
      selector: 'p',
    })
    expect(requests[1].schedule?.visit_overrides).toEqual({
      '2026-10-19': { date: '2026-10-20', start_time: '13:00' },
    })
    await userEvent.click(save())
    expect(requests[2].template?.visit_overrides).toEqual(
      requests[1].schedule?.visit_overrides,
    )
    expect(requests[2].reviewed_occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: '2026-10-20', start_time: '13:00' }),
      ]),
    )
  })

  it('clears the hidden day of month when switching to fourth Monday in preview and save', async () => {
    await openForm()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Rule 1 day of week' }),
      '1',
    )
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Rule 1 week of month' }),
      '4',
    )
    await userEvent.click(preview())
    await screen.findByText('All 2 reviewed visits are clear')
    expect(requests[0].rules).toEqual([
      expect.objectContaining({
        day_of_month: null,
        day_of_week: 1,
        week_of_month: 4,
      }),
    ])
    await userEvent.click(save())
    expect(requests[1].rules).toEqual(requests[0].rules)
  })

  it('defaults to automatic openings, previews all visits and sends the exact reviewed dates when creating', async () => {
    const onBack = await openForm()
    expect(save()).toBeDisabled()
    expect(
      screen.getByRole('checkbox', { name: /Flexible dates to fit/ }),
    ).toBeChecked()
    await userEvent.click(preview())
    await screen.findByText('All 2 reviewed visits are clear')
    expect(requests[0].schedule).toMatchObject({
      scheduling_mode: 'flexible',
      visit_overrides: {},
    })
    expect(
      screen.getByText(/Test Technician · Mountain Time/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Original rule date: Mon, Oct 19, 2026/),
    ).toBeInTheDocument()
    await userEvent.click(save())
    expect(requests[1].template?.scheduling_mode).toBe('flexible')
    expect(requests[1].reviewed_occurrences).toHaveLength(2)
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('moves one occurrence, keeps the monthly rule and next visit unchanged, and can restore the rule', async () => {
    await openForm()
    await userEvent.click(preview())
    const choice = await screen.findByRole('combobox', {
      name: 'Date for visit originally due 2026-10-19',
    })
    await userEvent.selectOptions(choice, '2026-10-21')
    await screen.findByText('Wed, Oct 21, 2026 · 1:00 PM–3:00 PM', {
      selector: 'p',
    })
    expect(requests[1].schedule?.visit_overrides).toEqual({
      '2026-10-19': { date: '2026-10-21', start_time: '13:00' },
    })
    expect(requests[1].rules).toEqual(requests[0].rules)
    expect(
      screen.getByText('Thu, Nov 19, 2026 · 9:00 AM–11:00 AM'),
    ).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Use recurring rule again' }),
    )
    await screen.findByText('Tue, Oct 20, 2026 · 9:00 AM–11:00 AM', {
      selector: 'p',
    })
    expect(requests[2].schedule?.visit_overrides).toEqual({})
  })

  it.each([
    'duration',
    'line duration',
    'technician',
    'start time',
    'rule date',
    'mode',
  ])('invalidates the preview when %s changes', async (field) => {
    await openForm()
    await userEvent.click(preview())
    await screen.findByText('All 2 reviewed visits are clear')
    expect(save()).toBeEnabled()
    if (field === 'duration')
      fireEvent.change(
        screen.getByRole('spinbutton', {
          name: 'Scheduled duration in minutes',
        }),
        {
          target: { value: '180' },
        },
      )
    if (field === 'line duration')
      fireEvent.change(
        screen.getByRole('spinbutton', { name: 'Line 1 duration in minutes' }),
        { target: { value: '180' } },
      )
    if (field === 'technician')
      await userEvent.selectOptions(
        screen.getByRole('combobox', { name: 'Assigned technician' }),
        'tech-2',
      )
    if (field === 'start time')
      fireEvent.change(screen.getByDisplayValue('09:00'), {
        target: { value: '10:00' },
      })
    if (field === 'rule date')
      fireEvent.change(screen.getByDisplayValue('2026-10-19'), {
        target: { value: '2026-10-22' },
      })
    if (field === 'mode')
      await userEvent.click(
        screen.getByRole('checkbox', { name: /Flexible dates to fit/ }),
      )
    expect(save()).toBeDisabled()
    expect(
      screen.queryByText('All 2 reviewed visits are clear'),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Preview again')
  })

  it('does not authorize saving with a stale response after an in-flight schedule edit', async () => {
    await openForm()
    let release!: (value: unknown) => void
    deferPreview = () =>
      new Promise((resolve) => {
        release = resolve
      })
    await userEvent.click(preview())
    fireEvent.change(screen.getByDisplayValue('09:00'), {
      target: { value: '10:00' },
    })
    release(
      json({
        occurrences: [
          {
            original_date: '2026-10-19',
            date: '2026-10-19',
            start_time: '09:00',
            end_time: '11:00',
            status: 'clear',
            conflict: null,
          },
        ],
      }),
    )
    await waitFor(() => expect(preview()).toBeEnabled())
    expect(save()).toBeDisabled()
    expect(
      screen.queryByText(/reviewed visits are clear/),
    ).not.toBeInTheDocument()
  })

  it('requires a new preview when saving finds that the calendar changed', async () => {
    const onBack = await openForm()
    saveError = 'The calendar changed. Preview again.'
    await userEvent.click(preview())
    await screen.findByText('All 2 reviewed visits are clear')
    await userEvent.click(save())
    expect(await screen.findByRole('alert')).toHaveTextContent(saveError)
    expect(save()).toBeDisabled()
    expect(onBack).not.toHaveBeenCalled()
  })

  it('keeps partial-generation errors visible and prevents a duplicate create', async () => {
    const onBack = await openForm()
    generationErrors = ['October opening changed.']
    await userEvent.click(preview())
    await screen.findByText('All 2 reviewed visits are clear')
    await userEvent.click(save())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Plan created, but 1 visit needs attention: October opening changed.',
    )
    expect(onBack).not.toHaveBeenCalled()
    expect(save()).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Review recurring jobs' }),
    ).toBeEnabled()
  })
})
