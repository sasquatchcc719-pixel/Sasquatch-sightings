import { createHash } from 'node:crypto'
import { after } from 'next/server'
import { queueGeocodeForStoredAddress } from '@/lib/ops/forward-geocode'
import { sendAdminSMS } from '@/lib/twilio'
import { sendOneSignalNotification } from '@/lib/onesignal'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeTown } from '@/lib/geo/towns'
import { commercialEstimateCalendarMinutes } from '@/lib/ops/create-ai-style-estimate'
import { getStaffPrioritizedSlots } from '@/lib/ops/staff-availability'
import { checkServiceArea } from '@/lib/service-area'
import {
  leadSourceUpdatePayload,
  normalizeLeadSourceForWrite,
} from '@/lib/server/lead-sources'

type MeasurementInput = {
  db: SupabaseClient
  callSid: string
  callerPhone: string
  customer: { first_name: string; last_name: string; email: string }
  address: {
    street_1: string
    street_2?: string
    city: string
    state: 'CO'
    zip_code: string
  }
  appointmentDate: string
  startTime: string
  businessName: string
  jobDescription: string
  leadSource?: string
  leadDetail?: string
  savedContact?: {
    customerId: string
    addressId: string
    useSavedEmail: boolean
  }
  expectedCallerSequence?: number | null
  isCurrent?: () => Promise<boolean>
}

export async function bookPhoneMeasurement(input: MeasurementInput) {
  const { db, callSid, appointmentDate: date, startTime: time } = input
  if (!checkServiceArea(input.address.zip_code).allowed)
    return {
      error:
        'Outside the measuring service area. Take a message for the office.',
    }
  const contact = {
    first_name: input.customer.first_name.trim(),
    last_name: input.customer.last_name.trim(),
    email: input.customer.email.trim().toLowerCase(),
    phone: input.callerPhone,
    business_name: input.businessName.trim(),
  }
  const address = {
    street_1: input.address.street_1.trim(),
    street_2: input.address.street_2?.trim() || null,
    city: input.address.city.trim(),
    state: input.address.state,
    zip_code: input.address.zip_code,
    town_slug: normalizeTown(input.address.city),
  }
  let source = null
  if (input.leadSource) {
    const resolved = await normalizeLeadSourceForWrite({
      supabase: db,
      sourceKey: input.leadSource,
      detail: input.leadDetail,
    })
    if (!resolved.ok) return { error: resolved.error }
    source = leadSourceUpdatePayload(resolved.source)
  }
  const plan = {
    customer: contact,
    address,
    date,
    time,
    description: input.jobDescription.trim(),
    source,
    ...(input.savedContact && {
      saved_contact: {
        customer_id: input.savedContact.customerId,
        address_id: input.savedContact.addressId,
        use_saved_email: input.savedContact.useSavedEmail,
      },
    }),
  }
  const hash = createHash('sha256').update(JSON.stringify(plan)).digest('hex')
  const failure = {
    error:
      'Unable to verify this measuring visit. Take a message for office follow-up.',
  }
  const saved = await db
    .from('ops_appointments')
    .select(
      'id,kind,status,parked_at,appointment_date,start_time,phone_assistant_request_hash',
    )
    .eq('phone_assistant_call_sid', callSid)
    .maybeSingle()
  if (saved.error) return failure
  if (saved.data) {
    const row = saved.data
    if (
      row.kind !== 'estimate' ||
      !['confirmed', 'booked'].includes(row.status) ||
      row.parked_at ||
      row.appointment_date !== date ||
      row.start_time?.slice(0, 5) !== time ||
      row.phone_assistant_request_hash !== hash
    )
      return failure
    return {
      status: 'booked' as const,
      appointment_id: row.id,
      confirmation_number: 'EST-' + row.id.slice(0, 8).toUpperCase(),
      date,
      time,
    }
  }
  // Capture the calendar first. The transaction checks it again after locking
  // the calendar so a conflicting edit during the slot lookup forces a retry.
  const version = await db.rpc('phone_booking_calendar_version', {
    p_date: date,
    p_contact: contact,
  })
  if (version.error || !version.data) return failure
  const staff = await getStaffPrioritizedSlots({
    supabase: db,
    date,
    requiredMinutes: commercialEstimateCalendarMinutes(60),
    maxResults: 48,
  })
  if (!staff?.slots.some((slot) => slot.start_time.slice(0, 5) === time))
    return {
      error: 'That measuring time is unavailable. Check the latest openings.',
    }
  if (input.isCurrent && !(await input.isCurrent()))
    return { error: 'The caller has moved on. Reconfirm the visit.' }
  const result = await db.rpc('create_phone_measurement', {
    p_sid: callSid,
    p_hash: hash,
    p_plan: {
      ...plan,
      staff_id: staff.staffUserId,
      expected_caller_sequence: input.expectedCallerSequence,
    },
    p_version: version.data,
  })
  const receipt = result.data
  if (
    result.error ||
    receipt?.status !== 'booked' ||
    !receipt.appointment_id ||
    receipt.date !== date ||
    receipt.time !== time ||
    receipt.confirmation_number !==
      'EST-' + receipt.appointment_id.slice(0, 8).toUpperCase()
  )
    return failure
  if (receipt.created) {
    after(async () => {
      const settled = await Promise.allSettled([
        queueGeocodeForStoredAddress(db, receipt.address_id),
        sendAdminSMS(
          [
            'Harry scheduled a commercial walkthrough',
            contact.business_name,
            contact.first_name +
              ' ' +
              contact.last_name +
              ' · ' +
              contact.phone,
            [address.street_1, address.street_2, address.city, address.zip_code]
              .filter(Boolean)
              .join(', '),
            date + ' at ' + time,
            plan.description,
            receipt.confirmation_number,
          ].join('\n'),
          'new_estimate',
        ),
        sendOneSignalNotification({
          heading: 'Commercial walkthrough booked',
          content: contact.business_name + ' · ' + date + ' at ' + time,
          data: {
            type: 'new_estimate',
            appointment_id: receipt.appointment_id,
          },
        }),
      ])
      if (settled.some((effect) => effect.status === 'rejected'))
        console.error(
          '[Phone assistant] Measuring visit follow-up failed',
          receipt.appointment_id,
        )
    })
  }
  return {
    status: 'booked' as const,
    appointment_id: String(receipt.appointment_id),
    confirmation_number: String(receipt.confirmation_number),
    date,
    time,
  }
}
