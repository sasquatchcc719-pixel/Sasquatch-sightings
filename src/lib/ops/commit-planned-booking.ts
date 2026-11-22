import type {
  CreateAiStyleBookingInput,
  CreateAiStyleBookingPreviewSuccess,
} from './create-ai-style-booking'
import { queueGeocodeForStoredAddress } from './forward-geocode'
import { deliverPhoneBookingEmails } from './phone-booking-email'
import { normalizeTown } from '@/lib/geo/towns'
import { sendOpsLifecycleCommunications } from '@/lib/ops/communications'
import { ensureCustomerQuickBooksSyncJob } from '@/lib/ops/quickbooks-sync-jobs'
import {
  buildQuickBooksCustomerPayload,
  getQuickBooksSyncStatus,
} from '@/lib/quickbooks'
import { syncAppointmentToQuickBooks } from '@/lib/quickbooks-api'
import { cancelReactivationForCustomer } from '@/lib/ops/reactivation-campaign'
import { sendAdminSMS } from '@/lib/twilio'
import { sendOneSignalNotification } from '@/lib/onesignal'
import { sendBookingNotification, scheduleJobReminder } from '@/lib/telegram'

/** Commit a validated plan atomically before running the normal booking notifications. */
export async function commitPlannedBooking(
  bookingInput: CreateAiStyleBookingInput,
  planned: CreateAiStyleBookingPreviewSuccess,
  actorUserId: string | null,
  phone?: {
    callSid: string
    requestHash: string
    calendarVersion: string
    verifiedCustomerId?: string
    verifiedServiceAddressId?: string
    useSavedEmail?: boolean
    expectedCallerSequence?: number | null
    coupon: string | null
    serviceSubtotal: number
    deferEffects: (task: () => Promise<void>) => void
  },
) {
  const supabase = bookingInput.supabase
  const plan = {
    customer: bookingInput.customer,
    address: {
      ...bookingInput.address,
      town_slug: normalizeTown(bookingInput.address.city),
    },
    appointment_date: planned.appointment_date,
    start_time: planned.start_time,
    end_time: planned.end_time,
    assigned_staff_user_id: planned.assigned_staff_user_id,
    appointment_status: planned.appointment_status,
    subtotal: planned.subtotal,
    discount_applied: planned.discount_applied,
    total: planned.total,
    line_items: planned.line_items,
    lead_source: planned.lead_source,
    sync_status: bookingInput.sync_quickbooks
      ? getQuickBooksSyncStatus()
      : 'held',
  }
  const { data, error } = phone
    ? await supabase.rpc('save_phone_booking', {
        p_sid: phone.callSid,
        p_hash: phone.requestHash,
        p_plan: {
          ...plan,
          calendar_version: phone.calendarVersion,
          ...(phone.verifiedCustomerId || phone.verifiedServiceAddressId
            ? {
                verified_customer_id: phone.verifiedCustomerId,
                verified_service_address_id: phone.verifiedServiceAddressId,
                use_saved_email: phone.useSavedEmail === true,
              }
            : {}),
          expected_caller_sequence: phone.expectedCallerSequence,
          coupon_code: phone.coupon,
          service_subtotal: phone.serviceSubtotal,
        },
      })
    : await supabase.rpc(
        bookingInput.gap_offer_id
          ? 'mcp_create_gap_appointment'
          : 'mcp_create_appointment',
        {
          p_plan: plan,
          p_actor_user_id: actorUserId,
          ...(bookingInput.gap_offer_id
            ? {
                p_offer: bookingInput.gap_offer_id,
                p_allow_alternate: Boolean(
                  bookingInput.approve_alternate_offer,
                ),
              }
            : {}),
        },
      )
  if (error) throw error
  const result = data as {
    replayed?: boolean
    appointment_date?: string
    start_time?: string
    customer_id: string
    address_id: string
    appointment_id: string
    invoice_id: string
    appointment_status: 'booked' | 'pending_approval'
    subtotal: number
    discount_applied: number
    total: number
  }
  if (!result?.appointment_id || !result.appointment_status)
    throw new Error('Missing appointment receipt')
  if (result.replayed)
    return {
      appointment_id: result.appointment_id,
      status: result.appointment_status,
      confirmation_number:
        'SC-' + result.appointment_id.slice(0, 8).toUpperCase(),
      appointment_date: result.appointment_date,
      start_time: result.start_time,
      total: result.total,
    }
  const heading = phone ? 'Harry phone booking' : 'MCP booking'
  const warnings: string[] = []
  // The appointment/invoice transaction already committed. Keep the call responsive
  // while the request lifetime covers notifications and accounting.
  async function deliverEffects() {
    const warn = (label: string, reason: unknown) => {
      console.error(`[mcp/appointment] ${label}:`, reason)
      warnings.push(label)
    }
    const fullName =
      `${bookingInput.customer.first_name} ${bookingInput.customer.last_name}`.trim()

    try {
      await queueGeocodeForStoredAddress(supabase, result.address_id)
    } catch (reason) {
      warn(
        'Appointment was created, but address geocoding could not be queued.',
        reason,
      )
    }
    try {
      await cancelReactivationForCustomer(result.customer_id, 'booked_job')
    } catch (reason) {
      warn(
        'Appointment was created, but reactivation suppression could not be updated.',
        reason,
      )
    }
    if (bookingInput.sync_quickbooks) {
      try {
        await ensureCustomerQuickBooksSyncJob(
          supabase as Parameters<typeof ensureCustomerQuickBooksSyncJob>[0],
          result.customer_id,
          buildQuickBooksCustomerPayload({
            customerId: result.customer_id,
            fullName,
            email: bookingInput.customer.email,
            phone: bookingInput.customer.phone,
            address: bookingInput.address,
          }),
        )
        if (result.appointment_status === 'booked') {
          await syncAppointmentToQuickBooks(result.appointment_id)
        }
      } catch (reason) {
        warn(
          'Appointment was created, but QuickBooks synchronization failed.',
          reason,
        )
      }
    }
    if (
      bookingInput.notify_customer &&
      result.appointment_status === 'booked'
    ) {
      try {
        await sendOpsLifecycleCommunications({
          event: 'job_scheduled',
          appointmentId: result.appointment_id,
          ...(phone && { bookingEmailQueued: true }),
        })
      } catch (reason) {
        warn(
          'Appointment was created, but customer confirmation delivery failed.',
          reason,
        )
      }
    }
    if (bookingInput.notify_internal) {
      const serviceNames = planned.line_items.map((item) => item.name_snapshot)
      const statusLabel =
        result.appointment_status === 'pending_approval'
          ? ' (NEEDS APPROVAL)'
          : ''
      const dateWithYear = new Date(
        `${planned.appointment_date}T12:00:00`,
      ).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'America/Denver',
      })
      const leadSource = [
        planned.lead_source.lead_source,
        planned.lead_source.lead_source_detail,
      ]
        .filter(Boolean)
        .join(' - ')
      const adminMessage = [
        `New ${heading}${statusLabel}!`,
        `${fullName} — $${Number(result.total).toFixed(2)}`,
        serviceNames.join(', '),
        `${bookingInput.address.street_1}, ${bookingInput.address.city}, ${bookingInput.address.state} ${bookingInput.address.zip_code}`,
        `${planned.appointment_date} at ${planned.start_time.slice(0, 5)}`,
        `Lead source: ${leadSource || 'Not captured'}`,
      ].join('\n')
      const settled = await Promise.allSettled([
        sendAdminSMS(adminMessage, 'new_booking'),
        sendOneSignalNotification({
          heading: `New ${heading}${statusLabel}`,
          content: `${fullName} — $${Number(result.total).toFixed(2)} · ${dateWithYear}`,
          data: { type: 'new_booking', appointment_id: result.appointment_id },
        }),
        sendBookingNotification({
          customerName: fullName,
          phone: bookingInput.customer.phone,
          appointmentDate: planned.appointment_date,
          startTime: planned.start_time.slice(0, 5),
          total: Number(result.total),
          leadSource: leadSource || 'Not captured',
          bookingMethod: phone
            ? bookingInput.source_label
            : 'Dot MCP (ai agent)',
          technicianSchedule: planned.technician_name,
          services: serviceNames,
        }),
      ])
      if (settled.some((entry) => entry.status === 'rejected')) {
        warnings.push(
          'Appointment was created, but one or more internal notifications failed.',
        )
      }
      if (result.appointment_status === 'booked') {
        try {
          scheduleJobReminder({
            appointmentDate: planned.appointment_date,
            startTime: planned.start_time.slice(0, 5),
            customerName: fullName,
            address: `${bookingInput.address.street_1}, ${bookingInput.address.city}, ${bookingInput.address.state} ${bookingInput.address.zip_code}`,
            appointmentId: result.appointment_id,
          })
        } catch (reason) {
          warn(
            'Appointment was created, but the internal reminder could not be scheduled.',
            reason,
          )
        }
      }
    }
  }
  if (phone)
    phone.deferEffects(async () => {
      const effects = await Promise.allSettled([
        deliverPhoneBookingEmails(supabase, result.appointment_id),
        deliverEffects(),
      ])
      for (const effect of effects) {
        if (effect.status === 'rejected')
          console.error(
            '[phone-booking] Post-commit delivery failed',
            result.appointment_id,
            effect.reason,
          )
      }
    })
  else await deliverEffects()
  const confirmationNumber = `SC-${result.appointment_id.slice(0, 8).toUpperCase()}`
  return {
    appointment_id: result.appointment_id,
    invoice_id: result.invoice_id,
    customer_id: result.customer_id,
    address_id: result.address_id,
    confirmation_number: confirmationNumber,
    status: result.appointment_status,
    appointment_date: phone
      ? result.appointment_date
      : planned.appointment_date,
    start_time: phone ? result.start_time : planned.start_time,
    end_time: planned.end_time,
    subtotal: result.subtotal,
    discount_applied: result.discount_applied,
    total: result.total,
    customer_notification_requested: Boolean(bookingInput.notify_customer),
    internal_notifications_requested: Boolean(bookingInput.notify_internal),
    quickbooks_sync_requested: Boolean(bookingInput.sync_quickbooks),
    warning: warnings.join(' ') || null,
  }
}
