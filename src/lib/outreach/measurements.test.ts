// @vitest-environment node
// Local-only fixtures. No env loading, network calls, or production database.
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/ops/forward-geocode', () => ({
  queueGeocodeForStoredAddress: vi.fn().mockResolvedValue(undefined),
}))
import type { SupabaseClient } from '@supabase/supabase-js'
import { queueGeocodeForStoredAddress } from '@/lib/ops/forward-geocode'
import {
  bridgeActionSchema,
  bridgeAuthorized,
  handleMeasurementAction,
  MeasurementError,
  measurementInputSchema,
  measurementPlan,
  measurementSlots,
  readMeasurementPreview,
  signMeasurementPreview,
  type MeasurementContext,
} from './measurements'
const id = (suffix: number) =>
  `10000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`
const secret = 'local-fixture-only-bridge-secret-32-characters'
const now = new Date('2026-10-28T16:00:00Z')
const input = measurementInputSchema.parse({
  operation_key: id(1),
  account_id: id(2),
  identity: { mode: 'existing', customer_id: id(3), service_address_id: id(4) },
  appointment_date: '2026-11-02',
  start_time: '09:00',
  assigned_staff_user_id: id(5),
  job_description: 'Measure office carpets',
})
function context(): MeasurementContext {
  return {
    customers: [
      {
        id: id(3),
        business_name: 'Fixture Office',
        full_name: 'Fixture Contact',
        email: 'contact@example.test',
        phone: '+17195550100',
      },
    ],
    sites: [
      {
        id: id(4),
        customer_id: id(3),
        street_1: '123 Fixture St',
        street_2: '',
        city: 'Palmer Lake',
        state: 'CO',
        zip_code: '80133',
      },
    ],
    staff: [
      {
        id: id(5),
        user_id: id(6),
        display_name: 'Fixture Estimator',
        default_open: true,
        scheduling_priority: 0,
      },
    ],
    daily: [],
    templates: [
      {
        staff_user_id: id(5),
        day_of_week: 1,
        start_time: '09:00',
        end_time: '18:00',
        slot_interval_minutes: 120,
        is_active: true,
      },
    ],
    overrides: [],
    appointments: [],
    events: [],
    blacklisted: false,
  }
}
function fakeDb(
  saved: unknown = null,
  result: unknown = { status: 'confirmed', receipt: { appointment_id: id(7) } },
) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: saved, error: null })
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  const rpc = vi.fn().mockResolvedValue({ data: result, error: null })
  return {
    db: {
      from: vi.fn().mockReturnValue(query),
      rpc,
    } as unknown as SupabaseClient,
    rpc,
    maybeSingle,
  }
}
describe('dedicated measuring input and authorization', () => {
  it('fails closed for missing, short or different bridge credentials', () => {
    expect(bridgeAuthorized(null, secret)).toBe(false)
    expect(bridgeAuthorized('Bearer short', 'short')).toBe(false)
    expect(bridgeAuthorized(`Bearer ${secret}x`, secret)).toBe(false)
    expect(bridgeAuthorized(`Bearer ${secret}`, secret)).toBe(true)
  })
  it('requires explicit account and site selection; rejects unknown side-effect fields', () => {
    expect(
      measurementInputSchema.safeParse({
        ...input,
        identity: { mode: 'existing', customer_id: id(3) },
      }).success,
    ).toBe(false)
    expect(
      measurementInputSchema.safeParse({ ...input, send_email: true }).success,
    ).toBe(false)
    expect(bridgeActionSchema.safeParse({ action: 'match' }).success).toBe(
      false,
    )
    expect(
      bridgeActionSchema.safeParse({
        action: 'slots',
        appointment_date: '2026-02-30',
      }).success,
    ).toBe(false)
  })
  it('accepts an explicit new prospect with real phone and no fabricated email', () => {
    const parsed = measurementInputSchema.parse({
      ...input,
      identity: {
        mode: 'new_customer',
        customer: {
          business_name: 'Fixture',
          contact_name: 'Contact',
          phone: '(719) 555-0100',
        },
        site: {
          street_1: '1 Test St',
          city: 'Palmer Lake',
          state: 'CO',
          zip_code: '80133',
        },
      },
    })
    expect(
      parsed.identity.mode === 'new_customer' && parsed.identity.customer.phone,
    ).toBe('+17195550100')
    expect(
      parsed.identity.mode === 'new_customer' && parsed.identity.customer.email,
    ).toBeUndefined()
  })
  it('round-trips a permitted long Unicode description through the signed confirm schema', () => {
    const large = measurementInputSchema.parse({
      ...input,
      job_description: '測'.repeat(5000),
      identity: {
        mode: 'new_customer',
        customer: {
          business_name: '測'.repeat(300),
          contact_name: '測'.repeat(200),
          phone: '+17195550101',
        },
        site: {
          street_1: '測'.repeat(300),
          street_2: '測'.repeat(300),
          city: '測'.repeat(150),
          state: 'CO',
          zip_code: '80133',
        },
      },
    })
    const signed = signMeasurementPreview(large, 'a'.repeat(64), secret)
    const confirm = {
      action: 'confirm',
      operation_key: large.operation_key,
      preview_token: signed.preview_token,
    }
    expect(bridgeActionSchema.safeParse(confirm).success).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(confirm))).toBeLessThan(40000)
  })
  it('binds preview signature to exact operation and full input', () => {
    const signed = signMeasurementPreview(
      input,
      'a'.repeat(64),
      secret,
      now.getTime(),
    )
    expect(
      readMeasurementPreview(signed.preview_token, input.operation_key, secret)
        .input,
    ).toEqual(input)
    expect(() =>
      readMeasurementPreview(signed.preview_token, id(9), secret),
    ).toThrow(MeasurementError)
    const [body, signature] = signed.preview_token.split('.')
    const altered = Buffer.from(
      JSON.stringify({
        input: { ...input, start_time: '11:00' },
        version: 'a'.repeat(64),
        expires: now.getTime() + 600000,
      }),
    ).toString('base64url')
    expect(() =>
      readMeasurementPreview(
        `${altered}.${signature}`,
        input.operation_key,
        secret,
      ),
    ).toThrow(MeasurementError)
    expect(() =>
      readMeasurementPreview(
        `${body}.${signature}x`,
        input.operation_key,
        secret,
      ),
    ).toThrow(MeasurementError)
  })
})
describe('measurement calendar and account preview', () => {
  it('uses walkthrough duration plus existing one-hour buffer, never pricing or an invoice', () => {
    const plan = measurementPlan(input, context(), now)
    expect(plan.end_time).toBe('11:00')
    expect(plan.calendar_duration_minutes).toBe(120)
    expect(plan.effects).toEqual({
      appointment_kind: 'estimate',
      invoice: false,
      email: false,
      sms: false,
      staff_notifications: false,
    })
    expect(
      measurementSlots(context(), input.appointment_date, 120, undefined, now)
        .calendar_duration_minutes,
    ).toBe(180)
  })
  it('honors closed technicians and per-date opening overrides', () => {
    const ctx = context()
    ctx.staff[0].default_open = false
    expect(
      measurementSlots(ctx, input.appointment_date, 60, undefined, now).staff,
    ).toHaveLength(0)
    ctx.daily = [{ staff_user_id: id(5), is_open: true }]
    expect(
      measurementSlots(ctx, input.appointment_date, 60, undefined, now).staff[0]
        .slots[0].start_time,
    ).toBe('09:00')
  })
  it('blocks unassigned work and pending approvals but preserves other technicians capacity', () => {
    const ctx = context()
    ctx.appointments.push({
      appointment_date: input.appointment_date,
      start_time: '09:00:00',
      end_time: '11:00:00',
      status: 'pending_approval',
      assigned_staff_user_id: null,
    })
    expect(
      measurementSlots(
        ctx,
        input.appointment_date,
        60,
        undefined,
        now,
      ).staff[0].slots.some((slot) => slot.start_time === '09:00'),
    ).toBe(false)
    ctx.appointments[0].assigned_staff_user_id = id(8)
    expect(
      measurementSlots(
        ctx,
        input.appointment_date,
        60,
        undefined,
        now,
      ).staff[0].slots.some((slot) => slot.start_time === '09:00'),
    ).toBe(true)
  })
  it('blocks continuous multi-day events tied to legacy auth staff IDs', () => {
    const ctx = context()
    ctx.events.push({
      start_date: '2026-11-01',
      end_date: '2026-11-03',
      start_time: '17:00:00',
      end_time: '10:00:00',
      is_all_day: false,
      event_kind: 'block',
      assigned_staff_user_id: id(6),
    })
    expect(
      measurementSlots(ctx, input.appointment_date, 60, undefined, now).staff[0]
        .slots,
    ).toHaveLength(0)
  })
  it('fails closed for missing calendar configuration and rejects past dates', () => {
    const ctx = context()
    ctx.templates = []
    expect(
      measurementSlots(ctx, input.appointment_date, 60, undefined, now).staff[0]
        .slots,
    ).toHaveLength(0)
    expect(() =>
      measurementSlots(ctx, '2026-10-27', 60, undefined, now),
    ).toThrow('coming year')
  })
  it('rejects an address from another business and a blocked customer', () => {
    const ctx = context()
    ctx.sites[0].customer_id = id(8)
    expect(() => measurementPlan(input, ctx, now)).toThrow('does not belong')
    ctx.blacklisted = true
    expect(() => measurementPlan(input, ctx, now)).toThrow('blacklisted')
  })
  it('does not silently merge a new prospect matching another contact', () => {
    const newInput = measurementInputSchema.parse({
      ...input,
      identity: {
        mode: 'new_customer',
        customer: {
          business_name: 'Branch',
          contact_name: 'Contact',
          email: 'contact@example.test',
          phone: '+17195550100',
        },
        site: {
          street_1: '2 Branch St',
          city: 'Palmer Lake',
          state: 'CO',
          zip_code: '80133',
        },
      },
    })
    expect(() => measurementPlan(newInput, context(), now)).toThrow(
      'existing matching customer',
    )
  })
  it('requires selecting an existing site rather than silently creating a duplicate', () => {
    const newInput = measurementInputSchema.parse({
      ...input,
      identity: {
        mode: 'new_site',
        customer_id: id(3),
        site: {
          street_1: '123 fixture st',
          city: 'Palmer Lake',
          state: 'CO',
          zip_code: '80133',
        },
      },
    })
    expect(() => measurementPlan(newInput, context(), now)).toThrow(
      'existing saved site',
    )
  })
})
describe('durable operation recovery', () => {
  it('recovers the original confirmed receipt even after preview expiry and writes disabled', async () => {
    const receipt = { appointment_id: id(7) }
    const { db, rpc } = fakeDb({
      status: 'confirmed',
      request: { ...input },
      receipt,
    })
    const signed = signMeasurementPreview(input, 'a'.repeat(64), secret, 1)
    expect(
      await handleMeasurementAction(
        db,
        {
          action: 'confirm',
          operation_key: input.operation_key,
          preview_token: signed.preview_token,
        },
        secret,
        false,
      ),
    ).toEqual({ status: 'confirmed', receipt })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('returns rejected tombstones without attempting a later booking', async () => {
    const { db, rpc } = fakeDb({
      status: 'rejected',
      request: input,
      receipt: null,
      code: 'STALE_PREVIEW',
      error: 'Changed',
    })
    expect(
      await handleMeasurementAction(
        db,
        { action: 'status', operation_key: input.operation_key },
        secret,
        false,
      ),
    ).toEqual({
      status: 'rejected',
      receipt: null,
      code: 'STALE_PREVIEW',
      error: 'Changed',
      definitive: true,
    })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('passes expiry and write gate into the operation-locked SQL function', async () => {
    const { db, rpc } = fakeDb(null, {
      status: 'rejected',
      receipt: null,
      code: 'CONFIRM_REJECTED',
      definitive: true,
    })
    const signed = signMeasurementPreview(input, 'a'.repeat(64), secret, 1)
    const result = await handleMeasurementAction(
      db,
      {
        action: 'confirm',
        operation_key: input.operation_key,
        preview_token: signed.preview_token,
      },
      secret,
      false,
    )
    expect(result.status).toBe('rejected')
    expect(rpc).toHaveBeenCalledWith(
      'confirm_outreach_measurement',
      expect.objectContaining({
        p_writes_enabled: false,
        p_expires_at: new Date(600001).toISOString(),
        p_expected_version: 'a'.repeat(64),
      }),
    )
  })
  it('keeps uncertain transport failures recoverable with the same operation', async () => {
    const { db, rpc } = fakeDb()
    rpc.mockResolvedValue({ data: null, error: { message: 'network failure' } })
    const signed = signMeasurementPreview(input, 'a'.repeat(64), secret)
    await expect(
      handleMeasurementAction(
        db,
        {
          action: 'confirm',
          operation_key: input.operation_key,
          preview_token: signed.preview_token,
        },
        secret,
        true,
      ),
    ).rejects.toMatchObject({ code: 'CONFIRM_UNCERTAIN', status: 503 })
  })
  it('rejects reusing a confirmed key for different details', async () => {
    const { db, rpc } = fakeDb({
      status: 'confirmed',
      request: { ...input, start_time: '11:00' },
      receipt: {},
    })
    const signed = signMeasurementPreview(input, 'a'.repeat(64), secret)
    await expect(
      handleMeasurementAction(
        db,
        {
          action: 'confirm',
          operation_key: input.operation_key,
          preview_token: signed.preview_token,
        },
        secret,
        true,
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_EXISTS' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('awaits a new saved site lookup and preserves a committed receipt if that lookup fails', async () => {
    const newInput = measurementInputSchema.parse({
      ...input,
      identity: {
        mode: 'new_customer',
        customer: {
          business_name: 'Fixture Business',
          contact_name: 'Fixture Contact',
          phone: '+17195550101',
        },
        site: {
          street_1: '2 Fixture St',
          city: 'Palmer Lake',
          state: 'CO',
          zip_code: '80133',
        },
      },
    })
    const outcome = {
      status: 'confirmed',
      receipt: { appointment_id: id(7), service_address_id: id(8) },
    }
    const { db } = fakeDb(null, outcome)
    vi.mocked(queueGeocodeForStoredAddress).mockRejectedValueOnce(
      new Error('fixture map failure'),
    )
    const signed = signMeasurementPreview(newInput, 'a'.repeat(64), secret)
    const result = await handleMeasurementAction(
      db,
      {
        action: 'confirm',
        operation_key: newInput.operation_key,
        preview_token: signed.preview_token,
      },
      secret,
      true,
    )
    expect(result).toEqual(outcome)
    expect(queueGeocodeForStoredAddress).toHaveBeenCalledWith(db, id(8))
  })
})
